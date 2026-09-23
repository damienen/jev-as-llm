// The word decoder: builds a reply one word at a time by asking Jev
// multiple-choice questions. Also the sliding context window that keeps the
// conversation inside Jev's input budget. See EXPERIMENT_LOG.md for why it
// works this way (every character-level approach failed).

import { JevError, judge, type Distribution, type JevErrorCode, type Turn } from "./jev";
import { Vocabulary } from "./vocab";
import { END, NONE, OTHER, chooseFromChunks, chooseGroup, chooseToken, chooseWord } from "./wordgen";
import { candidateTokens, joinToken } from "./words";

export interface Settings {
  temperature: number; // 0 = always the top choice
  maxChars: number; // per reply, capped at MAX_CHARS
  rerank: boolean; // judge the top candidates as whole replies before picking (off: ~1.7x the cost for no net gain, see EXPERIMENT_LOG.md)
}

export const MAX_CHARS = 500;
export const DEFAULTS: Settings = { temperature: 0, maxChars: 300, rerank: false };

export function normalizeSettings(raw: Partial<Settings> = {}): Settings {
  const s = { ...DEFAULTS, ...raw };
  return {
    temperature: clamp(Number(s.temperature) || 0, 0, 2),
    maxChars: Math.round(clamp(Number(s.maxChars) || DEFAULTS.maxChars, 1, MAX_CHARS)),
    rerank: s.rerank === true,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---- context window -------------------------------------------------------

/** Tokens the conversation may use (Jev allows 32k for state plus one question). */
export const CONTEXT_BUDGET = 24_000;
/** Conservative tokens per JSON character of the conversation (measured ~0.2). */
const TOKENS_PER_CHAR = 0.35;

export function estimateTokens(conversation: Turn[]): number {
  return Math.round(JSON.stringify(conversation).length * TOKENS_PER_CHAR);
}

/** Drop the oldest turns until the conversation fits; always keeps the last turn. */
export function fitContext(conversation: Turn[]): { kept: Turn[]; trimmed: number } {
  let kept = conversation;
  while (kept.length > 1 && estimateTokens(kept) > CONTEXT_BUDGET) kept = kept.slice(1);
  // A single enormous message still has to fit: keep its tail.
  if (estimateTokens(kept) > CONTEXT_BUDGET) {
    const last = kept[kept.length - 1];
    const maxChars = Math.floor(CONTEXT_BUDGET / TOKENS_PER_CHAR) - 100;
    kept = [{ ...last, text: last.text.slice(-maxChars) }];
  }
  return { kept, trimmed: conversation.length - kept.length };
}

// ---- events ---------------------------------------------------------------

export interface Candidate {
  label: string;
  p: number;
}
export interface StepEvent {
  step: number;
  label: string; // the chosen word; "<OTHER>→word" when it came from the dictionary
  /** For dictionary words: the first letters searched and how many words that covered. */
  lookup?: { letters: string[]; searched: number };
  text: string; // reply so far
  top: Candidate[]; // top options of the step's word Choice
  confidence: number;
  inputTokens: number;
  latencyMs: number;
}
export interface GenerationResult {
  text: string;
  stopReason: "end" | "max_chars" | "aborted" | "error";
  steps: number;
  inputTokens: number;
  error?: string;
  errorCode?: JevErrorCode;
  /** Full per-step record for the research log. */
  trace: unknown[];
}

const TOP_N = 10;
function topOf(d: Distribution, n = TOP_N): Candidate[] {
  return Object.entries(d)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, p]) => ({ label, p }));
}

function sample(d: Distribution, temperature: number): string {
  const entries = Object.entries(d);
  if (temperature <= 0) return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const weights = entries.map(([, p]) => (p > 0 ? Math.pow(p, 1 / temperature) : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i];
    if (r <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

// ---- rules code owns --------------------------------------------------------

// Jev's probabilities come rounded to 2 decimals; treat 0 as "below 0.005".
const FLOOR_P = 0.001;
const ARTICLES = new Set(["a", "an", "the"]);
// Words that can't follow an article: pronouns and possessives ("the it's", "the your").
const PRONOUNS = new Set(["i", "i'm", "i'll", "i've", "you", "you're", "he", "she", "it", "it's", "we", "they", "me", "us", "them", "my", "your", "his", "her", "its", "our", "their", "this", "that", "these", "those"]);

/** A candidate must change the reply, not repeat the previous word, and not break simple article grammar. */
export function progresses(reply: string, token: string): boolean {
  if (token === END || token === OTHER) return true;
  const next = joinToken(reply, token);
  if (next === reply) return false;
  const last = reply.trimEnd().split(/\s+/).pop() ?? "";
  if (last === token || reply.endsWith(token)) return false;
  // An article is followed by a word: never punctuation, another article, or a pronoun.
  if (ARTICLES.has(last) && (ARTICLES.has(token) || !/^[a-z0-9]/.test(token))) return false;
  if (ARTICLES.has(last) && PRONOUNS.has(token)) return false;
  // Loop guard: the same word pair may appear at most twice ("is the ... is the ... is the" stops).
  const words = reply.match(/[a-z0-9']+|[.,!?:]/g) ?? [];
  const prev = words[words.length - 1];
  let seen = 0;
  for (let i = 1; i < words.length; i++) if (words[i - 1] === prev && words[i] === token) seen++;
  return seen < 2;
}

// ---- the decoder --------------------------------------------------------------

const MAX_CHOICE = 250;
/** Rerank: how many of the Choice's top options the judge scores, and the weight of their log-probability. */
const RERANK_TOP = 8;
const RERANK_PRIOR = 0.3;
/** Only open the dictionary when Jev puts at least this much on "look up". */
const OTHER_MIN_P = 0.15;
/** Lookup: search the top letters (the first one often echoes the question, e.g. "f" for fruits). */
const LOOKUP_LETTERS = 3;
const LOOKUP_LETTER_MIN_P = 0.1;

async function runWords(
  conversation: Turn[],
  s: Settings,
  onStep: (e: StepEvent) => void,
  signal: AbortSignal,
  trace: unknown[],
): Promise<GenerationResult> {
  const convText = conversation.map((t) => t.text).join(" ");
  const tokens = candidateTokens(convText, MAX_CHOICE);
  const vocab = await Vocabulary.create(convText);
  let reply = "";
  let inputTokens = 0;

  // An unlisted word: likely first letters -> every word under them, as parallel
  // chunked Choices -> final pick among the chunk winners. Null if nothing fits.
  const letters = [...new Set(vocab.bucket("").map((w) => w[0]))].filter((c) => /[a-z]/.test(c)).sort();
  async function lookUp(): Promise<{ word: string | null; tokens: number; ms: number; path: string[]; letters: string[]; searched: number }> {
    const g = await chooseGroup(conversation, reply, letters.map((l) => ({ key: l, examples: vocab.bucket(l).slice(0, 5) })), signal);
    const picked = topOf(g.distribution, LOOKUP_LETTERS).filter((c, i) => i === 0 || c.p >= LOOKUP_LETTER_MIN_P).map((c) => c.label);
    const chunks: string[][] = [];
    for (const l of picked) {
      const bucket = vocab.bucket(l);
      for (let i = 0; i < bucket.length; i += MAX_CHOICE) chunks.push(bucket.slice(i, i + MAX_CHOICE));
    }
    const c = await chooseFromChunks(conversation, reply, chunks, signal);
    const path = [picked.map((l) => l + "…").join("/")];
    const searched = chunks.reduce((n, c) => n + c.length, 0);
    const used = g.inputTokens + c.inputTokens;
    const ms = g.latencyMs + c.latencyMs;
    if (c.winners.length === 0) return { word: null, tokens: used, ms, path: [...path, NONE], letters: picked, searched };
    const finalists = c.winners.sort((a, b) => b.p - a.p).slice(0, 40).map((w) => w.word);
    const f = await chooseWord(conversation, reply, finalists, signal);
    const word = sample(f.distribution, s.temperature);
    return { word: word === NONE ? null : word, tokens: used + f.inputTokens, ms: ms + f.latencyMs, path: [...path, `${finalists.length} finalists`, word], letters: picked, searched };
  }

  for (let step = 0; ; step++) {
    // Steps are capped too: a token that doesn't grow the reply must never loop forever.
    if (reply.length >= s.maxChars || step >= s.maxChars) return { text: reply, stopReason: "max_chars", steps: step, inputTokens, trace };

    // 1. Which of ~250 listed words (or "look up", or "stop") comes next?
    const pick = await chooseToken(conversation, reply, tokens, signal);
    let used = pick.inputTokens;
    let ms = pick.latencyMs;
    let path: string[] | undefined;
    let fromOther: string | null = null;
    let lookup: StepEvent["lookup"];
    const resolveOther = async () => {
      const found = await lookUp();
      used += found.tokens;
      ms += found.ms;
      path = found.path;
      fromOther = found.word;
      lookup = { letters: found.letters, searched: found.searched };
      return found.word;
    };

    let token: string;
    let judged: { token: string; p: number; score: number }[] | undefined;
    if (s.rerank) {
      // 2. Resolve "look up" to a concrete dictionary word (only if Jev really wants one),
      // 3. then judge the top candidates as whole replies and keep the best.
      const top = topOf(pick.distribution, RERANK_TOP).filter((c) => c.p > 0 && progresses(reply, c.label) && (c.label !== OTHER || c.p >= OTHER_MIN_P));
      const cands: { token: string; p: number }[] = [];
      for (const c of top) {
        if (c.label !== OTHER) cands.push({ token: c.label, p: c.p });
        else {
          const w = await resolveOther();
          if (w && progresses(reply, w) && !cands.some((x) => x.token === w)) cands.push({ token: w, p: c.p });
        }
      }
      // Stopping is always an option, judged as the finished reply, so a reply that
      // is already good isn't padded with worse continuations.
      if (reply && !cands.some((c) => c.token === END)) cands.push({ token: END, p: pick.distribution[END] ?? 0 });
      if (cands.length === 0) cands.push({ token: END, p: 1 });
      const j = await judge(
        conversation,
        cands.map((c) => (c.token === END ? { text: reply, final: true } : { text: joinToken(reply, c.token), final: false })),
        signal,
      );
      used += j.inputTokens;
      ms += j.latencyMs;
      judged = cands.map((c, i) => ({ ...c, score: j.scores[i] }));
      const keys = Object.fromEntries(judged.map((c) => [c.token, c.score + RERANK_PRIOR * Math.log(Math.max(c.p, FLOOR_P))]));
      token = s.temperature <= 0 ? sample(keys, 0) : sample(Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Math.exp(v / s.temperature)])), 1);
    } else {
      // Without the judge: take Jev's top allowed option; "look up" goes to the dictionary.
      const ok = Object.fromEntries(Object.entries(pick.distribution).filter(([t]) => progresses(reply, t)));
      token = sample(ok, s.temperature);
      // Nothing in the dictionary fits: fall back to the best listed token.
      if (token === OTHER) {
        // The dictionary word must obey the same rules; otherwise fall back to the best allowed listed token.
        const w = await resolveOther();
        token = w && progresses(reply, w) ? w : (topOf(ok).find((c) => c.label !== OTHER)?.label ?? END);
      }
    }

    // 4. Code appends the word (spacing, a/an) and streams it.
    inputTokens += used;
    trace.push({ step, token, path, judged, confidence: pick.confidence, inputTokens: used, latencyMs: ms, distribution: pick.distribution });
    if (token !== END) reply = joinToken(reply, token);
    const viaDictionary = fromOther === token;
    onStep({ step, label: viaDictionary ? `${OTHER}→${token}` : token, lookup: viaDictionary ? lookup : undefined, text: reply, top: topOf(pick.distribution), confidence: pick.confidence, inputTokens: used, latencyMs: ms });
    if (token === END) return { text: reply, stopReason: "end", steps: step + 1, inputTokens, trace };
  }
}

// ---- entry point ----------------------------------------------------------

export async function generate(
  conversation: Turn[],
  s: Settings,
  onStep: (e: StepEvent) => void,
  signal: AbortSignal,
): Promise<GenerationResult> {
  const trace: unknown[] = [];
  let partial: GenerationResult = { text: "", stopReason: "aborted", steps: 0, inputTokens: 0, trace };
  try {
    return await runWords(conversation, s, (e) => {
      partial = { ...partial, text: e.text, steps: e.step + 1, inputTokens: partial.inputTokens + e.inputTokens };
      onStep(e);
    }, signal, trace);
  } catch (err) {
    if (signal.aborted) return { ...partial, stopReason: "aborted" };
    return { ...partial, stopReason: "error", error: err instanceof Error ? err.message : String(err), errorCode: err instanceof JevError ? err.code : undefined };
  }
}
