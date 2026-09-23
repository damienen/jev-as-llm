// Eval runner: every case under each config, scored automatically.
// Usage: npx tsx eval/run.ts [nojudge|judge|judge,nojudge] [maxChars]   (default: nojudge)
// Writes results/eval-<timestamp>.md and prints the summary.
import { mkdir, writeFile } from "node:fs/promises";
import { generate, normalizeSettings, type Settings } from "../src/lib/decode";
import { judge, providerFromEnv } from "../src/lib/jev";
import { CASES, type EvalCase } from "./cases";
try { process.loadEnvFile(); } catch {}
const provider = providerFromEnv(); // OPENROUTER_API_KEY first, else TYPESAFE_API_KEY

const CONFIGS: Record<string, Partial<Settings>> = {
  judge: { rerank: true },
  nojudge: { rerank: false },
};
const names = (process.argv[2] ?? "nojudge").split(",");
const maxChars = Number(process.argv[3] ?? 150);
const CONCURRENCY = 4; // stay well under TypeSafe's rate limits
const USD_PER_TOKEN = 0.042 / 1e6;

/** Mechanical signs of a broken reply that code can check without a model. */
function hygiene(reply: string): string[] {
  const problems: string[] = [];
  if (!reply.trim()) problems.push("empty");
  if (/\b(\w+) \1\b/.test(reply)) problems.push("repeated word");
  if (/\b(a|an|the)\s*[.,!?:]/.test(reply)) problems.push("dangling article");
  const words = reply.match(/[a-z0-9']+/g) ?? [];
  const bigrams = words.slice(1).map((w, i) => words[i] + " " + w);
  if (bigrams.some((b) => bigrams.filter((x) => x === b).length >= 3)) problems.push("loop");
  return problems;
}

interface Row {
  config: string;
  c: EvalCase;
  text: string;
  finished: boolean;
  failed: string[]; // labels of checks that failed
  problems: string[];
  quality: number; // Jev's 0-4 score of the final reply
  tokens: number;
  seconds: number;
  error?: string;
}

async function runOne(config: string, c: EvalCase): Promise<Row> {
  const s = normalizeSettings({ ...CONFIGS[config], maxChars });
  const conversation = [{ role: "user" as const, text: c.prompt }];
  const t0 = Date.now();
  const r = await generate(conversation, s, () => {}, new AbortController().signal);
  const q = r.text ? await judge(conversation, [{ text: r.text, final: true }]) : { scores: [0], inputTokens: 0 };
  return {
    config,
    c,
    text: r.text,
    finished: r.stopReason === "end",
    failed: c.checks.filter((k) => !k.test(r.text.toLowerCase())).map((k) => k.label),
    problems: hygiene(r.text.toLowerCase()),
    quality: q.scores[0],
    tokens: r.inputTokens, // the quality score's tokens are eval overhead, not reply cost
    seconds: (Date.now() - t0) / 1000,
    error: r.error,
  };
}

// Simple worker pool.
const jobs = names.flatMap((n) => CASES.map((c) => () => runOne(n, c)));
const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const row = await job();
      rows.push(row);
      console.log(`${row.config.padEnd(8)} ${row.c.id.padEnd(9)} ${row.failed.length || row.problems.length ? "FAIL" : "pass"}  q=${row.quality.toFixed(1)}  ${JSON.stringify(row.text).slice(0, 70)}`);
    }
  }),
);

const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(d, 1))}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
let md = `# Eval, ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n`;
md += `Provider: ${provider}. ${CASES.length} cases (${CASES.filter((c) => c.split === "tuning").length} tuning, ${CASES.filter((c) => c.split === "holdout").length} holdout), max ${maxChars} characters, temperature 0.\n\n`;
md += "| Config | Pass | Pass (holdout) | Correct | Clean | Finished | Quality (0-4) | Cost | Avg time |\n|---|---|---|---|---|---|---|---|---|\n";
const pass = (r: Row) => !r.failed.length && !r.problems.length;
for (const n of names) {
  const rs = rows.filter((r) => r.config === n);
  const ho = rs.filter((r) => r.c.split === "holdout");
  md += `| ${n} | ${pct(rs.filter(pass).length, rs.length)} | ${pct(ho.filter(pass).length, ho.length)} | ${pct(rs.filter((r) => !r.failed.length).length, rs.length)} | ${pct(rs.filter((r) => !r.problems.length).length, rs.length)} | ${pct(rs.filter((r) => r.finished).length, rs.length)} | ${mean(rs.map((r) => r.quality)).toFixed(2)} | $${(rs.reduce((a, r) => a + r.tokens, 0) * USD_PER_TOKEN).toFixed(3)} | ${mean(rs.map((r) => r.seconds)).toFixed(1)} s |\n`;
}
md += "\n**Pass** = correct and clean (the headline number). **Correct** = all checks for the case pass. **Clean** = no empty reply, repeated word, dangling article or loop. **Quality** = Jev's own 0-4 score of the final reply (biased toward the judge config, which optimises the same score).\n\n";
md += `| Case | Split | ${names.join(" | ")} |\n|---|---|${names.map(() => "---|").join("")}\n`;
for (const c of CASES) {
  const cell = (n: string) => {
    const r = rows.find((x) => x.config === n && x.c.id === c.id)!;
    const mark = pass(r) ? "✓" : "✗";
    const notes = [...r.failed.map((f) => `missing ${f}`), ...r.problems, r.error ? `error: ${r.error}` : ""].filter(Boolean).join(", ");
    return `${mark} \`${r.text.replaceAll("\n", " ↵ ").replaceAll("|", "\\|")}\`${notes ? ` (${notes})` : ""}`;
  };
  md += `| ${c.prompt} | ${c.split} | ${names.map(cell).join(" | ")} |\n`;
}
await mkdir("results", { recursive: true });
const file = `results/eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
await writeFile(file, md);
console.log(`\n${md.split("\n\n")[1]}\n${md.split("\n\n")[2]}\n\nWrote ${file}`);
