"use client";

// The whole chat runs in the visitor's browser. The decoder asks Jev through
// OpenRouter with the visitor's own key; no server of ours sees the key. The
// only request to this site is an anonymous usage count (/api/t, numbers only).

import { useEffect, useRef, useState } from "react";
import { CONTEXT_BUDGET, DEFAULTS, MAX_CHARS, estimateTokens, fitContext, generate, normalizeSettings, type Candidate, type Settings } from "@/lib/decode";
import { setProvider, type JevErrorCode, type Turn } from "@/lib/jev";
import { PRESETS } from "@/lib/presets";
import { preloadVocabulary } from "@/lib/vocab";

const TELEMETRY = process.env.NEXT_PUBLIC_TELEMETRY !== "off";

interface Step { label: string; top: Candidate[]; confidence: number; latencyMs: number; inputTokens: number }
interface Message {
  role: Turn["role"];
  text: string;
  steps?: Step[];
  charStep?: number[]; // which step produced each character
  live?: boolean;
  meta?: string;
  error?: boolean;
  trimmed?: number;
}
interface Inspector { title: string; step: Step | null; loading: boolean }

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const SHOW: Record<string, string> = { SPACE: "␣", NEWLINE: "↵", "<END>": "stop", "<OTHER>": "look up", "<NONE>": "none" };
const show = (label: string) => (SHOW[label] ?? label).replace("<OTHER>→", "");
const fromDictionary = (label: string) => label.startsWith("<OTHER>→");

const ERROR_COPY: Partial<Record<JevErrorCode, string>> = {
  missing_key: "Add your OpenRouter API key in the panel.",
  invalid_key: "OpenRouter rejected that API key. Check it in the panel and try again.",
  no_credits: "Your OpenRouter account is out of credits. Top it up at openrouter.ai and send again.",
  rate_limited: "OpenRouter is rate limiting you. Give it a moment.",
  network: "Couldn't reach OpenRouter. Check your connection.",
  upstream: "OpenRouter or Jev couldn't answer this time. Try again in a minute.",
};
const IDLE: Inspector = { title: "What Jev is choosing", step: null, loading: false };

export default function JevChat() {
  const [ready, setReady] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [attention, setAttention] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [thread, setThread] = useState<Message[]>([]);
  const [tokens, setTokens] = useState(0);
  const [contextTokens, setContextTokens] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [inspector, setInspector] = useState<Inspector>(IDLE);
  const [selected, setSelected] = useState<{ msg: number; char: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const keySectionRef = useRef<HTMLElement>(null);

  // Load what this browser remembers. The key never leaves localStorage except to go to OpenRouter.
  useEffect(() => {
    try { localStorage.removeItem("jev.key"); } catch {} // an older version stored a TypeSafe key here
    const key = store.get("jev.openrouterKey", "");
    setApiKey(key);
    setKeyDraft(key);
    setSettings({ ...normalizeSettings(store.get<Partial<Settings>>("jev.settings", {})), rerank: false }); // judge is off (see EXPERIMENT_LOG.md)
    setThread(store.get<Message[]>("jev.thread", []).map((m) => ({ ...m, live: false })));
    setTokens(store.get("jev.tokens", 0));
    setReady(true);
  }, []);

  useEffect(() => {
    setProvider("openrouter", apiKey);
    if (apiKey) preloadVocabulary();
  }, [apiKey]);

  useEffect(() => {
    if (!ready || running) return;
    store.set("jev.thread", thread);
    store.set("jev.tokens", tokens);
  }, [ready, running, thread, tokens]);

  useEffect(() => {
    if (ready) store.set("jev.settings", settings);
  }, [ready, settings]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  function saveKey() {
    const key = keyDraft.trim();
    setApiKey(key);
    store.set("jev.openrouterKey", key);
    setNotice(null);
    setAttention(false);
  }
  function forgetKey() {
    setApiKey("");
    setKeyDraft("");
    store.set("jev.openrouterKey", "");
  }
  function askForKey() {
    setAttention(true);
    keySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    keyInputRef.current?.focus();
  }

  async function send(text: string) {
    if (running || !text.trim()) return;
    if (!apiKey) {
      setNotice("Add your OpenRouter API key in the panel, then send again.");
      askForKey();
      return;
    }
    setNotice(null);
    const user: Message = { role: "user", text };
    const conversation: Turn[] = [...thread, user].map(({ role, text }) => ({ role, text }));
    const { kept, trimmed } = fitContext(conversation);
    if (trimmed) user.trimmed = trimmed;
    const reply: Message & { steps: Step[]; charStep: number[] } = { role: "assistant", text: "", steps: [], charStep: [], live: true };
    const push = () => setThread((t) => [...t.slice(0, -1), { ...reply }]);
    setThread((t) => [...t, user, { ...reply }]);
    setSelected(null);
    setRunning(true);
    setInspector({ title: "Step 1: next word", step: null, loading: true });
    setContextTokens(estimateTokens(kept));
    const controller = new AbortController();
    abortRef.current = controller;

    const started = performance.now();
    const result = await generate(kept, settings, (e) => {
      for (let c = Math.min(reply.text.length, e.text.length); c < e.text.length; c++) reply.charStep[c] = e.step;
      reply.text = e.text;
      const step: Step = { label: e.label, top: e.top, confidence: e.confidence, latencyMs: e.latencyMs, inputTokens: e.inputTokens };
      reply.steps[e.step] = step;
      setTokens((n) => n + e.inputTokens);
      setInspector({ title: `Step ${e.step + 1}: next word`, step, loading: false });
      push();
    }, controller.signal);

    const ms = performance.now() - started;
    const n = reply.steps.length;
    const steps = `${n} step${n === 1 ? "" : "s"}, ${(ms / 1000).toFixed(1)} s`;
    reply.live = false;
    reply.error = result.stopReason === "error";
    reply.meta =
      result.stopReason === "end" ? `Jev decided it was done. ${steps}.`
      : result.stopReason === "max_chars" ? `Stopped at the length limit. ${steps}.`
      : result.stopReason === "error" ? (result.errorCode && ERROR_COPY[result.errorCode]) ?? `Something went wrong (${result.error}). Try again or start a new chat.`
      : `You stopped it. ${steps}.`;
    push();
    setInspector((i) => ({ ...i, loading: false }));
    setRunning(false);
    abortRef.current = null;
    if (TELEMETRY) {
      // Numbers and one enum only: no prompt, no reply, no key.
      const payload = { event: "reply", steps: n, inputTokens: result.inputTokens, ms: Math.round(ms), stopReason: result.stopReason, lookups: reply.steps.filter((s) => fromDictionary(s.label)).length, temperature: settings.temperature, maxChars: settings.maxChars };
      try { navigator.sendBeacon("/api/t", JSON.stringify(payload)); } catch {}
    }
  }

  function submit() {
    const text = input;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    send(text);
  }

  function inspect(mi: number, ci: number) {
    const m = thread[mi];
    const si = m.charStep?.[ci] ?? ci;
    const step = m.steps?.[si];
    if (!step) return;
    setSelected({ msg: mi, char: ci });
    setInspector({ title: `Step ${si + 1}: next word`, step, loading: false });
  }

  function newChat() {
    setThread([]);
    setSelected(null);
    setInspector(IDLE);
    inputRef.current?.focus();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Jev as LLM</h1>
          <p>Jev is a judgment model that was never trained to write. This page makes it write anyway, one word at a time.</p>
        </div>
        <div className="spend" title="Input tokens sent to Jev from this browser">
          <b>{tokens.toLocaleString()}</b> tokens used
        </div>
      </header>

      <div className="layout">
        <main className="chat">
          <div className="thread" ref={threadRef}>
            {thread.length === 0 ? (
              <div className="empty">
                <h2>Ask Jev something.</h2>
                <p>Jev answers typed questions with probabilities. This page keeps asking it which word should come next until it picks stop.</p>
                {ready && !apiKey && (
                  <div className="keynote">
                    This demo runs in your browser and uses your own OpenRouter API key.{" "}
                    <button className="btn link" onClick={askForKey}>Add your key</button>
                  </div>
                )}
                <div className="suggestions">
                  {PRESETS.map((p) => (
                    <button key={p.id} className="suggestion" onClick={() => send(p.prompt)}>{p.prompt}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="turns">
                {thread.map((m, mi) => (
                  <MessageView key={mi} m={m} selectedChar={selected?.msg === mi ? selected.char : null} onPick={(ci) => inspect(mi, ci)} />
                ))}
              </div>
            )}
          </div>

          <div className="composer">
            <div className="composer-inner">
              <div className="field">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  placeholder="Ask Jev something"
                  aria-label="Message to Jev"
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                  }}
                />
                {running && <button className="btn quiet" onClick={() => abortRef.current?.abort()}>Stop</button>}
                <button className="btn primary" disabled={running} onClick={submit}>Send</button>
              </div>
              {notice && <div className="notice" role="status">{notice}</div>}
              <div className="below">
                <select
                  className="examples"
                  aria-label="Example prompts"
                  value=""
                  disabled={running}
                  onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) send(p.prompt); }}
                >
                  <option value="">Try an example</option>
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.prompt}</option>)}
                </select>
                <button className="btn link" disabled={running} onClick={newChat}>New chat</button>
                <span className="spacer" />
                <span>Enter sends.</span>
              </div>
            </div>
          </div>
        </main>

        <aside aria-label="Inspector">
          <section ref={keySectionRef} className={attention ? "attention" : undefined}>
            <h2>Your OpenRouter API key</h2>
            <div className="keyrow">
              <input
                ref={keyInputRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-..."
                aria-label="OpenRouter API key"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
              />
              <button className="btn quiet" onClick={saveKey}>Save</button>
            </div>
            <div className="hint">
              {apiKey ? (
                <>Saved in this browser. <button className="btn link" onClick={forgetKey}>Forget key</button></>
              ) : (
                <><a href="https://openrouter.ai/workspaces/default/keys" target="_blank" rel="noopener noreferrer">Create a key on OpenRouter</a> and paste it here. A reply usually costs less than a cent.</>
              )}
            </div>
            <div className="hint trust">
              <strong>Your key never reaches our server.</strong> Everything runs in your browser, which sends your key straight to openrouter.ai, where Jev runs.{" "}
              {TELEMETRY
                ? "This site only gets an anonymous usage count with step and token numbers. That count never includes your text or your key."
                : "Nothing else gets sent anywhere."}
              <details>
                <summary>How to check</summary>
                Open your browser&apos;s developer tools, switch to the Network tab and send a message. Your key only shows up in requests to openrouter.ai. The site&apos;s Content-Security-Policy header also blocks the page from sending data anywhere except openrouter.ai and this site.
              </details>
            </div>
          </section>

          <section>
            <h2>{inspector.title}</h2>
            <InspectorView inspector={inspector} />
          </section>

          <section>
            <h2>Settings</h2>
            <label className="ctl">
              Temperature
              <input type="range" min={0} max={2} step={0.1} value={settings.temperature}
                onChange={(e) => setSettings((s) => normalizeSettings({ ...s, temperature: Number(e.target.value) }))} />
              <span className="val">{settings.temperature}</span>
            </label>
            <label className="ctl">
              Max characters
              <input type="range" min={10} max={MAX_CHARS} step={10} value={settings.maxChars}
                onChange={(e) => setSettings((s) => normalizeSettings({ ...s, maxChars: Number(e.target.value) }))} />
              <span className="val">{settings.maxChars}</span>
            </label>
            <div className="help">
              Jev picks each word from about 250 common ones. For anything rarer it searches a 75,000-word dictionary.
              {settings.temperature > 0 ? " Temperature above 0 adds randomness." : " At 0 it always takes its top choice."}
            </div>
          </section>

          <section>
            <h2>Context</h2>
            <div className="hint">
              {contextTokens === null
                ? "Measured when you send a message."
                : `About ${contextTokens.toLocaleString()} of ${CONTEXT_BUDGET.toLocaleString()} tokens used by this conversation.`}
            </div>
            <div className="meter"><div style={{ width: `${Math.min(100, ((contextTokens ?? 0) / CONTEXT_BUDGET) * 100)}%` }} /></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MessageView({ m, selectedChar, onPick }: { m: Message; selectedChar: number | null; onPick: (ci: number) => void }) {
  return (
    <>
      {m.trimmed ? <div className="note">{m.trimmed} earlier message{m.trimmed > 1 ? "s" : ""} trimmed from Jev&apos;s context</div> : null}
      <div className={`msg ${m.role}${m.live ? " live" : ""}`}>
        {m.role === "assistant" && m.steps ? (
          <>
            {m.live && !m.text ? (
              <><span className="skeleton" style={{ width: 220 }} /><span className="skeleton" style={{ width: 140 }} /></>
            ) : (
              // Every character is clickable: it shows the step that produced it.
              [...m.text].map((c, i) => (
                <span key={i} className={`ch${selectedChar === i ? " sel" : ""}`} onClick={() => onPick(i)}>{c}</span>
              ))
            )}
            {m.live && m.text && <span className="caret" />}
            {m.meta && <span className={`meta${m.error ? " error" : ""}`}>{m.meta}</span>}
          </>
        ) : (
          m.text
        )}
      </div>
    </>
  );
}

function InspectorView({ inspector }: { inspector: Inspector }) {
  if (inspector.loading) {
    return <div className="bars">{[72, 48, 34, 22].map((w) => <span key={w} className="skeleton" style={{ width: `${w}%` }} />)}</div>;
  }
  const step = inspector.step;
  if (!step) {
    return <div className="hint">At each step Jev gives every candidate word a probability, and the top ones show up here while it writes. Click any word in a reply to see the step behind it.</div>;
  }
  // A dictionary word was chosen through the "look up" option, so that bar is the pick.
  const pickLabel = fromDictionary(step.label) ? "<OTHER>" : step.label;
  return (
    <>
      <div className="bars">
        {step.top.slice(0, 8).map(({ label, p }) => (
          <div key={label} className={`bar${label === pickLabel ? " pick" : ""}`}>
            <span className="lbl">{show(label)}</span>
            <span className="track"><span className="fill" style={{ width: `${Math.max(p * 100, 1).toFixed(1)}%` }} /></span>
            <span className="pct">{(p * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <div className="stat">
        Picked &quot;{show(step.label)}&quot;{fromDictionary(step.label) ? " from the dictionary" : ""}. Confidence {step.confidence.toFixed(2)}, {step.latencyMs.toLocaleString()} ms, {step.inputTokens.toLocaleString()} tokens.
      </div>
    </>
  );
}
