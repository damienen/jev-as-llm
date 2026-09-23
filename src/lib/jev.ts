// Talking to Jev: a small fetch client (no SDK, no server) that works the same
// in the browser and in Node, the question builders, and the judge.
//
// Browsers can only reach Jev through OpenRouter: api.typesafe.ai refuses
// cross-origin requests, while OpenRouter's Jev endpoint takes the same body
// and allows any origin. So the web app calls OpenRouter directly with the
// visitor's own key; nothing goes through a server of ours.

export type Role = "user" | "assistant";
export type Turn = {
  role: Role;
  text: string;
};

/** Label -> probability for one Choice question. */
export type Distribution = Record<string, number>;

// ---- questions (the same JSON shape TypeSafe's SDK builds) ---------------------

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: readonly string[] };
export const choice = (instructions: string, criteria: Record<string, string | null>): Question => ({ type: "choice", instructions, criteria });
export const score = (instructions: string, criteria: readonly string[]): Question => ({ type: "score", instructions, criteria });

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Distribution;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
}
export type Answer = ChoiceAnswer | ScoreAnswer;

// ---- provider -----------------------------------------------------------------

export type ProviderName = "openrouter" | "typesafe";
export const PROVIDERS: Record<ProviderName, { url: string; model: string }> = {
  // Works from browsers (Access-Control-Allow-Origin: *).
  openrouter: { url: "https://openrouter.ai/api/alpha/decisions", model: "typesafe/jev-1.13" },
  // Node only: api.typesafe.ai rejects cross-origin requests.
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest" },
};

let provider: { name: ProviderName; apiKey: string } | undefined;
/** Set once: the web app with the visitor's key, scripts from the environment. */
export function setProvider(name: ProviderName, apiKey: string) {
  provider = { name, apiKey: apiKey.trim() };
}

/** Scripts: pick the provider from the environment (OpenRouter first). */
export function providerFromEnv(): ProviderName {
  if (process.env.OPENROUTER_API_KEY) setProvider("openrouter", process.env.OPENROUTER_API_KEY);
  else if (process.env.TYPESAFE_API_KEY) setProvider("typesafe", process.env.TYPESAFE_API_KEY);
  else throw new Error("Set OPENROUTER_API_KEY or TYPESAFE_API_KEY (e.g. in .env).");
  return provider!.name;
}

export type JevErrorCode = "missing_key" | "invalid_key" | "no_credits" | "rate_limited" | "upstream" | "bad_request" | "bad_response" | "network";

export class JevError extends Error {
  constructor(public readonly code: JevErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = "JevError";
  }
}

function errorForStatus(status: number, detail: string): JevError {
  if (status === 401 || status === 403) return new JevError("invalid_key", `${status} ${detail}`, status);
  if (status === 402) return new JevError("no_credits", `402 ${detail}`, status);
  if (status === 429) return new JevError("rate_limited", `429 ${detail}`, status);
  if (status >= 500) return new JevError("upstream", `${status} ${detail}`, status);
  return new JevError("bad_request", `${status} ${detail}`, status);
}

/** One request: named questions about one state. Throws JevError. */
async function askOnce(
  state: unknown,
  questions: Record<string, Question>,
  signal?: AbortSignal,
): Promise<{ answers: Record<string, Answer>; inputTokens: number }> {
  if (!provider?.apiKey) throw new JevError("missing_key", "No API key");
  const { url, model } = PROVIDERS[provider.name];
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` };
  if (provider.name === "openrouter") headers["x-title"] = "Jev as LLM";
  const timeout = AbortSignal.timeout(30_000); // a slow step should not hang a generation forever
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, state, questions }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new JevError("network", "Request failed or timed out");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw errorForStatus(res.status, detail);
  }
  const body = (await res.json().catch(() => null)) as { answers?: Record<string, Answer>; usage?: { input_tokens?: number } } | null;
  if (!body?.answers) throw new JevError("bad_response", "Response has no answers");
  return { answers: body.answers, inputTokens: body.usage?.input_tokens ?? 0 };
}

const RETRYABLE: JevErrorCode[] = ["rate_limited", "upstream", "network", "bad_response"];

/** askOnce with up to two retries for transient failures; key and credit errors fail immediately. */
export async function ask(state: unknown, questions: Record<string, Question>, signal?: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(state, questions, signal);
    } catch (err) {
      const retry = err instanceof JevError && RETRYABLE.includes(err.code) && attempt < 3 && !signal?.aborted;
      if (!retry) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

// ---- judge: Jev scores whole candidate replies --------------------------------

export interface JudgeCandidate {
  text: string;
  final: boolean; // true: the reply ends here; false: more will be written
}

const JUDGE_LEVELS = [
  "hopeless: gibberish, wrong, ungrammatical or pointlessly repetitive",
  "poor: odd, unlikely or unhelpful",
  "plausible",
  "good: natural and correct",
  "excellent: exactly what a good reply looks like",
] as const;

// The candidate text goes straight into its question: pointing at
// `candidates[i]` among many near-identical strings (one level of
// indirection) flattened every score to ~2.4.
function judgeQuestion(text: string, final: boolean) {
  const c = JSON.stringify(text);
  return score(
    final
      ? `The assistant's complete, final reply to \`question\` is ${c} — nothing more will be added. How good is it as the whole reply?`
      : `The assistant's reply to \`question\` begins ${c}; more will be written after it and it may stop mid-word. ` +
          "How promising is it as the start of a correct, fluent, natural reply?",
    JUDGE_LEVELS,
  );
}

/** Score every candidate (0..4) in one request. */
export async function judge(
  conversation: Turn[],
  candidates: JudgeCandidate[],
  signal?: AbortSignal,
): Promise<{ scores: number[]; inputTokens: number; latencyMs: number }> {
  const questions = Object.fromEntries(candidates.map((c, i) => [`c${i}`, judgeQuestion(c.text, c.final)]));
  const state = { conversation, question: conversation[conversation.length - 1].text };
  const started = performance.now();
  const res = await ask(state, questions, signal);
  return {
    scores: candidates.map((_, i) => (res.answers[`c${i}`] as ScoreAnswer).score),
    inputTokens: res.inputTokens,
    latencyMs: Math.round(performance.now() - started),
  };
}
