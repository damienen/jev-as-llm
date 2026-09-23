# Experiment log: making Jev work like an LLM

Jev (TypeSafe's System One model, `jev-1.13`) answers typed questions (Choice / Score / Noul) with probabilities. The docs say it "is not trained to generate text". The question: how close can we get to an LLM chat by composing those judgments?

All transcripts are in `results/`, and every generation (settings, per-step distributions, token usage) is in `runs/*.jsonl`. Six fixed probe prompts (`src/presets.ts`) are used throughout: greeting, capital of Japan, count 1–5, two-line sea poem, Python square function, "is the sun a star?".

Cost reference: Jev charges $0.042 per million input tokens, and output is free.

---

## Setup decisions (design interview, before any code)

| Decision | Choice | Why |
|---|---|---|
| Goal | An honest probe with some demo polish | A quick experiment, not a benchmark |
| Granularity | **Characters**: every step is one Choice over 97 options (95 printable ASCII + `NEWLINE` + `<END>`) | The purest "LLM loop", even though it's slow |
| Mode | Multi-turn chat; `<END>` ends the reply | |
| Stack | Node/TS server with SSE plus one static HTML page | Node was already installed; no build step |
| Decoding | Temperature sampling (T=0 is greedy) and beam search (k beams asked in one request) | Beam search uses TypeSafe's speculative fan-out |
| Context | 24k-token sliding window (Jev allows 32k for state plus one question) | |
| Limits | Deferred to `LIMITS-TODO.md`; the URL stays private until they exist | |
| Prior art | [afanjul/jev-llm](https://github.com/afanjul/jev-llm): Python CLI, lowercase char mode plus word modes, no published results | We used ideas only; no license, so no code was copied |

---

## Attempt 1: bare character Choice (`pure` vs `aided`)

- **pure:** state = `{conversation, reply_so_far}`, with the question "which single character comes next?".
- **aided:** also includes `current_partial_word` and `last_char`.

Results (`results/greedy.md`, `results/beam-pure-aided.md`):

| Prompt | pure | aided |
|---|---|---|
| greeting | `H` then 199 spaces | `Hhhh h h h…` |
| fact | `A` then spaces | `A A A A…` |
| count | `1,23,4,5` END | `1,2,3,4,5` END ✓ |
| yes/no | `Y` END ✓ | `Y` END ✓ |

About 300 ms and 2.1k tokens per character. Beam search (k=3) gave the same attractors.

**Diagnosis:** Jev answers "which character fits this reply?", not "which character comes next at this position". In pure mode a trailing space is invisible, so it keeps picking `SPACE`. In aided mode it loops on word-initial letters. It does know when a reply is complete (`<END>` at 0.88–1.00).

## Attempt 2: tell Jev the truth (`framed`), make whitespace visible (`visible`)

This was the user's idea: explain that Jev is called once per character to spell out the best reply. `visible` also draws spaces as `␣` / `↵` and adds a character count.

Results (`results/modes-framed-visible.md`):
- **framed:** first real word (`Hi`), clean `1,2,3,4,5`, then back to spaces.
- **visible:** replies end on their own at plausible lengths, but the text is gibberish (`AC a a`, `Waaa aa`).

**Decision:** the framing isn't the problem. The problem is fine-grained positional choice.

## Attempt 3: options are whole candidate replies (`prefix`)

"Select instead of generate": each of the 97 options describes the reply *with that character appended* (the last 40 characters), not "the letter n".

- Probe: after "The capital of Fra", `n` came out on top (0.25). No earlier mode had `n` in its top 5. After "…is Pa" → `r` 0.44.
- Presets (`results/modes-prefix.md`): `f(x)=x*x` ✓, `1,2,3,4,5` ✓, `Hi ! I m a a a…`, `A cat`. Every preset ended on its own.
- Beam k=3 in prefix mode (`results/beam-prefix.md`): no better, and 4× the tokens.

**Decision:** the best so far. Jev can continue a word, but it can't choose what the next word should be.

## Attempt 4: dictionary lookahead in the options (`lexicon`)

Each letter option also lists the words it could become (`[spelling capital, can, car]`). The word list is SCOWL tiers 10/20/35 via `wordlist-english`, plus words from the conversation.

- v1 (`results/modes-lexicon.md`): `Yes` ✓, real words appear, but capitalisation is chaotic (`CAPITAL Is A TaiL`) and words repeat (`am am am`).
- v2, with completions shown as typed, a flag on capitals inside a word, `words_written` in the state and an anti-repetition instruction (`results/modes-lexicon2.md`): worse (`a as as as`, `aardvark`).

**Diagnosis:** Jev picks the option whose *annotated words* are most related to the question (keyword echo). `a` wins at every word start because its completions are the commonest words.

## Attempt 5: Jev as a judge (propose-and-judge search)

Probe (`scripts/judge-probe.ts`): one Score question per candidate reply. Jev is an excellent judge: `Hi am a am am` 0.01, `A cat` 0.17, `Hi! I'm doing well, thanks.` 3.96/4, and `…Japan is T` 2.90 vs `…Japan is K` 1.42 (it knows the answer is Tokyo).

- v1: prefix mode proposes the top 4 characters per beam, then a second request judges each extended reply (`results/judge-prefix.md`): `We see a sea / as a say.`, `f(x):↵  r=x**2`, `Hi!`, `1,2,3,4,5`, `Y.`. The fact question failed because the proposer never offered `k` after `To`.
- v2: judge **all 97 extensions** per beam in one request. With the candidate text referenced by index (`candidates[i]`), every score flattened to about 2.4. That's the indirection weakness the Jev docs mention. With the text inlined into each question, the signal came back (`To`→`k` 3.46, `Hi! I`→`'` 3.31), but the judge also rated stray symbols highly (`Tok{` 3.66) because it reads past them.
- v2 + proposer prior in the same request (`results/judge2-prefix-v2.md`): `Yes` ✓, `1,2,3,4,5` ✓, the rest poor. The judge can't see whitespace (`Hi! I` plus 10 spaces still scores about 3.0). Roughly 30k tokens per character.
- v3: typography rules in code (no double spaces except indentation, no space before `.,!?;:`, no capital after a lowercase letter), plus word lookahead for the judge (`results/judge1-lookahead.md`): `Hi How arest rest` (question echo again).

**Decision:** character-level choice fails at the same point in every variant. **Choosing which word comes next, one letter at a time, is beyond Jev.** It does well at continuing a word, judging whole replies and knowing facts.

## Attempt 6: word-level choice (hybrid)

At each word boundary, one Choice picks the next *word* from about 250 candidates: conversation words, common English words, punctuation, plus `<OTHER>` and `<END>`. Each option shows the reply continuing with that word (`scripts/word-probe.ts`).

- Fact: `The`→`capital` 0.66→`is` 0.65. At `…Japan is`, `<OTHER>` 0.60 (Tokyo isn't listed). After `…Tokyo` → `.` 0.72, then `<END>` 0.98.
- Greeting: `Hi`→`I'm`→`good`/`well`→`.`/END.
- Poem: `The`→`sea` 0.53→`is` 0.80.
- About 5–7k tokens per *word*, which is cheaper than character mode.

**Spelling unlisted words letter by letter** (`scripts/spell-probe.ts`) fails: `T` 0.85 is correct, then `Taia`. For France it gave `CAP`.

**Decision:** unlisted words should also be *chosen*, not spelled. Narrow a large vocabulary (SCOWL plus country and capital names from `countries-list`) by first letter until a bucket has ≤250 words, then choose among them.

### Attempt 6 result: word decoder v1 (`results/words-v1.md`)

`src/wordgen.ts` + `runWords` in `src/decode.ts`. Each step is one Choice over about 250 tokens: conversation words, punctuation, the digits 1–10, about 230 common words, plus `<OTHER>` and `<END>`. `<OTHER>` goes to a 38k-word dictionary (SCOWL plus 250 countries and capitals). Jev narrows it by first letters, with example words for each group, until a bucket is ≤250 words, then picks the word. Code owns spacing and sentence capitalisation.

| Prompt | Reply |
|---|---|
| greeting | `Hi there I'm fine thanks` |
| fact | `The capital is Tokyo.` (Tokyo via `<OTHER>` → `t…` → `to…` → Tokyo) |
| count | `1, 2, 3, 4, 5` |
| poem | `The sea is a an azure. And the shimmers.` |
| code | `Def function square (x:): return x * x` |
| yes/no | `Yes` |

About **$0.012 for all six** (vs $0.14–0.47 for the character variants), and 1–10 s per reply. **This is the first version that reads like an LLM.**

## Attempt 7: rerank, lowercase, guards (`results/words-v2-lowercase.md`)

- **Judge rerank:** the word Choice's top candidates (6, later 8) plus `<END>` are each scored as a whole reply by a Score question in one request. The winner is judge score + 0.3·log p.
- **Lowercase only** (user decision): capitalisation caused more trouble (`Def`, `CAPITAL`) than it was worth.
- **Bug: an endless loop.** A second `NEWLINE` after a line break left the reply unchanged, so the character cap never triggered. One poem ran 172 steps (about $0.10). Fixes: a hard step cap, and candidates that don't grow the reply are dropped.
- `a` → `an` agreement is done by code.

| Prompt | greedy | rerank |
|---|---|---|
| greeting | `i'm fine thanks how are you` | `hi there i'm fine thanks how are you?` |
| fact | `it's the tokyo.` | `it's tokyo.` |
| count / yes-no | ✓ / ✓ | ✓ / ✓ |
| code | `def square (x): return x * x` | same |
| poem | weak | weak |

## Attempt 8: held-out prompts (never used for tuning)

`HOLDOUT` in `src/presets.ts` has 8 prompts: sky colour, a cat fact, 2+2, the author of Romeo and Juliet, three fruits, sleep tips, France's capital and river, and "thanks".

- First run (`results/words-holdout-v2.md`): sky, 2+2 and France (partly) were OK. The rest broke: `an an apricot`, `the. the. the.`, `you're am glad`.
- Grammar rules in code (an article is never followed by punctuation or another article), `<END>` always judged, rerank widened to 8 (`results/words-holdout-v3.md`): no better.
- **Bug found:** a shell heredoc turned `/\s+/` into `/s+/`. "Last word" was really the text after the last letter *s*, so the repetition and article checks had silently never worked. After fixing it, plus reducing punctuation to `. , ! ? :` and line break (**user decision**: `- * ( ) "` produced junk like `- a, -. -. -.`), see `results/words-v3.md` and `results/words-holdout-v4.md`.
- **Diagnosis from the traces:** Jev *wants* specific words (`<OTHER>` at 0.3–0.9), but the dictionary lookup failed. Narrowing letter by letter hits the same weakness as character mode: `s…`→`se…`→`sen…` missed "seine", and `f…`→`fr…`→`fru…` echoed "fruits". The "other word" option text also contained the word *other*, which leaked into replies. It was reworded.

## Attempt 9: fan-out dictionary lookup (`results/words-holdout-v5-fanout.md`)

`scripts/lookup-probe.ts` → `lookUp` in `src/decode.ts`:
1. A first-letter Choice (26 options with example words). Take the top letters with p ≥ 0.1, up to 3, because the top letter often echoes the question (`f` for fruits, `y` after "you're").
2. Every dictionary word under those letters (up to about 9k for `s`) is split into lists of 250 bare labels, asked as **parallel Choices**, 10 lists per request, with requests run in parallel. Probe result: `seine` = 0.99 out of 8,742 candidates in one round trip.
3. A final Choice among the per-list winners, with each option showing the reply continuing.

About 30–150k tokens per lookup ($0.001–0.006). Only triggered when `<OTHER>` ≥ 0.15. The vocabulary grew to 75k words (SCOWL tiers 10–60 plus countries and capitals). The first attempt hit a 64k-token request limit (`max_tokens_exceeded`), and client errors are no longer retried.

Held-out results: `apple, banana and orange.`, `the capital is paris and the river is seine.`, `the cats that have a calico are only she cats.` Two small fixes followed: no pronoun after an article (`an i`, `the it's`), and chat staples (`welcome`, `anytime`, …) added to the common list.

---

## Final results (`results/final-tuning.md`, `results/final-holdout.md`)

Word decoder with rerank and fan-out lookup, greedy (T=0), lowercase.

| Prompt | Reply | OK? |
|---|---|---|
| Hi there! How are you today? | `i'm fine thanks. how are you?` | ✓ |
| What is the capital of Japan? | `it's tokyo.` | ✓ |
| Count from 1 to 5, separated by commas. | `1, 2, 3, 4, 5` | ✓ |
| Write a two-line poem about the sea. | `sure i'll write a poem:↵the sea is a sapphire and a pearl.` | ✓ |
| Write a Python function that returns the square of a number. | `def square,↵: n: return…` | ✗ (no `( ) *` since punctuation was reduced) |
| Is the sun a star? Answer yes or no. | `yes` | ✓ |
| *held-out:* What color is the sky on a clear day? | `it's blue.` | ✓ |
| *held-out:* Tell me one fun fact about cats. | `sure i'll tell you a fun fact: the cats are carnivores.` | ✓ |
| *held-out:* What is 2 + 2? | `4` | ✓ |
| *held-out:* Who wrote Romeo and Juliet? | `the is by an all is by the wrote.` | ✗ (no personal names in any vocabulary) |
| *held-out:* Name three fruits. | `sure, here are three fruits: apple, banana and cherry` | ✓ |
| *held-out:* I can't sleep. Any tips? | `…1. try to get a good sleep.↵2 try to be a good day.` | ~ |
| *held-out:* Capital of France and its river? | `the capital is paris and the river is the seine.` | ✓ |
| *held-out:* Thanks for your help! | `welcome` | ✓ |

**12 of 14 reasonable.** Replies take 1–20 s and cost $0.0005–0.04 each (mostly dictionary lookups).

## What we learned

1. **Jev can't generate text character by character.** Framing, visible whitespace, candidate-reply options, dictionary hints and a judge all failed at the same point: choosing *which word comes next* one letter at a time. It can continue a word already underway.
2. **Jev is good at comparing distinct, readable alternatives.** A Choice whose options are the reply continued by one *whole word* reads like an LLM. It knows facts (Tokyo, Paris, Seine, carnivores) and knows when a reply is finished (`<END>` at 0.9+).
3. **Jev is an excellent judge of whole replies** (Score 0–4), which makes it a good reranker. It reads past whitespace and stray symbols, though, so typography has to live in code.
4. **Anything spelled, counted or positional fails**, as the Jev docs warn: letter-by-letter narrowing, spelling, and `candidates[i]` indirection among near-identical strings (all scores flattened to ~2.4).
5. **Fan-out is the key trick.** One request can hold dozens of independent Choices, so a 9k-word dictionary bucket is searched in one round trip.
6. **Code owns the mechanics:** spacing, a/an agreement, "an article is followed by a word", no-progress and repetition guards, step caps. Jev owns the semantics.
7. **Two bugs cost real time** (the endless NEWLINE loop, and a regex mangled by shell escaping). Inspecting the per-step traces in `runs/*.jsonl` found both.

## Known limitations

- The vocabulary has no personal names (Shakespeare), so questions about people fail.
- Code answers suffer from the reduced punctuation set.
- Everything is lowercase.
- Open-ended replies are short and plain, and sometimes ungrammatical.

## Cost

About **$2.35** in total, including all failed variants. The character-level attempts were the expensive part ($0.14–0.47 per six-prompt round). A word-decoder round on six prompts costs $0.01–0.12.

## Cleanup (after the experiment)

The code keeps **only the word decoder**. Everything else was deleted:
- the character-level decoders (sample, beam, character-judge)
- the six state modes (pure, framed, visible, aided, prefix, lexicon)
- `src/charset.ts` and `src/lexicon.ts`
- the one-off probe scripts
- the old `compare.ts` runner

This log and the transcripts in `results/` are the record of those attempts. The file names above that no longer exist (`scripts/*-probe.ts`, `scripts/compare.ts`) are kept for reference only.

`compare.ts` was replaced by an **eval suite** (`eval/`): 20 prompts (6 tuning, 14 held out) with automatic checks, run with and without the judge. See the next section.

## Eval: is the judge worth it? (`results/eval-2026-09-23-13-37.md`)

There are 20 prompts in `eval/cases.ts` (6 tuning, 14 held out). Each has automatic checks: *correct* means it contains the expected answer, e.g. `tokyo` or `1..5`; *clean* means no empty reply, repeated word, dangling article or loop. Each prompt ran once with the judge on and once with it off, greedy, max 150 characters.

| Config | Correct | Clean | Correct **and** clean | Cost | Avg time |
|---|---|---|---|---|---|
| judge on | 16/20 | 18/20 | **14/20** | $0.45 | 13.3 s |
| judge off | 14/20 | 20/20 | **14/20** | $0.26 | 6.4 s |

- **The judge fixes facts.** Without it: `it's the capital of japan.` (no Tokyo) and `a feline is a carnivore.` (no cats). With it: `it's tokyo.` and a calico-cat fact.
- **The judge also causes loops.** The sleep tips ended in `more. more. more…` and the code answer ended in `: x ↵ : x ↵ …`. The judge scores each continuation as a "promising start", so repeating a short pattern keeps scoring OK, and the no-repeat rule only blocks *immediate* repeats.
- **Both configs fail the same four prompts**, for two reasons:
  - Missing vocabulary: Shakespeare, Jupiter and hola are not in the dictionary.
  - Model error: `they make beeswax` / `a beehive` instead of honey.
- **Verdict:** a tie on the strict score, at about 1.7× the cost and 2× the time. The judge is worth keeping only if its loops are fixed. One run of 20 prompts is noisy; a 1–2 prompt difference is not significant.
- The first report counted "correct" without "clean", so looping replies still passed. The runner now reports **pass = correct and clean** as the headline.

## Decisions after the eval

- **Judge off by default** (user decision): it costs about 1.7× as much and takes 2× as long for no net gain. The code stays, so it can be re-evaluated (`npm run eval -- judge,nojudge`) once the loop problem is fixed. The UI no longer offers it.
- **Bring your own key** (user decision): the website uses each visitor's TypeSafe key, sent per request and never logged. The server's key is only used for web requests with `SERVER_KEY_FALLBACK=1`.
- The TypeSafe account used for this experiment ran out of credits at this point (`402 … no available TypeSafe API credits`). Total spend was about $3.2, which suggests the account had less credit than the $5 budget.

## Browser-only rewrite: the key never touches our server

**Goal (user decision):** visitors' keys must never reach a server of ours, and that should be easy to check. Telemetry is allowed, but only anonymous counts.

- **TypeSafe can't be called from a browser.** A CORS preflight to `api.typesafe.ai/v1/systemone` returns "Disallowed CORS origin" for every origin tried: a hosted site, `localhost`, even `console.`/`docs.typesafe.ai`. The SDK also refuses to run in a browser without `dangerouslyAllowBrowser`.
- **OpenRouter can** (the user's idea). It serves Jev at `POST https://openrouter.ai/api/alpha/decisions` (model `typesafe/jev-1.13`) with the same request and response body as TypeSafe, and its preflight returns `Access-Control-Allow-Origin: *`. The user's other project (jev-slop-alarm) already uses it this way.
- **Result:**
  - The decoder runs entirely in the browser (`web/app.ts` bundles `src/`). A small fetch client replaced the TypeSafe SDK, and the dictionary became a generated JSON file.
  - The site is static files, and the Node server was deleted.
  - A Content-Security-Policy limits the page to `openrouter.ai` (plus an optional telemetry origin).
  - The optional telemetry receiver keeps only numbers and a stop reason.
- **Verified:**
  - A real reply through OpenRouter from Node: `it's the capital of france. paris.` (9 steps, 5.4 s).
  - In the browser, the resource log shows only the page's own files plus `openrouter.ai/api/alpha/decisions`.
  - A test request to another site was blocked by the CSP.
  - A fake key gets OpenRouter's 401, shown as "rejected".
- The site copy was rewritten with the humanizer skill to remove AI-writing patterns.

## Next.js for Vercel

**User decision:** host on Vercel's free plan as a Next.js app. The browser-only design is unchanged.
- The page is a client component (`src/components/JevChat.tsx`, a React port of the earlier `web/app.ts`), and the shared code lives in `src/lib/`.
- The Content-Security-Policy is now a real response header (`next.config.ts`), with `connect-src 'self' https://openrouter.ai`.
- Telemetry moved to a same-origin route handler, `/api/t`. It keeps numbers only and logs them to the Vercel function logs.
- The 835 KB dictionary is a lazily loaded chunk, so the first page load stays small.
- The esbuild site and the standalone telemetry server were removed.
- **Verified with `next build && next start`:**
  - no key → prompt shown
  - fake key → OpenRouter's 401 shown as "rejected"
  - resource log: only this site, `openrouter.ai/api/alpha/decisions` and `/api/t`
  - a test request to another site was blocked by the CSP header
  - the telemetry log line contained numbers only
  - no horizontal overflow at 1280px or 375px
  - a real reply through OpenRouter (`npm run one -- "What is 2 + 2?"` → `4`)

## Pre-launch polish (website)

Decided in a design interview with the user:
- **Word chips:** a reply renders as the tokens Jev chose. Hover or tap lights up the whole choice, dictionary words have a dotted underline, and the inspector explains the lookup ("after searching 19,375 words starting with s, r or p").
- **Replay:** re-reveals a reply at 250 ms per word, holding 800 ms on dictionary lookups. After a reply, the inspector opens on its most interesting step (the first lookup, else the least confident word), and a one-time hint says words are clickable.
- **Recorded demos:** visitors without a key can click any of 6 example prompts to play real Jev runs recorded with `scripts/record-demos.ts` (tagged "recorded run"). With a key, the same prompts run live.
- **Key-first composer:** without a key, the message box becomes the key field. The trust line sits next to it, with a tip to give the key a credit limit and an expiry date.
- **Phones:** tapping a word opens a bottom sheet.
- **Layout shift:** the whole desktop flow (load, save key, send, error) measured a CLS of 0.0017.
- **Link preview:** an `opengraph-image` card built from the France demo.
- **Less clutter:** no settings, no examples dropdown, no top-right counter.
- **Decoder fixes found while recording demos:**
  - When the dictionary found nothing, the fallback word skipped the grammar and repeat rules. That produced `the.` and an `is is is` loop that ran for 167 s.
  - A word pair may now appear at most twice.
  - Articles can't be followed by possessives ("the your").
- **Known gap:** proper names outside the country and capital lists (e.g. "Thames") can't be found, so replies about them degrade.

## Reproduce

```bash
npm install
npm run dev                                  # http://localhost:3000, paste an OpenRouter key in the page
npm run one -- "Name three fruits."          # needs OPENROUTER_API_KEY (or TYPESAFE_API_KEY) in .env
npm run eval                                 # eval suite -> results/eval-*.md
```
