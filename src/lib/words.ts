// Word-level helpers for the hybrid decoder: the common-word candidate list,
// and the spacing rules code owns. Everything is lowercase: capitalisation
// caused more trouble than it was worth (user decision, see EXPERIMENT_LOG.md).

export const COMMON_WORDS = `
the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or
will my one all would there their what so up out if about who get which go me when make can like time no just him
know take people into year your good some could them see other than then now look only come its over think also back
after use two how our work first well way even new want because any these give day most us is are was were been has
had did does done am i'm i've i'd i'll you're it's that's there's don't can't won't isn't doesn't didn't let's
hello hi hey thanks thank please sure yes yeah okay great happy glad sorry help today doing fine very much really
welcome anytime pleasure problem course tips try maybe usually often good best
here more many answer called known capital city country number line lines poem write function returns return square
def print x y n 1 2 3 4 5 6 7 8 9 10
`.trim().split(/\s+/);

export const NEWLINE_TOKEN = "NEWLINE";
// Deliberately small (user decision): symbols like - * ( ) " produced junk such as "- a, -. -. -.".
export const PUNCTUATION_TOKENS = [".", ",", "!", "?", ":", NEWLINE_TOKEN];

const NO_SPACE_BEFORE = /^[.,!?:;)]$/;

/** Append a word or punctuation token to the reply with normal spacing. */
export function joinToken(reply: string, token: string): string {
  if (token === NEWLINE_TOKEN) return reply.trimEnd() + "\n";
  // English article agreement is a known rule, so code owns it.
  if (/^[aeiou]/.test(token) && /(^|\s)a$/.test(reply)) reply = reply.slice(0, -1) + "an";
  if (reply === "" || reply.endsWith("\n") || reply.endsWith("(") || NO_SPACE_BEFORE.test(token)) return reply + token;
  return reply + " " + token;
}

/** Candidate next tokens: conversation words (they carry the topic), punctuation, then common words. */
export function candidateTokens(conversationText: string, limit: number): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (out.length < limit && !out.includes(w)) out.push(w);
  };
  for (const w of conversationText.toLowerCase().match(/[a-z0-9']+/g) ?? []) add(w);
  for (const p of PUNCTUATION_TOKENS) add(p);
  for (const w of COMMON_WORDS) add(w);
  return out;
}
