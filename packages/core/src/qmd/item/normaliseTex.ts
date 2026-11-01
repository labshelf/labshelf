// Rewrites the LaTeX forms that the TeX reader misreads or rejects (plan math-in-prose, decision D2) into forms it parses correctly. Pure string code.

export type TexRewrite = "euler-e" | "differential" | "leibniz" | "newton-dot" | "derivative-operator" | "implicit-product";

export interface NormalisedTex { tex: string; rewrites: TexRewrite[] }

const OPEN = "";
const CLOSE = "";
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

// Index just after the argument that starts at `start` (a braced group, a command, or one character), or -1 when there is none.
function argEnd(s: string, start: number): number {
  const c = s[start];
  if (c === undefined) return -1;
  if (c === "{") {
    let depth = 0;
    for (let i = start; i < s.length; i += 1) {
      if (s[i] === "{") depth += 1;
      else if (s[i] === "}") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  if (c === "\\") {
    const m = /^\\[A-Za-z]+/.exec(s.slice(start));
    return m ? start + m[0].length : start + 2;
  }
  return start + 1;
}

// e^X, e^{X} and \mathrm{e}^{X} become \exp\left(X\right), a lone \mathrm{e} becomes \exp\left(1\right); a lone e stays a variable.
function rewriteEuler(s: string, hit: { value: boolean }): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    let base = 0;
    if (s.startsWith("\\mathrm{e}", i)) base = "\\mathrm{e}".length;
    else if (s[i] === "e" && !/[A-Za-z\\]/.test(s[i - 1] ?? "")) base = 1;
    if (base > 0 && s[i + base] === "^") {
      const argStart = i + base + 1;
      const end = argEnd(s, argStart);
      if (end > 0) {
        let arg = s.slice(argStart, end);
        if (arg.startsWith("{")) arg = arg.slice(1, -1);
        out += `\\exp\\left(${rewriteEuler(arg, hit)}\\right)`;
        hit.value = true;
        i = end;
        continue;
      }
    }
    if (base === "\\mathrm{e}".length && s[i + base] !== "^") {
      out += "\\exp\\left(1\\right)";
      hit.value = true;
      i += base;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

// \mathrm{d}x and a bare dx that ends an integrand become \,dx; only inside a TeX that has an \int.
function rewriteDifferential(s: string): { tex: string; hit: boolean } {
  if (!s.includes("\\int")) return { tex: s, hit: false };
  let hit = false;
  const re = /(\\,\s*|\s*)(?:\\mathrm\{d\}\s*|(?<![A-Za-z\\])d)([A-Za-z])(?=\s*(?:$|=|\\approx|\}))/g;
  const tex = s.replace(re, (whole, _lead: string, v: string) => {
    const next = `\\,d${v}`;
    if (next !== whole) hit = true;
    return next;
  });
  return { tex, hit };
}

// Rewrites whole-symbol occurrences of the dependent variables to name(independent).
function rewriteBareSymbols(s: string, deps: Map<string, string>): string {
  if (deps.size === 0) return s;
  return s.replace(/[A-Za-z]/g, (ch, offset: number) => {
    const indep = deps.get(ch);
    if (indep === undefined) return ch;
    const before = s.slice(0, offset);
    const after = s.slice(offset + 1);
    if (/\\[A-Za-z]*$/.test(before)) return ch;
    if (/(^|[^A-Za-z])d$/.test(before)) return ch;
    if (/^[A-Za-z(_']/.test(after)) return ch;
    return `${ch}(${indep})`;
  });
}

// Index just after the parenthesis group that opens at `start` with `(` or `\left(`, or -1 when it does not close.
function groupEnd(s: string, start: number): number {
  if (s.startsWith("\\left", start)) {
    let depth = 0;
    for (let i = start; i < s.length; i += 1) {
      if (/^\\left(?![A-Za-z])/.test(s.slice(i, i + 6))) depth += 1;
      else if (/^\\right(?![A-Za-z])/.test(s.slice(i, i + 7))) {
        depth -= 1;
        if (depth === 0) return argEnd(s, i + "\\right".length);
      }
    }
    return -1;
  }
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// A whole single-letter symbol before ( or \left( gets \, so it reads as a product, unless the parenthesis holds only single letters separated by commas.
function rewriteImplicitProduct(s: string): { tex: string; hit: boolean } {
  let hit = false;
  const re = /(?<![A-Za-z\\])([A-Za-z])(\s*)(?=\\left\(|\()/g;
  const tex = s.replace(re, (whole, letter: string, space: string, offset: number) => {
    const open = offset + whole.length;
    const end = groupEnd(s, open);
    const opener = s.startsWith("\\left(", open) ? "\\left(".length : 1;
    const closer = s.startsWith("\\left(", open) ? "\\right)".length : 1;
    const inner = end > 0 ? s.slice(open + opener, end - closer) : "";
    if (end > 0 && inner.split(",").every((part) => /^\s*[A-Za-z]\s*$/.test(part))) return whole;
    hit = true;
    return `${letter}${space}\\,`;
  });
  return { tex, hit };
}

export function normaliseTex(tex: string): NormalisedTex {
  const found = new Set<TexRewrite>();
  const slots: string[] = [];
  const deps = new Map<string, string>();
  const stash = (text: string): string => {
    slots.push(text);
    return `${OPEN}${slots.length - 1}${CLOSE}`;
  };

  let s = tex.replace(
    /\\frac\{\s*(?:\\mathrm\{d\}|d)\s*\}\{\s*(?:\\mathrm\{d\}|d)\s*([A-Za-z])\s*\}/g,
    (_w, v: string) => {
      found.add("derivative-operator");
      return stash(`\\frac{d}{d${v}}`);
    },
  );
  s = s.replace(
    /\\frac\{d(?:\^\{?(\d+)\}?)?([A-Za-z])\}\{d([A-Za-z])(?:\^\{?\d+\}?)?\}/g,
    (_w, order: string | undefined, dep: string, indep: string) => {
      found.add("leibniz");
      if (!deps.has(dep)) deps.set(dep, indep);
      return stash(`${dep}${"'".repeat(order ? Number(order) : 1)}(${indep})`);
    },
  );
  s = s.replace(/\\(d?d)ot\{([A-Za-z])\}/g, (_w, d: string, dep: string) => {
    found.add("newton-dot");
    if (!deps.has(dep)) deps.set(dep, "t");
    return stash(`${dep}${"'".repeat(d.length)}(t)`);
  });

  const euler = { value: false };
  s = rewriteEuler(s, euler);
  if (euler.value) found.add("euler-e");

  const diff = rewriteDifferential(s);
  s = diff.tex;
  if (diff.hit) found.add("differential");

  s = rewriteBareSymbols(s, deps);
  s = s.replace(PLACEHOLDER, (_w, n: string) => slots[Number(n)] ?? "");

  const product = rewriteImplicitProduct(s);
  s = product.tex;
  if (product.hit) found.add("implicit-product");

  const order: TexRewrite[] = ["euler-e", "differential", "leibniz", "newton-dot", "derivative-operator", "implicit-product"];
  return { tex: s, rewrites: order.filter((r) => found.has(r)) };
}
