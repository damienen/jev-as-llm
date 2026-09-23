// Record real Jev runs for the site's no-key demos.
//   npx tsx scripts/record-demos.ts                 record all candidates -> scripts/demo-candidates.json
//   npx tsx scripts/record-demos.ts pick id1,id2..  copy the chosen ones  -> src/lib/demos.json
// Uses OPENROUTER_API_KEY (or TYPESAFE_API_KEY) from .env and the site's exact settings.
import { readFile, writeFile } from "node:fs/promises";
import { DEFAULTS, generate, type StepEvent } from "../src/lib/decode";
import { providerFromEnv } from "../src/lib/jev";
try { process.loadEnvFile(); } catch {}

export interface Demo {
  id: string;
  prompt: string;
  text: string;
  stopReason: string;
  ms: number;
  steps: Omit<StepEvent, "step">[];
}

const CANDIDATES: [string, string][] = [
  ["france", "What is the capital of France, and what river runs through it?"],
  ["fruits", "Name three fruits."],
  ["bees", "What do bees make?"],
  ["thanks", "Thanks for your help!"],
  ["japan", "What is the capital of Japan?"],
  ["count", "Count from 1 to 5, separated by commas."],
  ["greeting", "Hi there! How are you today?"],
  ["sky", "What color is the sky on a clear day?"],
  ["cats", "Tell me one fun fact about cats."],
  ["ocean", "What is the largest ocean on Earth?"],
  ["poem", "Write a two-line poem about the sea."],
  ["planets", "Name a planet with rings."],
];

if (process.argv[2] === "pick") {
  const ids = (process.argv[3] ?? "").split(",");
  const all: Demo[] = JSON.parse(await readFile("scripts/demo-candidates.json", "utf8"));
  const picked = ids.map((id) => all.find((d) => d.id === id) ?? Promise.reject(new Error(`no demo ${id}`)));
  await writeFile("src/lib/demos.json", JSON.stringify(picked));
  console.log(`src/lib/demos.json: ${ids.join(", ")}`);
} else {
  providerFromEnv();
  const demos = await Promise.all(
    CANDIDATES.map(async ([id, prompt]) => {
      const steps: Demo["steps"] = [];
      const t0 = Date.now();
      const r = await generate([{ role: "user", text: prompt }], DEFAULTS, ({ step, ...e }) => { steps[step] = e; }, new AbortController().signal);
      const demo: Demo = { id, prompt, text: r.text, stopReason: r.stopReason, ms: Date.now() - t0, steps };
      console.log(`${id.padEnd(9)} ${r.stopReason.padEnd(9)} ${String(steps.length).padStart(2)} steps  ${JSON.stringify(r.text)}`);
      return demo;
    }),
  );
  await writeFile("scripts/demo-candidates.json", JSON.stringify(demos, null, 1));
}
