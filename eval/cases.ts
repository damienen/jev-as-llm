// Eval cases: a prompt plus automatic checks on the reply (lowercase text).
// "tuning" prompts were used while building the decoder; "holdout" prompts
// never were, so they show whether it generalises.

export interface EvalCase {
  id: string;
  split: "tuning" | "holdout";
  prompt: string;
  /** What a correct reply must contain; each check has a label for the report. */
  checks: { label: string; test: (reply: string) => boolean }[];
}

const has = (re: RegExp, label = re.source) => ({ label, test: (r: string) => re.test(r) });
const countOf = (words: string[], n: number, label: string) => ({
  label,
  test: (r: string) => words.filter((w) => new RegExp(`\\b${w}\\b`).test(r)).length >= n,
});

export const CASES: EvalCase[] = [
  // tuning
  { id: "greeting", split: "tuning", prompt: "Hi there! How are you today?", checks: [has(/\b(good|fine|well|great)\b/, "says how it is")] },
  { id: "japan", split: "tuning", prompt: "What is the capital of Japan?", checks: [has(/\btokyo\b/)] },
  { id: "count", split: "tuning", prompt: "Count from 1 to 5, separated by commas.", checks: [has(/1\D+2\D+3\D+4\D+5/, "1 to 5 in order")] },
  { id: "poem", split: "tuning", prompt: "Write a two-line poem about the sea.", checks: [has(/\b(sea|ocean|waves?|tide)\b/, "about the sea")] },
  { id: "code", split: "tuning", prompt: "Write a Python function that returns the square of a number.", checks: [has(/\bdef\b/), has(/\breturn\b/)] },
  { id: "sun", split: "tuning", prompt: "Is the sun a star? Answer yes or no.", checks: [has(/^yes\b/, "starts with yes")] },
  // holdout
  { id: "sky", split: "holdout", prompt: "What color is the sky on a clear day?", checks: [has(/\bblue\b/)] },
  { id: "cats", split: "holdout", prompt: "Tell me one fun fact about cats.", checks: [has(/\bcats?\b/, "mentions cats")] },
  { id: "math", split: "holdout", prompt: "What is 2 + 2?", checks: [has(/\b(4|four)\b/, "4")] },
  { id: "author", split: "holdout", prompt: "Who wrote Romeo and Juliet?", checks: [has(/\bshakespeare\b/)] },
  { id: "fruits", split: "holdout", prompt: "Name three fruits.", checks: [countOf(["apple", "banana", "orange", "cherry", "grape", "pear", "mango", "peach", "lemon", "strawberry", "plum", "kiwi", "apricot", "fig", "melon", "pineapple"], 3, "three fruits")] },
  { id: "sleep", split: "holdout", prompt: "I can't sleep. Any tips?", checks: [has(/\b(sleep|bed|relax|screens?|caffeine|routine|dark|breath\w*)\b/, "on-topic tip")] },
  { id: "france", split: "holdout", prompt: "What is the capital of France, and what river runs through it?", checks: [has(/\bparis\b/), has(/\bseine\b/)] },
  { id: "thanks", split: "holdout", prompt: "Thanks for your help!", checks: [has(/\b(welcome|pleasure|anytime|glad|problem)\b/, "polite reply")] },
  { id: "planet", split: "holdout", prompt: "What is the largest planet in our solar system?", checks: [has(/\bjupiter\b/)] },
  { id: "week", split: "holdout", prompt: "How many days are in a week?", checks: [has(/\b(7|seven)\b/, "7")] },
  { id: "opposite", split: "holdout", prompt: "What is the opposite of hot?", checks: [has(/\bcold\b/)] },
  { id: "bees", split: "holdout", prompt: "What do bees make?", checks: [has(/\bhoney\b/)] },
  { id: "spanish", split: "holdout", prompt: "How do you say hello in Spanish?", checks: [has(/\bhola\b/)] },
  { id: "bye", split: "holdout", prompt: "I have to go now. Goodbye!", checks: [has(/\b(bye|goodbye|farewell|see you|take care)\b/, "says goodbye")] },
];
