/** Keys LaTeX source paths the way TeX resolves them, so `./chap`, `chap` and `chap.tex` name one file. */

export function sourcePathKey(path: string): string {
  return path.trim().replace(/^(\.\/)+/, "").replace(/\.tex$/, "");
}

export function sourcesByKey(sources: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(sources).map(([path, text]) => [sourcePathKey(path), text]));
}
