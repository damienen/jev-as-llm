"use client";

// Shown in place of the message box until a key is saved: the one thing a
// newcomer has to do, right where they're already looking.

import { useState } from "react";

export default function KeyEntry({ onSave, attention }: { onSave: (key: string) => void; attention: boolean }) {
  const [draft, setDraft] = useState("");
  const save = () => { if (draft.trim()) onSave(draft.trim()); };
  return (
    <>
      <div className={`field${attention ? " attention" : ""}`}>
        <input
          id="key-input"
          className="field-input mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your OpenRouter key (sk-or-...) to chat live"
          aria-label="OpenRouter API key"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <button className="btn primary slot" onClick={save} disabled={!draft.trim()}>Save</button>
      </div>
      <div className="keyinfo">
        <p>
          <a href="https://openrouter.ai/workspaces/default/keys" target="_blank" rel="noopener noreferrer">Create a key on OpenRouter</a>.
          Give it a credit limit and an expiry date when you make it, so a leaked key can&apos;t cost you much.
        </p>
        <div>
          Your key stays in your browser and goes only to openrouter.ai. It never reaches our server.
          <details>
            <summary>How to check</summary>
            Open your browser&apos;s developer tools, switch to the Network tab and send a message. Your key only shows up in requests to openrouter.ai. The site&apos;s Content-Security-Policy header also blocks the page from sending data anywhere except openrouter.ai and this site.
          </details>
        </div>
      </div>
    </>
  );
}
