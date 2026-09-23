"use client";

// A reply rendered as the tokens Jev chose: one chip per step, so hovering or
// tapping lights up the whole choice ("seine", ",", "i'm"), not one letter.
// Whitespace between tokens stays outside the chips.

export interface Token {
  step: number;
  lead: string; // whitespace before the token (not highlighted)
  text: string;
  lookup: boolean; // came from the dictionary search
}

/** Split `text` into tokens using `charStep` (the step that produced each character). */
export function tokenize(text: string, charStep: number[], lookupSteps: Set<number>): Token[] {
  const tokens: Token[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const step = charStep[i] ?? -1;
    let run = "";
    while (i < chars.length && (charStep[i] ?? -1) === step) run += chars[i++];
    const lead = run.match(/^\s*/)![0];
    tokens.push({ step, lead, text: run.slice(lead.length), lookup: lookupSteps.has(step) });
  }
  return tokens;
}

export default function ReplyText({
  tokens,
  selectedStep,
  onSelect,
  onHover,
}: {
  tokens: Token[];
  selectedStep: number | null;
  onSelect: (step: number) => void;
  onHover?: (step: number | null) => void;
}) {
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i}>
          {t.lead}
          {t.text && (
            <span
              className={`tok${t.lookup ? " lookup" : ""}${selectedStep === t.step ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.step)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.step); } }}
              onMouseEnter={() => onHover?.(t.step)}
              onMouseLeave={() => onHover?.(null)}
            >
              {t.text}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
