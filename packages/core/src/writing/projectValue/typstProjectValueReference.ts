/** Finds member paths into `json("…")` values in Typst text, directly or through a name bound by `let`. */

export interface TypstProjectValuePrefix {
  /** The `json()` path literal as written. */
  source: string;
  /** Complete member names before the one being typed, dot-joined; "" when there are none. */
  parent: string;
  /** Character offset where the member being typed starts. */
  start: number;
}

export interface TypstProjectValueReference {
  source: string;
  /** Dot-joined members from the file root up to and including the one under the cursor. */
  path: string;
  /** Character offsets of that last member. */
  start: number;
  end: number;
}

interface Member { name: string; start: number; end: number }
interface Chain { source: string; members: Member[]; end: number }

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_-]*`;
const BINDING = new RegExp(String.raw`\blet\s+(${NAME})\s*=\s*json\(\s*"([^"\n]*)"\s*\)`, "gu");
const MEMBER_CHARACTERS = String.raw`[\p{L}\p{N}_-]*`;
// A member access that starts a chain is not itself a chain: `a.r.b` does not read the name `r`.
const CHAIN = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.-])(?:json\(\s*"([^"\n]*)"\s*\)|(${NAME}))((?:\.${MEMBER_CHARACTERS})*)`, "gu",
);

function memberList(text: string, from: number): Member[] {
  return [...text.matchAll(new RegExp(String.raw`\.(${MEMBER_CHARACTERS})`, "gu"))].map((match) => {
    const start = from + match.index + 1;
    return { name: match[1]!, start, end: start + match[1]!.length };
  });
}

/** Every `json("…").a.b` and `name.a.b` in the text; a name counts when a `let` binds it to json() earlier. */
function chains(text: string): Chain[] {
  const bindings = [...text.matchAll(BINDING)].map((match) => ({ name: match[1]!, source: match[2]!, at: match.index }));
  const found: Chain[] = [];
  for (const match of text.matchAll(CHAIN)) {
    const source = match[1] ?? bindings.filter((binding) => binding.name === match[2] && binding.at < match.index).at(-1)?.source;
    if (source === undefined) { continue; }
    const end = match.index + match[0].length;
    found.push({ source, members: memberList(match[3]!, end - match[3]!.length), end });
  }
  return found;
}

/** What is being typed after `json("…").` or `name.`, from the text up to the cursor. */
export function findTypstProjectValuePrefix(text: string, offset: number): TypstProjectValuePrefix | undefined {
  const chain = chains(text.slice(0, offset)).find((candidate) => candidate.end === offset && candidate.members.length > 0);
  const typing = chain?.members.at(-1);
  if (!chain || !typing) { return undefined; }
  return { source: chain.source, parent: chain.members.slice(0, -1).map((member) => member.name).join("."), start: typing.start };
}

/** The member path whose last name contains the offset. */
export function findTypstProjectValue(text: string, offset: number): TypstProjectValueReference | undefined {
  for (const chain of chains(text)) {
    const index = chain.members.findIndex((member) => member.start <= offset && offset <= member.end);
    const member = chain.members[index];
    if (member && member.name !== "") {
      const path = chain.members.slice(0, index + 1).map((part) => part.name).join(".");
      return { source: chain.source, path, start: member.start, end: member.end };
    }
  }
  return undefined;
}
