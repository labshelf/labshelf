# Session 1 — core data for the project detail

- **Goal:** core has the `target` key in `labshelf.yaml`, the row and detail types, the extended port and protocol, and a node `readProjectDetail`, all under tests.
- **Starts from:** plan approved (Q1 add `target`, Q2 drop tags, Q3 session-only; if Q1 is "drop", skip 1.1 and every `target` field); the All projects page and host committed. Not while `writing-2-submission-tools` session 01 runs (same contract file).
- **Ends with:** A7 (core part); A6's format half pinned by tests.
- **Owns:** `packages/core/src/writing/project/{projectFile,userKeys}.ts`, `packages/core/src/writing/allProjects/{projectRow,projectDetail,projectLibraryPort,serveAllProjects,index}.ts`, `packages/core/src/writing/allProjects/{protocol,derive,node}/`, `packages/core/src/writing/checks/pdfRules.ts` and its extracted file, `packages/core/src/node/index.ts`, the matching tests under `packages/core/__tests__/writing/`, `documents/contracts/library-format.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | `target` key in labshelf.yaml | contract | implementer (sonnet), then architecture-reviewer | parse/write tests pass, contract updated | [ ] |
| 1.2 | Row, detail, port, protocol, serve, derive | contract | implementer (sonnet), after 1.1 | parser, serve, derive tests pass | [ ] |
| 1.3 | `readProjectDetail`, `readProjectCites` | behaviour | implementer (sonnet), after 1.2 | fixture tests pass | [ ] |
| 1.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1.1 — `target` key in labshelf.yaml

- **Goal:** a project file holds `target: {venue, deadline}`, read, written and validated like `check`.
- **Read only:** `documents/plans/all-projects-detail/research/data-shapes.md` (section "labshelf.yaml target"), `packages/core/src/writing/project/projectFile.ts`, `packages/core/src/writing/project/userKeys.ts`, `packages/core/__tests__/writing/project/projectFile.test.ts`, `documents/contracts/library-format.md` lines 89-146.
- **Decided:** everything in that research section.
- **Done when:** tests (parse ok, empty, wrong type, impossible date, write keeps comments, clear one key, clear both drops `target`) fail first, then pass; core typecheck passes; `architecture-reviewer` on the diff with the research section as the spec.
- **Do not touch:** `check` behaviour, sync, other contract sections.

## 1.2 — Row, detail, port, protocol, serve, derive

- **Goal:** the All projects data contract carries what the new columns and the pane show, and the host can be asked for a detail and the new actions.
- **Read only:** `documents/plans/all-projects-detail/research/data-shapes.md` (Row, Detail, Port and protocol), `research/all-projects-page.md`, `packages/core/src/writing/allProjects/{projectRow,projectLibraryPort,serveAllProjects}.ts`, `protocol/{messages,parseAllProjectsMessage}.ts`, `derive/{projectViewState,deriveProjectView}.ts`, their tests under `packages/core/__tests__/writing/allProjects/`.
- **Decided:** the research sections; new types exported from `allProjects/index.ts`.
- **Done when:** tests fail first, then pass: parser accepts each new message and rejects `../x`, `/etc/x`, `C:\x`, `a/../b`, a bad date; serve posts `detail` success and error, maps `setTarget` clear to `null`; derive sorts by cites, missing last. Core typecheck: remove the Open items column from `dom/projectList.ts` and `dom/projectRowView.ts` minimally so it passes; the rest of the DOM is session 2. `packages/vscode` may fail typecheck until session 3; say so.
- **Do not touch:** other `dom/` files, `packages/vscode`.

## 1.3 — `readProjectDetail` and `readProjectCites`

- **Goal:** one node function reads a project's detail from disk and the library papers; a cheap one gives the row's citation counts.
- **Read only:** `research/node-reader.md`, `research/data-shapes.md` (Detail), `research/writing-data.md`, `packages/core/src/writing/checks/pdfRules.ts` lines 1-20, `checks/node/readPdfFacts.ts`, `checks/limits/wordsUpTo.ts`, `latex/source/project/collectProjectSources.ts`, `citations/{citationKeys,papersByCiteKey,bibliographyFile}.ts`, `versions/node/listVersions.ts` (all under `packages/core/src/writing/`).
- **Decided:** the research section; files `allProjects/node/{index,readProjectDetail,projectCitations}.ts`.
- **Done when:** tests in `packages/core/__tests__/writing/allProjects/node/` on a temp LaTeX project (main + `\input{sections/intro}`, one cite in the library, one in a local `.bib`, one unresolved, a generated `labshelf.bib`, one version; a small PDF fixture reused from the checks tests) fail first, then pass; the pages-rule tests stay green; core typecheck and tests pass.
- **Do not touch:** the checklist, `packages/vscode`.
