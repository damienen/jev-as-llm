"use client";

// One step's view: the candidates Jev weighed and which one it picked. The
// layout always reserves the same space (8 rows + 2 stat lines), whether it's
// empty, loading, searching the dictionary or showing bars, so nothing jumps.

import type { Candidate } from "@/lib/decode";

export interface Step {
  label: string;
  top: Candidate[];
  confidence: number;
  latencyMs: number;
  inputTokens: number;
  lookup?: { letters: string[]; searched: number };
}

export type InspectorState =
  | { kind: "idle" }
  | { kind: "loading"; title: string }
  | { kind: "searching"; title: string; lookup: NonNullable<Step["lookup"]> }
  | { kind: "step"; title: string; step: Step };

const SHOW: Record<string, string> = { SPACE: "␣", NEWLINE: "↵", "<END>": "stop", "<OTHER>": "look up", "<NONE>": "none" };
export const show = (label: string) => (SHOW[label] ?? label).replace("<OTHER>→", "");
export const fromDictionary = (label: string) => label.startsWith("<OTHER>→");
const ROWS = 8;

export function lettersText(letters: string[]) {
  return letters.length <= 1 ? letters.join("") : `${letters.slice(0, -1).join(", ")} or ${letters[letters.length - 1]}`;
}

export function inspectorTitle(state: InspectorState) {
  return state.kind === "idle" ? "What Jev is choosing" : state.title;
}

export default function Inspector({ state }: { state: InspectorState }) {
  if (state.kind === "idle") {
    return (
      <div className="insp">
        <div className="bars bars-empty">
          <p className="hint">
            At each step Jev gives every candidate word a probability. They show up here while it writes. Tap any word in a reply to see what else Jev considered.
          </p>
        </div>
        <div className="stat" />
      </div>
    );
  }
  if (state.kind === "loading" || state.kind === "searching") {
    return (
      <div className="insp">
        <div className="bars">
          {Array.from({ length: ROWS }, (_, i) => (
            <div key={i} className="bar"><span className="skeleton" style={{ width: `${[72, 48, 34, 22, 16, 12, 9, 7][i]}%` }} /></div>
          ))}
        </div>
        <div className="stat">
          {state.kind === "searching"
            ? `Searching ${state.lookup.searched.toLocaleString()} words starting with ${lettersText(state.lookup.letters)}…`
            : "Asking Jev…"}
        </div>
      </div>
    );
  }
  const { step } = state;
  // A dictionary word was chosen through the "look up" option, so that bar is the pick.
  const pickLabel = fromDictionary(step.label) ? "<OTHER>" : step.label;
  const rows = step.top.slice(0, ROWS);
  return (
    <div className="insp">
      <div className="bars">
        {rows.map(({ label, p }) => (
          <div key={label} className={`bar${label === pickLabel ? " pick" : ""}`}>
            <span className="lbl">{show(label)}</span>
            <span className="track"><span className="fill" style={{ width: `${Math.max(p * 100, 1).toFixed(1)}%` }} /></span>
            <span className="pct">{(p * 100).toFixed(0)}%</span>
          </div>
        ))}
        {Array.from({ length: ROWS - rows.length }, (_, i) => <div key={`pad${i}`} className="bar" />)}
      </div>
      <div className="stat">
        {step.lookup
          ? `Picked "${show(step.label)}" after searching ${step.lookup.searched.toLocaleString()} words starting with ${lettersText(step.lookup.letters)}.`
          : `Picked "${show(step.label)}" with confidence ${step.confidence.toFixed(2)}.`}
      </div>
    </div>
  );
}
