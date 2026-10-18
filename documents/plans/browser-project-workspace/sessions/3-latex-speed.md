# Session 3 — faster LaTeX builds in core

- **Goal:** D6 (a)–(c): preamble format cache, one-pass preview builds with the full build on save or idle, automatic `\includeonly` of the chapter being edited.
- **Starts from:** plan approved.
- **Ends with:** core's Node LaTeX build takes `mode: "preview" | "full"` and an optional edited file; VS Code, the terminal app and the helper pass through the same API; A8 (first half) passes in tests.
- **Owns:** `packages/core/src/writing/latex/build/`, its tests; call-site changes in `packages/vscode/src/writing/` and `packages/terminal/src/` that only add the new arguments.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Preamble `.fmt` cache | behaviour | implementer (opus) | cache hit/miss tests pass | [ ] |
| 3.2 | Preview vs full, `\includeonly` | behaviour | implementer (opus) | mode and includeonly tests pass | [ ] |
| 3.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3.1 — Preamble format cache

- **Goal:** a preview build with an unchanged preamble starts from a cached `.fmt`.
- **Read only:** `packages/core/src/writing/latex/build/latexBuildCommand.ts`, `build/node/runLatexBuild.ts`, `build/node/runCancellable.ts`, `build/buildResult.ts`; `documents/contracts/managed-tex.md` (Resolution).
- **Decided:** the preamble is the text before `\begin{document}` of the main file plus the bytes of local files it `\input`s; its SHA-256 names `<buildDir>/.labshelf-fmt/<hash>.fmt`, built with `etex -ini` + `mylatexformat.ltx` for the project's engine; the build passes `-fmt` and a `%&` line through latexmk's `-pdflatex=` command string. A failed format build is logged and the build runs without it (fallback logged, AGENTS.md section 6). Old `.fmt` files of the same project are deleted when a new hash is built. Engines without mylatexformat support (check LuaLaTeX) skip the cache with a log line.
- **Done when:** tests over a fake runner: same preamble → one format build for two compiles; changed preamble → rebuild; format failure → build still runs; `pnpm --filter @labshelf/core test`.
- **Do not touch:** `core/src/writing/helper/`, `core/src/writing/latex/toolchain/`.

## 3.2 — Preview and full builds, `\includeonly`

- **Goal:** preview builds run one pass; the full build runs bibliography and extra passes; a preview of a multi-chapter document compiles only the edited chapter.
- **Read only:** the files of 3.1; `packages/core/src/writing/latex/source/` index (include graph from `scanLatexSource`); the vscode and terminal call sites of `runLatexBuild` (find with one grep of `runLatexBuild(`).
- **Decided:** `mode: "preview"` runs the engine once (`-interaction=nonstopmode`, no biber/bibtex, no rerun); `"full"` keeps latexmk's full behaviour and is what save and idle (callers decide, 2 s) trigger. When `editedFile` is a file included with `\include{}` from main, preview passes `\includeonly{<that>}` through a generated wrapper `\def` before `\input{main}`, so the source is unchanged; other chapters' counters come from their `.aux` of the last full build, which preview never deletes. Without a full build yet, preview runs full.
- **Done when:** tests pin pass count per mode, the wrapper text, and fallback to full without prior `.aux`; core, vscode and terminal typecheck and test.
- **Do not touch:** `core/src/writing/helper/`.
