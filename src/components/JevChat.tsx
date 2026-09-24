"use client";

// The whole chat runs in the visitor's browser. Live replies ask Jev through
// OpenRouter with the visitor's own key; no server of ours sees the key.
// Without a key, the example prompts play real recorded runs instead.

import { useEffect, useRef, useState } from "react";
import demosData from "@/lib/demos.json";
import { CONTEXT_BUDGET, DEFAULTS, estimateTokens, fitContext, generate } from "@/lib/decode";
import { setProvider, type JevErrorCode, type Turn } from "@/lib/jev";
import { preloadVocabulary } from "@/lib/vocab";
import BottomSheet from "./BottomSheet";
import Inspector, { fromDictionary, inspectorTitle, type InspectorState, type Step } from "./Inspector";
import KeyEntry from "./KeyEntry";
import ReplyText, { tokenize } from "./ReplyText";

const TELEMETRY = process.env.NEXT_PUBLIC_TELEMETRY !== "off";
/** Fixed: temperature 0 (always Jev's top choice), replies capped at 300 characters, judge off. */
const SETTINGS = DEFAULTS;
/** Replay pace: readable, with a pause on dictionary lookups. */
const STEP_MS = 250;
const LOOKUP_MS = 800;

interface Demo { id: string; prompt: string; text: string; stopReason: string; ms: number; steps: (Step & { text: string })[] }
const DEMOS = demosData as unknown as Demo[];

interface Message {
  role: Turn["role"];
  text: string;
  steps?: Step[];
  charStep?: number[]; // which step produced each character
  source?: "live" | "recorded";
  live?: boolean; // still being written
  shown?: number; // while replaying: how many steps are revealed
  status?: string;
  error?: boolean;
  trimmed?: number;
}

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ERROR_COPY: Partial<Record<JevErrorCode, string>> = {
  missing_key: "Add your OpenRouter API key first.",
  invalid_key: "OpenRouter rejected that API key. It may be mistyped or expired.",
  no_credits: "Your OpenRouter account is out of credits. Top it up at openrouter.ai and send again.",
  rate_limited: "OpenRouter is rate limiting you. Give it a moment.",
  network: "Couldn't reach OpenRouter. Check your connection.",
  upstream: "OpenRouter or Jev couldn't answer this time. Try again in a minute.",
};

/** Map each character of the final text to the step that wrote it, from the per-step texts. */
function charStepsFrom(texts: string[]): number[] {
  const out: number[] = [];
  texts.forEach((t, i) => { for (let c = out.length; c < t.length; c++) out[c] = i; });
  return out;
}

/** The step most worth looking at first: a dictionary lookup, else the least confident word. */
function interestingStep(steps: Step[]): number {
  const lookup = steps.findIndex((s) => s.lookup);
  if (lookup >= 0) return lookup;
  let best = -1;
  steps.forEach((s, i) => {
    if (!/^[a-z0-9']/.test(s.label)) return; // skip stop, punctuation, line breaks
    if (best < 0 || s.confidence < steps[best].confidence) best = i;
  });
  return Math.max(best, 0);
}

const stepTitle = (si: number) => `Step ${si + 1}: next word`;
const statusText = (why: string, n: number, secs?: number) => {
  const steps = `${n} step${n === 1 ? "" : "s"}${secs !== undefined ? `, ${secs.toFixed(1)} s` : ""}`;
  return why === "end" ? `Jev decided it was done. ${steps}.` : why === "max_chars" ? `Stopped at the length limit. ${steps}.` : `You stopped it. ${steps}.`;
};

export default function JevChat() {
  const [ready, setReady] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [attention, setAttention] = useState(false);
  const [thread, setThread] = useState<Message[]>([]);
  const [tokens, setTokens] = useState(0);
  const [contextTokens, setContextTokens] = useState(0);
  const [busy, setBusy] = useState<"idle" | "live" | "replay">("idle");
  const [inspector, setInspector] = useState<InspectorState>({ kind: "idle" });
  const [selected, setSelected] = useState<{ msg: number; step: number } | null>(null);
  const [hover, setHover] = useState<{ msg: number; step: number } | null>(null);
  const [hintSeen, setHintSeen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const replayRef = useRef<{ cancelled: boolean } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load what this browser remembers. The key never leaves localStorage except to go to OpenRouter.
  useEffect(() => {
    try { localStorage.removeItem("jev.key"); localStorage.removeItem("jev.settings"); } catch {} // older versions
    setApiKey(store.get("jev.openrouterKey", ""));
    setThread(store.get<Message[]>("jev.thread", []).map(({ live, shown, ...m }) => m));
    setTokens(store.get("jev.tokens", 0));
    setHintSeen(store.get("jev.hintSeen", false));
    setReady(true);
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setProvider("openrouter", apiKey);
    if (apiKey) preloadVocabulary();
  }, [apiKey]);

  useEffect(() => {
    if (!ready || busy !== "idle") return;
    store.set("jev.thread", thread.map(({ live, shown, ...m }) => m));
    store.set("jev.tokens", tokens);
  }, [ready, busy, thread, tokens]);

  // Follow the text while Jev writes or replays.
  useEffect(() => {
    const el = threadRef.current;
    if (el && busy !== "idle") el.scrollTop = el.scrollHeight;
  }, [thread, busy]);

  const updateMsg = (mi: number, patch: Partial<Message>) => setThread((t) => t.map((m, i) => (i === mi ? { ...m, ...patch } : m)));

  function showStep(mi: number, si: number, steps: Step[]) {
    setSelected({ msg: mi, step: si });
    setInspector({ kind: "step", title: stepTitle(si), step: steps[si] });
  }

  function select(mi: number, si: number) {
    const steps = thread[mi]?.steps;
    if (!steps?.[si] || busy !== "idle") return;
    showStep(mi, si, steps);
    if (!hintSeen) { setHintSeen(true); store.set("jev.hintSeen", true); }
    if (mobile) setSheetOpen(true);
  }

  /** Reveal a finished reply step by step. Used by the Replay link and the recorded demos. */
  async function replay(mi: number, msg: Message) {
    const steps = msg.steps!;
    const run = { cancelled: false };
    replayRef.current = run;
    setBusy("replay");
    updateMsg(mi, { shown: 0 });
    for (let k = 0; k < steps.length && !run.cancelled; k++) {
      const lookup = steps[k].lookup;
      if (lookup) {
        setInspector({ kind: "searching", title: stepTitle(k), lookup });
        await sleep(LOOKUP_MS);
        if (run.cancelled) break;
      }
      updateMsg(mi, { shown: k + 1 });
      showStep(mi, k, steps);
      await sleep(STEP_MS);
    }
    updateMsg(mi, { shown: undefined });
    replayRef.current = null;
    setBusy("idle");
    showStep(mi, interestingStep(steps), steps);
  }

  function playDemo(demo: Demo) {
    const steps: Step[] = demo.steps.map(({ text, ...s }) => s);
    const reply: Message = {
      role: "assistant", text: demo.text, steps, charStep: charStepsFrom(demo.steps.map((s) => s.text)),
      source: "recorded", status: statusText(demo.stopReason, steps.length),
    };
    const mi = thread.length + 1;
    setThread((t) => [...t, { role: "user", text: demo.prompt }, reply]);
    setSelected(null);
    void replay(mi, reply);
  }

  async function sendLive(text: string) {
    if (busy !== "idle" || !text.trim()) return;
    if (!apiKey) {
      setAttention(true);
      document.getElementById("key-input")?.focus();
      return;
    }
    const user: Message = { role: "user", text };
    const conversation: Turn[] = [...thread, user].map(({ role, text }) => ({ role, text }));
    const { kept, trimmed } = fitContext(conversation);
    if (trimmed) user.trimmed = trimmed;
    const reply: Message & { steps: Step[]; charStep: number[] } = { role: "assistant", text: "", steps: [], charStep: [], source: "live", live: true, status: "Asking Jev…" };
    const mi = thread.length + 1;
    const push = () => setThread((t) => [...t.slice(0, -1), { ...reply }]);
    setThread((t) => [...t, user, { ...reply }]);
    setSelected(null);
    setBusy("live");
    setInspector({ kind: "loading", title: stepTitle(0) });
    setContextTokens(estimateTokens(kept));
    const controller = new AbortController();
    abortRef.current = controller;

    const started = performance.now();
    const result = await generate(kept, SETTINGS, (e) => {
      for (let c = Math.min(reply.text.length, e.text.length); c < e.text.length; c++) reply.charStep[c] = e.step;
      reply.text = e.text;
      const step: Step = { label: e.label, top: e.top, confidence: e.confidence, latencyMs: e.latencyMs, inputTokens: e.inputTokens, lookup: e.lookup };
      reply.steps[e.step] = step;
      reply.status = `Writing… step ${e.step + 1}`;
      setTokens((n) => n + e.inputTokens);
      setSelected({ msg: mi, step: e.step });
      setInspector({ kind: "step", title: stepTitle(e.step), step });
      push();
    }, controller.signal);

    const ms = performance.now() - started;
    reply.live = false;
    reply.error = result.stopReason === "error";
    reply.status = result.stopReason === "error"
      ? (result.errorCode && ERROR_COPY[result.errorCode]) ?? `Something went wrong (${result.error}). Try again or start a new chat.`
      : statusText(result.stopReason, reply.steps.length, ms / 1000);
    push();
    abortRef.current = null;
    setBusy("idle");
    if (reply.steps.length) showStep(mi, interestingStep(reply.steps), reply.steps);
    else setInspector({ kind: "idle" });
    if (TELEMETRY) {
      // Numbers and one enum only: no prompt, no reply, no key.
      const payload = { event: "reply", steps: reply.steps.length, inputTokens: result.inputTokens, ms: Math.round(ms), stopReason: result.stopReason, lookups: reply.steps.filter((s) => fromDictionary(s.label)).length };
      try { navigator.sendBeacon("/api/t", JSON.stringify(payload)); } catch {}
    }
  }

  function example(demo: Demo) {
    if (busy !== "idle") return;
    if (apiKey) void sendLive(demo.prompt);
    else playDemo(demo);
  }

  function stop() {
    if (busy === "live") abortRef.current?.abort();
    if (busy === "replay" && replayRef.current) replayRef.current.cancelled = true;
  }

  function submit() {
    const text = input;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    void sendLive(text);
  }

  function newChat() {
    stop();
    setThread([]);
    setSelected(null);
    setInspector({ kind: "idle" });
    setContextTokens(0);
    inputRef.current?.focus();
  }

  function saveKey(key: string) {
    setApiKey(key);
    store.set("jev.openrouterKey", key);
    setAttention(false);
  }
  function forgetKey() {
    setApiKey("");
    store.set("jev.openrouterKey", "");
  }

  // Desktop hover previews a step without changing the selection.
  const view: InspectorState =
    hover && busy === "idle" && thread[hover.msg]?.steps?.[hover.step]
      ? { kind: "step", title: stepTitle(hover.step), step: thread[hover.msg].steps![hover.step] }
      : inspector;
  const replies = thread.filter((m) => m.role === "assistant").length;
  const firstFinished = thread.findIndex((m) => m.role === "assistant" && m.steps?.length && !m.live && m.shown === undefined && !m.error);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Jev as LLM</h1>
          <p>Jev is a judgment model that was never trained to write. This page makes it write anyway, one word at a time.</p>
        </div>
      </header>

      <div className="layout">
        <main className="chat">
          <div className="thread" ref={threadRef}>
            {thread.length === 0 ? (
              <div className="empty">
                <h2>Ask Jev something.</h2>
                <p>
                  Jev answers typed questions with probabilities. This page keeps asking it which word should come next until it picks stop.
                  {ready && !apiKey && " Try an example below. Each one replays a real run we recorded earlier."}
                </p>
                <div className="suggestions">
                  {DEMOS.map((d) => (
                    <button key={d.id} className="suggestion" disabled={busy !== "idle"} onClick={() => example(d)}>{d.prompt}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="turns">
                {thread.map((m, mi) => {
                  if (m.role === "user") {
                    return (
                      <div key={mi} className="turn">
                        {m.trimmed ? <div className="note">{m.trimmed} earlier message{m.trimmed > 1 ? "s" : ""} trimmed from Jev&apos;s context</div> : null}
                        <div className="msg user">{m.text}</div>
                      </div>
                    );
                  }
                  const shownText = m.shown === undefined ? m.text : [...m.text].filter((_, c) => (m.charStep?.[c] ?? 0) < m.shown!).join("");
                  const lookups = new Set((m.steps ?? []).flatMap((s, i) => (s.lookup ? [i] : [])));
                  const writing = m.live || m.shown !== undefined;
                  return (
                    <div key={mi} className={`msg assistant${writing ? " live" : ""}`}>
                      <div className="reply">
                        {writing && !shownText ? (
                          <span className="skeleton line" />
                        ) : (
                          <ReplyText
                            tokens={tokenize(shownText, m.charStep ?? [], lookups)}
                            selectedStep={selected?.msg === mi ? selected.step : null}
                            onSelect={(si) => select(mi, si)}
                            onHover={mobile ? undefined : (si) => setHover(si === null ? null : { msg: mi, step: si })}
                          />
                        )}
                        {writing && shownText && <span className="caret" />}
                      </div>
                      <div className={`meta${m.error ? " error" : ""}`}>
                        {m.source === "recorded" && <span className="tag">recorded run</span>}
                        {m.source === "live" && !writing && !m.error && <span className="tag">live</span>}
                        <span>{m.shown !== undefined ? "Replaying…" : m.status}</span>
                        {!writing && !m.error && (m.steps?.length ?? 0) > 0 && (
                          <button className="btn link" disabled={busy !== "idle"} onClick={() => void replay(mi, m)}>▶ Replay</button>
                        )}
                      </div>
                      {mi === firstFinished && !hintSeen && busy === "idle" && (
                        <div className="hint-once">Tap any word to see what else Jev considered.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="composer">
            <div className="composer-inner">
              {/* Key field from the first paint: most visitors arrive without a key. */}
              {!apiKey ? (
                <KeyEntry onSave={saveKey} attention={attention} />
              ) : (
                <>
                  <div className="field">
                    <textarea
                      ref={inputRef}
                      className="field-input"
                      rows={1}
                      value={input}
                      placeholder="Ask Jev something"
                      aria-label="Message to Jev"
                      onChange={(e) => {
                        setInput(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    />
                    {busy === "idle"
                      ? <button className="btn primary slot" onClick={submit} disabled={!input.trim()}>Send</button>
                      : <button className="btn quiet slot" onClick={stop}>Stop</button>}
                  </div>
                  <div className="below">
                    <button className="btn link" disabled={busy !== "idle" || thread.length === 0} onClick={newChat}>New chat</button>
                    <span className="spacer" />
                    <span>Enter sends. Shift+Enter adds a line.</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>

        <aside aria-label="Inspector">
          {apiKey && (
            <section className="keyline">
              Your OpenRouter key is saved in this browser. <button className="btn link" onClick={forgetKey}>Forget key</button>
            </section>
          )}
          <section className="insp-section">
            <h2>{inspectorTitle(view)}</h2>
            <Inspector state={view} />
          </section>
          {contextTokens > CONTEXT_BUDGET * 0.6 && (
            <section className="hint">
              This conversation uses about {contextTokens.toLocaleString()} of Jev&apos;s {CONTEXT_BUDGET.toLocaleString()}-token context. After that, the page drops the oldest messages.
            </section>
          )}
          <footer className="asidefoot">
            <div>{replies} {replies === 1 ? "reply" : "replies"} · {tokens.toLocaleString()} tokens used</div>
            <div className="about">
              <a href="https://github.com/damienen/jev-as-llm" target="_blank" rel="noopener noreferrer">Source and write-up on GitHub</a>.
              An independent experiment, not affiliated with TypeSafe or OpenRouter.
            </div>
          </footer>
        </aside>
      </div>

      <BottomSheet open={mobile && sheetOpen} title={inspectorTitle(inspector)} onClose={() => setSheetOpen(false)}>
        <Inspector state={inspector} />
      </BottomSheet>
    </div>
  );
}
