// Splits one math into its steps (plan D9): top-level `=` / `&=` pairs, chained across aligned lines, with TeX offsets.

export interface MathStep { lhs: string; rhs: string; line: number; from: number; to: number }

interface Segment { text: string; from: number; to: number }

const ALIGN_ENVS = ["aligned", "alignedat", "align", "align*", "alignat", "alignat*", "split", "eqnarray", "eqnarray*", "gather", "gathered"];

/** The range of the content of the first aligned-like environment, or the whole math. */
function contentRange(tex: string): [number, number] {
  const begin = /\\begin\{([^}]*)\}/g;
  for (let m = begin.exec(tex); m; m = begin.exec(tex)) {
    const name = m[1] ?? "";
    if (!ALIGN_ENVS.includes(name)) continue;
    const start = m.index + m[0].length;
    const end = tex.lastIndexOf(`\\end{${name}}`);
    if (end >= start) return [start, end];
  }
  return [0, tex.length];
}

/** Top-level `\\` ranges and `=` positions in [from, to), skipping groups, scripts and nested environments. */
function scan(tex: string, from: number, to: number): { breaks: [number, number][]; equals: number[] } {
  const breaks: [number, number][] = [];
  const equals: number[] = [];
  let depth = 0;
  let i = from;
  while (i < to) {
    const c = tex.charAt(i);
    if (c === "\\") {
      if (tex.charAt(i + 1) === "\\") {
        if (depth === 0) {
          let end = i + 2;
          const opt = /^\s*\[[^\]]*\]/.exec(tex.slice(end, to));
          if (opt) end += opt[0].length;
          breaks.push([i, end]);
          i = end;
        } else i += 2;
        continue;
      }
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1, to));
      if (name) {
        if (name[0] === "begin") depth++;
        else if (name[0] === "end") depth--;
        i += 1 + name[0].length;
      } else i += 2;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "=" && depth === 0) {
      let p = i - 1;
      while (p >= from && /\s/.test(tex.charAt(p))) p--;
      const prev = p >= from ? tex.charAt(p) : "";
      if (prev !== "_" && prev !== "^" && prev !== "<" && prev !== ">" && prev !== "!" && tex.charAt(i + 1) !== "=") equals.push(i);
    }
    i++;
  }
  return { breaks, equals };
}

/** The segment of tex[from, to) with whitespace and alignment `&` trimmed from both ends. */
function segment(tex: string, from: number, to: number): Segment | null {
  let a = from;
  let b = to;
  while (a < b && /[\s&]/.test(tex.charAt(a))) a++;
  while (b > a && /[\s&]/.test(tex.charAt(b - 1))) b--;
  return a < b ? { text: tex.slice(a, b), from: a, to: b } : null;
}

export function splitSteps(tex: string): MathStep[] {
  const [start, end] = contentRange(tex);
  const { breaks, equals } = scan(tex, start, end);
  const steps: MathStep[] = [];
  let prevRhs: Segment | null = null;
  let lineStart = start;
  for (let line = 0; line <= breaks.length; line++) {
    const brk = breaks[line];
    const lineEnd = brk ? brk[0] : end;
    const cuts = equals.filter((e) => e >= lineStart && e < lineEnd);
    const bounds = [lineStart - 1, ...cuts, lineEnd];
    const segs: (Segment | null)[] = [];
    for (let k = 0; k < bounds.length - 1; k++) segs.push(segment(tex, (bounds[k] ?? 0) + 1, bounds[k + 1] ?? 0));
    if (cuts.length > 0) {
      if (!segs[0] && prevRhs) segs[0] = prevRhs;
      for (let k = 0; k < segs.length - 1; k++) {
        const lhs = segs[k];
        const rhs = segs[k + 1];
        if (lhs && rhs) steps.push({ lhs: lhs.text, rhs: rhs.text, line, from: lhs.from, to: rhs.to });
      }
      prevRhs = segs[segs.length - 1] ?? null;
    } else if (segs[0]) prevRhs = null;
    if (brk) lineStart = brk[1];
  }
  return steps;
}
