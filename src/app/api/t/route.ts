// Anonymous usage counts from the chat page: numbers and one enum, nothing else.
// Each event is written as one JSON line to the function logs (on Vercel:
// Project > Logs, filter "jev-telemetry"). Any other field, including any
// text or key sent by mistake, is dropped here.

const NUMBERS = ["steps", "inputTokens", "ms", "lookups"] as const;
const STOP_REASONS = new Set(["end", "max_chars", "aborted", "error"]);

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 2_000) return new Response(null, { status: 413 });
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const event: Record<string, unknown> = { at: new Date().toISOString(), event: "reply" };
  for (const k of NUMBERS) if (typeof raw[k] === "number" && Number.isFinite(raw[k])) event[k] = raw[k];
  if (typeof raw.stopReason === "string" && STOP_REASONS.has(raw.stopReason)) event.stopReason = raw.stopReason;
  console.log("jev-telemetry " + JSON.stringify(event));
  return new Response(null, { status: 204 });
}
