// Jev questions for the word-level decoder. Every option shows the reply as it
// would read after that choice: Jev compares whole continuations well, and
// fine-grained positional choices (single characters) badly.

import { ask, choice, type ChoiceAnswer, type Distribution, type Turn } from "./jev";
import { NEWLINE_TOKEN, joinToken } from "./words";

export const OTHER = "<OTHER>";
export const END = "<END>";
export const NONE = "<NONE>";

const TAIL = 60;
const show = (s: string) => {
  const t = s.length > TAIL ? "…" + s.slice(-TAIL) : s;
  return JSON.stringify(t.replaceAll("\n", "↵"));
};

export interface Pick {
  distribution: Distribution;
  confidence: number;
  inputTokens: number;
  latencyMs: number;
}

async function askChoice(conversation: Turn[], reply: string, instructions: string, criteria: Record<string, string>, signal?: AbortSignal): Promise<Pick> {
  const state = { conversation, reply_so_far: reply };
  const started = performance.now();
  const res = await ask(state, { next: choice(instructions, criteria) }, signal);
  const a = res.answers.next as ChoiceAnswer;
  return {
    distribution: { ...a.probabilities },
    confidence: a.confidence,
    inputTokens: res.inputTokens,
    latencyMs: Math.round(performance.now() - started),
  };
}

const INTRO =
  "`conversation` is a chat between a user and a helpful, concise assistant. The assistant is writing its reply to the user's " +
  "last message; `reply_so_far` is what it has written.";

/** Next word or punctuation mark, from the common list; OTHER = an unlisted word, END = done. */
export function chooseToken(conversation: Turn[], reply: string, tokens: string[], signal?: AbortSignal): Promise<Pick> {
  const criteria: Record<string, string> = {};
  for (const t of tokens) {
    criteria[t] = t === NEWLINE_TOKEN ? `a line break: the reply continues as ${show(reply + "\n")}` : `the reply continues as ${show(joinToken(reply, t))}`;
  }
  criteria[OTHER] = "a specific word that is missing from this list (it will be looked up in a dictionary)";
  criteria[END] = `the reply is complete and ends here as ${show(reply)}`;
  return askChoice(
    conversation,
    reply,
    `${INTRO} Each option shows the reply continuing with one more word or punctuation mark. Which continuation leads to the best ` +
      "short, natural, correct reply? Choose the dictionary-lookup option if the ideal next word is missing from the list, and the complete option only " +
      "when the reply is finished.",
    criteria,
    signal,
  );
}

/** Narrow an unlisted word by its next letter; each group lists example words. */
export function chooseGroup(
  conversation: Turn[],
  reply: string,
  groups: { key: string; examples: string[] }[],
  signal?: AbortSignal,
): Promise<Pick> {
  const criteria: Record<string, string> = {};
  for (const g of groups) criteria[g.key] = `the next word starts with "${g.key}", like ${g.examples.join(", ")}`;
  return askChoice(
    conversation,
    reply,
    `${INTRO} Its next word is not a very common word, so it is being looked up in a dictionary by its first letters. ` +
      "Which group contains the ideal next word for a short, natural, correct reply?",
    criteria,
    signal,
  );
}

/**
 * Fan-out lookup: the whole first-letter bucket, split into lists of up to
 * 250 bare labels, asked as parallel Choices in one request. Returns each
 * list's winner (NONE excluded) with its probability. Narrowing further letter
 * by letter failed ("s…"→"se…"→"sen…" missed "seine"): Jev can't spell-reason.
 */
const CHUNKS_PER_REQUEST = 10; // ~2,500 bare labels: well under the 64k-token request limit

export async function chooseFromChunks(
  conversation: Turn[],
  reply: string,
  chunks: string[][],
  signal?: AbortSignal,
): Promise<{ winners: { word: string; p: number }[]; inputTokens: number; latencyMs: number }> {
  const instructions =
    `${INTRO} Its next word is not a very common word. Which word in this list is the ideal next word, continuing ` +
    `${show(reply)} into a short, natural, correct reply? Choose ${NONE} if none of them fits.`;
  const batches: string[][][] = [];
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_REQUEST) batches.push(chunks.slice(i, i + CHUNKS_PER_REQUEST));
  const started = performance.now();
  const results = await Promise.all(
    batches.map((batch) => {
      const questions = Object.fromEntries(
        batch.map((words, i) => [`c${i}`, choice(instructions, Object.fromEntries([...words.map((w) => [w, null]), [NONE, "none of these fits"]]))]),
      );
      return ask({ conversation, reply_so_far: reply }, questions, signal).then((res) => ({ res, n: batch.length }));
    }),
  );
  const winners: { word: string; p: number }[] = [];
  let inputTokens = 0;
  for (const { res, n } of results) {
    inputTokens += res.inputTokens;
    for (let i = 0; i < n; i++) {
      const a = res.answers[`c${i}`] as ChoiceAnswer;
      if (a.choice !== NONE) winners.push({ word: a.choice, p: a.probabilities[a.choice] });
    }
  }
  return { winners, inputTokens, latencyMs: Math.round(performance.now() - started) };
}

/** Pick the word itself from a small enough dictionary bucket; NONE = nothing fits. */
export function chooseWord(conversation: Turn[], reply: string, words: string[], signal?: AbortSignal): Promise<Pick> {
  const criteria: Record<string, string> = {};
  for (const w of words) criteria[w] = `the reply continues as ${show(joinToken(reply, w))}`;
  criteria[NONE] = "none of these words fits";
  return askChoice(
    conversation,
    reply,
    `${INTRO} Each option shows the reply continuing with one more word. Which continuation leads to the best short, natural, ` +
      "correct reply?",
    criteria,
    signal,
  );
}
