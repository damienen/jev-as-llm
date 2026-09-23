# Jev as LLM

An experiment: how close can [TypeSafe](https://docs.typesafe.ai)'s Jev get to chatting like an LLM? Jev is a System One model that returns typed judgments and probabilities, and it was never trained to write. **The full story (every attempt, result and decision, including the approaches that failed and were removed) is in [EXPERIMENT_LOG.md](EXPERIMENT_LOG.md).**

It's a Next.js app built for Vercel's free Hobby plan.

## Your key never touches our server

The chat runs entirely in the visitor's browser, which calls Jev through OpenRouter with the visitor's own OpenRouter key:

```
Browser (Next.js page, client component)                      OpenRouter
  decoder, dictionary, UI ──── visitor's key, per request ────▶ /api/alpha/decisions (Jev 1.13)
        │
        └── anonymous usage count ──▶ /api/t on this site (numbers only, logged)
```

- The key is stored in the browser (localStorage) and sent only to `openrouter.ai`.
- The site sends a `Content-Security-Policy` header with `connect-src 'self' https://openrouter.ai`, so the browser refuses to send data anywhere else. Anyone can check it in the Network tab or the response headers.
- `/api/t` keeps only step count, tokens, time, lookups and stop reason, and drops any other field. It writes one `jev-telemetry {...}` line per reply to the function logs. Set `NEXT_PUBLIC_TELEMETRY=off` to turn it off.
- Why OpenRouter: `api.typesafe.ai` rejects browser requests from other sites (CORS), while OpenRouter serves the same Jev with the same request format and allows any origin.

## How it works

Jev can't write, but it's good at picking the best option from a list. So the app turns writing into a series of multiple-choice questions, one per word:

1. **Pick the next word.** Jev picks from about 250 options: words from the conversation, common English words, punctuation, **look up** and **stop**. Each option shows the reply continuing with that word.
2. **Look up a word that isn't listed.** If Jev chooses look up, it picks likely first letters. Then every dictionary word starting with those letters (up to about 9k, out of 75k) is searched as parallel 250-option Choices in one round trip. The dictionary is a separate chunk, loaded on first use.
3. **Code handles the mechanics:** spacing, a/an agreement, and guards against repetition and loops. Output is lowercase.

An optional **judge** (Jev scoring the top candidates as whole replies) exists but is off: in the eval it cost about 1.7× as much for no net gain.

## Run and deploy

```bash
npm install
npm run dev                  # http://localhost:3000, paste your OpenRouter key in the page
npm run build && npm start   # production build locally
```

**Deploy to Vercel:** import the repo at vercel.com/new (framework: Next.js, no settings or environment variables needed), or run `npx vercel`. The Hobby plan is free for personal, non-commercial projects.

Scripts (they read `OPENROUTER_API_KEY`, or else `TYPESAFE_API_KEY`, from `.env`):

```bash
npm run one -- "Name three fruits."          # one prompt, step by step
npm run eval                                 # eval suite -> results/eval-*.md (add "judge,nojudge" to compare)
npm run build:vocab                          # regenerate src/lib/generated/vocab.json from the word lists
```

## Layout

| Path | What |
|---|---|
| `src/components/` | The chat UI (client components; all Jev calls happen in the browser): `JevChat`, `ReplyText` (word chips), `Inspector`, `KeyEntry`, `BottomSheet` |
| `src/lib/demos.json`, `scripts/record-demos.ts` | Recorded runs that visitors without a key can replay, and the script that records them |
| `src/app/` | `layout.tsx`, `page.tsx`, `globals.css`, `icon.svg`, `opengraph-image.tsx` (link preview) and `api/t/route.ts` (anonymous telemetry) |
| `next.config.ts` | Security headers, including the Content-Security-Policy |
| `src/lib/decode.ts` | The decoder loop: word choice, lookup, optional judge, rules, context window |
| `src/lib/wordgen.ts` | The Jev questions: next word, first letter, dictionary lists, final pick |
| `src/lib/jev.ts` | Fetch client for OpenRouter (browser and Node) or TypeSafe (Node only), errors, judge |
| `src/lib/words.ts`, `src/lib/vocab.ts`, `src/lib/generated/vocab.json` | Candidate word list and spacing rules; the 75k-word dictionary |
| `scripts/` | Single-prompt runner, demo recorder and dictionary build |
| `eval/` | Eval cases (20 prompts with automatic checks) and the runner |
| `results/` | Eval reports and the transcripts quoted in the experiment log |
