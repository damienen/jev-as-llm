// Run one prompt with the given settings and print every step as it happens.
// Usage: npm run one -- "<prompt>" '{"temperature":0.5}'
// Uses OPENROUTER_API_KEY (preferred) or TYPESAFE_API_KEY from .env.
import { generate, normalizeSettings } from "../src/lib/decode";
import { providerFromEnv } from "../src/lib/jev";
try { process.loadEnvFile(); } catch {}

const provider = providerFromEnv();
const prompt = process.argv[2] ?? "Write a two-line poem about the sea.";
const s = normalizeSettings(JSON.parse(process.argv[3] ?? "{}"));
console.log(`provider: ${provider}`);
const t0 = Date.now();
const r = await generate([{ role: "user", text: prompt }], s, (e) => {
  console.log(`${String(e.step).padStart(3)} ${String(e.latencyMs).padStart(6)}ms ${String(e.inputTokens).padStart(6)}tok  ${JSON.stringify(e.label).padEnd(22)} ${JSON.stringify(e.text.slice(-70))}`);
}, new AbortController().signal);
console.log(`\n${r.stopReason} after ${r.steps} steps, ${r.inputTokens} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s${r.error ? ", error: " + r.error : ""}\n${r.text}`);
