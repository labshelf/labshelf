# Session 9 — LaTeX section preview

- **Goal:** D6 (d): while the user types in section N, the preview build compiles only section N on the preamble `.fmt` with the state captured from the last full build, and swaps only its pages; the full build replaces the result when it ends.
- **Starts from:** session 7 committed (session 3's `.fmt` and preview mode in place).
- **Ends with:** A8 (second half) in tests and a timed run; the helper returns changed LaTeX pages.
- **Owns:** `packages/core/src/writing/latex/build/section/`, its tests, the LaTeX page diff in `packages/core/src/writing/helper/node/build/`.

Runs with session 8.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 9.1 | State capture and restore | behaviour | implementer (opus), tests first | capture/restore tests pass | [ ] |
| 9.2 | Section document assembly and page swap | behaviour | implementer (opus), tests first | assembly and swap tests pass | [ ] |
| 9.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 9.1 — State capture

- **Read only:** `packages/core/src/writing/latex/build/` index and the `.fmt` module from session 3; `packages/core/src/writing/latex/source/scan/commands/scanSections.ts`; `node/runLatexBuild.ts`.
- **Decided:** the full build adds a small `.sty` (`labshelf-state.sty`, written into the build dir, never into the project) that at each sectioning command writes to `<job>.lsstate` the values of every LaTeX counter (`\cl@@ckpt` list), the absolute page number and the current label set. Restoring sets those counters and `\setcounter{page}` before section N's text; labels and refs come from the full build's `.aux`, read through `\input` of a filtered copy.
- **Done when:** tests run the capture over a fixture with a real TeX if present (skipped with a log when not) and pin the parser of `.lsstate` without TeX.

## 9.2 — Assembly and page swap

- **Read only:** 9.1 output; `packages/core/src/writing/latex/source/` index (macro definitions: `\newcommand`, `\def`, `\DeclareMathOperator`); `packages/core/src/writing/helper/node/build/sendBuiltPdf.ts`; helper.md (`pages`).
- **Decided:** the section document is `%&<fmt>` + restored state + every macro definition found in the body before section N (in order) + section N's text + `\end{document}`. A section with `\include`, `\input` of a file that defines macros, or a float that crosses the boundary is detected and falls back to the chapter preview of session 3 (logged). The helper maps section N's output pages onto the page range of section N in the last full PDF (from `.lsstate`) and sends those indices as `changed`; page count differences send everything after N.
- **Done when:** tests pin assembly text, the fallback cases and the page mapping; a timed run on a 100-page fixture reports full vs section build time.
