// Build src/lib/generated/vocab.json: the lookup dictionary as plain data, so the
// decoder runs in the browser without Node-only word-list packages.
// Rank 0 = country and capital names, then SCOWL tiers 10..60 (lower = commoner).
import { countries } from "countries-list";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const scowl: Record<string, string[]> = createRequire(import.meta.url)("wordlist-english");
const TIERS = ["english/10", "english/20", "english/35", "english/40", "english/50", "english/55", "english/60"];

const rank = new Map<string, number>();
const put = (w: string, r: number) => {
  const k = w.toLowerCase();
  if (!rank.has(k) || rank.get(k)! > r) rank.set(k, r);
};
for (const c of Object.values(countries)) {
  put(c.name, 0);
  if (c.capital) put(c.capital, 0);
}
TIERS.forEach((tier, t) => {
  for (const w of scowl[tier]) if (/^[A-Za-z][A-Za-z'-]*$/.test(w)) put(w, 1 + t);
});

const byRank: string[][] = Array.from({ length: TIERS.length + 1 }, () => []);
for (const [w, r] of rank) byRank[r].push(w);
for (const words of byRank) words.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

await mkdir("src/lib/generated", { recursive: true });
const json = JSON.stringify({ byRank });
await writeFile("src/lib/generated/vocab.json", json);
console.log(`vocab.json: ${rank.size} words, ${(json.length / 1024).toFixed(0)} KB`);
