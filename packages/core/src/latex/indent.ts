// Re-indents LaTeX source: one unit per open environment, brace group and display math, and under each heading until the next of its level or higher.

/** Environments whose body is kept as written, since its spaces are content. */
const VERBATIM_ENVIRONMENTS = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*"]);

/** The sectioning commands, outermost first; a heading's body is indented until a heading of its level or higher. */
const HEADING_LEVELS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
const HEADING = new RegExp(`^\\\\(${HEADING_LEVELS.join("|")})\\*?\\s*[[{]`);

/** An open level: an environment, brace group or display math, closed by its closer; or a heading, closed by the next heading of its level or higher, or by the group it is in. */
type Frame = { kind: "group" } | { kind: "heading"; level: number };

type Token = { kind: "open" | "close"; verbatim?: string };

const ENVIRONMENT = /^\\(begin|end)\s*\{([^}]*)\}/;

/** The line's group openers and closers in order, skipping escapes, `\verb` and the comment. */
function readTokens(line: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at]!;
    if (char === "%") break;
    if (char === "\\") {
      const environment = ENVIRONMENT.exec(line.slice(at));
      if (environment) {
        const name = environment[2]!.trim();
        const open = environment[1] === "begin";
        tokens.push(open && VERBATIM_ENVIRONMENTS.has(name) ? { kind: "open", verbatim: name } : { kind: open ? "open" : "close" });
        at += environment[0].length;
        continue;
      }
      const verb = /^\\verb\*?(.)/.exec(line.slice(at));
      if (verb) {
        const end = line.indexOf(verb[1]!, at + verb[0].length);
        at = end < 0 ? line.length : end + 1;
        continue;
      }
      const next = line[at + 1];
      if (next === "[") tokens.push({ kind: "open" });
      else if (next === "]") tokens.push({ kind: "close" });
      // Any other escaped character, such as \{, \%, or the \\ line break, is text.
      at += 2;
      continue;
    }
    if (char === "{") tokens.push({ kind: "open" });
    else if (char === "}") tokens.push({ kind: "close" });
    at += 1;
  }
  return tokens;
}

/** How many closers the line starts with, before any other text, which put the line itself one level out each. */
function countLeadingClosers(code: string, tokens: readonly Token[]): number {
  let count = 0;
  let rest = code.trimStart();
  while (count < tokens.length && tokens[count]!.kind === "close") {
    const closer = /^(\\end\s*\{[^}]*\}|\\\]|\})\s*/.exec(rest);
    if (!closer) break;
    count += 1;
    rest = rest.slice(closer[0].length);
  }
  return count;
}

/** Closes the innermost group and the headings inside it. */
function closeGroup(stack: Frame[]): void {
  while (stack.length > 0 && stack.pop()!.kind !== "group") { /* a heading inside the group ends with it */ }
}

/** Closes the headings of `level` or deeper, which a new heading of that level ends. */
function closeHeadings(stack: Frame[], level: number): void {
  for (let top = stack.at(-1); top?.kind === "heading" && top.level >= level; top = stack.at(-1)) stack.pop();
}

/**
 * The leading whitespace each line should have, in `unit` steps; undefined for a line kept as it is
 * (the body of a verbatim environment). Blank lines get an empty indent.
 */
export function deriveLatexIndents(lines: readonly string[], unit: string): (string | undefined)[] {
  const stack: Frame[] = [];
  let verbatim: string | undefined;
  // A heading's body starts once its title's groups have closed, so a title broken over lines indents as a group.
  let heading: { level: number; depth: number } | undefined;
  return lines.map((line) => {
    if (verbatim !== undefined) {
      if (!new RegExp(`^\\s*\\\\end\\s*\\{${verbatim.replace(/[*]/g, "\\*")}\\}`).test(line)) return undefined;
      verbatim = undefined;
      closeGroup(stack);
      return unit.repeat(stack.length);
    }
    if (line.trim() === "") return "";
    const tokens = readTokens(line);
    const command = HEADING.exec(line.trimStart());
    let indent: number;
    if (command) {
      const level = HEADING_LEVELS.indexOf(command[1]!);
      closeHeadings(stack, level);
      indent = stack.length;
      heading = { level, depth: stack.length };
    } else {
      const shown = [...stack];
      for (let closers = countLeadingClosers(line, tokens); closers > 0; closers--) closeGroup(shown);
      indent = shown.length;
    }
    for (const token of tokens) {
      if (token.kind === "open") stack.push({ kind: "group" });
      else closeGroup(stack);
      if (token.verbatim !== undefined) { verbatim = token.verbatim; break; }
    }
    if (heading && stack.length <= heading.depth) {
      stack.push({ kind: "heading", level: heading.level });
      heading = undefined;
    }
    return unit.repeat(indent);
  });
}

/** The whole text re-indented with `unit`; lines keep their content and trailing text. */
export function indentLatex(text: string, unit: string): string {
  const lines = text.split("\n");
  const indents = deriveLatexIndents(lines, unit);
  return lines.map((line, index) => {
    const indent = indents[index];
    return indent === undefined ? line : indent + line.trimStart();
  }).join("\n");
}
