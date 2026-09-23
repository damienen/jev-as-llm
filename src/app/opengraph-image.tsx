// The link-preview card (1200×630), built from a real recorded run.
import { ImageResponse } from "next/og";
import demos from "@/lib/demos.json";

export const alt = "Jev as LLM: a judgment model writing a reply one word at a time";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface DemoStep { label: string; top: { label: string; p: number }[] }
interface Demo { id: string; prompt: string; text: string; steps: DemoStep[] }

const SHOW: Record<string, string> = { "<END>": "stop", "<OTHER>": "look up", NEWLINE: "↵" };

export default function Image() {
  const all = demos as unknown as Demo[];
  const demo = all.find((d) => d.id === "france") ?? all[0];
  // The step where Jev was most torn between options makes the most interesting bars.
  const step = [...demo.steps].sort((a, b) => (b.top[1]?.p ?? 0) - (a.top[1]?.p ?? 0))[0];
  const bars = step.top.slice(0, 4);
  const picked = step.label.replace("<OTHER>→", "");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#0e1012", color: "#e6e8eb", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>Jev as LLM</div>
          <div style={{ fontSize: 30, color: "#9aa1ab" }}>It was never trained to write. Here it writes anyway, one word at a time.</div>
        </div>
        <div style={{ display: "flex", gap: 48, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
            <div style={{ fontSize: 24, color: "#9aa1ab" }}>{demo.prompt}</div>
            <div style={{ fontSize: 34, fontFamily: "monospace", borderLeft: "4px solid #4fb892", paddingLeft: 18 }}>{demo.text}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 340 }}>
            {bars.map((b) => (
              <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 110, textAlign: "right", fontSize: 22, fontFamily: "monospace", color: b.label.replace("<OTHER>→", "") === picked || b.label === step.label ? "#e6e8eb" : "#7f8690" }}>
                  {SHOW[b.label] ?? b.label}
                </div>
                <div style={{ display: "flex", height: 14, width: `${Math.max(b.p * 200, 4)}px`, borderRadius: 4, background: b.label === step.label ? "#4fb892" : "#3a4048" }} />
                <div style={{ fontSize: 20, color: "#7f8690" }}>{`${Math.round(b.p * 100)}%`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
