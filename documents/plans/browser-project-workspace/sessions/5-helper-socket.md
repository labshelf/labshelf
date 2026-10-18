# Session 5 — helper protocol over a loopback socket

- **Goal:** `documents/contracts/helper.md` describes and core implements the D5 transport: native-messaging handshake, then a token- and origin-checked WebSocket on 127.0.0.1 with commands limited to opened projects, edits instead of whole files, and changed pages instead of whole PDFs.
- **Starts from:** session 4 committed (the standalone helper serves `app.labshelf.bridge` and knows the library root); `documents/plans/browser-project-workspace/research/transport-spike.md` written by session 1.
- **Ends with:** A6 passes in tests; the browser client connects through the socket (or native messaging where session 1 found the socket blocked) and builds a LaTeX project; `PROTOCOL_VERSION` raised.
- **Owns:** `documents/contracts/helper.md`, `packages/core/src/writing/helper/` (except `editorHost/`), its tests, `packages/browser/src/helper/client/`, its tests, the `connect-src`/`host_permissions` lines of both browser manifests.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Contract text | contract | main thread (opus) | helper.md describes the new transport and messages | [ ] |
| 5.2 | Failing tests for the contract | contract | test-writer (sonnet) | tests fail for the expected reason | [ ] |
| 5.3 | Core socket server and session | contract | implementer (opus) | 4.2 passes | [ ] |
| 5.4 | Browser client | contract | implementer (sonnet) | client tests pass, real build over the socket | [ ] |
| 5.5 | Review | — | architecture-reviewer | no Standards or Spec finding left | [ ] |
| 5.6 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 5.1 — Contract

- **Goal:** helper.md is the single description of the new protocol.
- **Read only:** `documents/contracts/helper.md` (all); `documents/contracts/native-host.md` (Manifests); `research/transport-spike.md` of this plan.
- **Decided:** native messaging carries `hello` → `ready` plus a new `session` reply `{port, token, origin}`: the helper binds `127.0.0.1` on port 0, draws 32 random bytes as token (base64url), records the page's origin sent in `hello` (`origin`: `location.origin`), and refuses any upgrade whose `Origin` differs or whose first frame lacks the token. Frames on the socket are binary: a 4-byte little-endian JSON header length, the JSON envelope, then raw payload bytes (no base64). New messages: `openProject {projectId, root}` (`root` is the project's path inside the library root the bridge host reads; the helper resolves it and every later `path` with core `resolveInLibrary` from `packages/core/src/bridge/node/pathConfinement.ts:14-56`, which refuses symlink escapes, and remembers it), `closeProject`, `edit {projectId, path, changes: {from, to, insert}[], version}` (applied to the helper's in-memory text; the file is written by the page's save, never by the helper), `save {projectId, path}` notification, `compile {projectId, main, mode}` → `pages {pdfSha256, pageCount, changed: {index, bytes}[]}` (only pages whose content hash differs from the last result), `lsp {projectId, payload}` both ways for Typst (session 6 fills the server side). Removed: `sync`, `need`, `file`, `delete`, the source mirror and the chunk rule for socket frames; the build dir stays in the helper's data folder. No message runs a command or reads a path outside an opened root. Limits table keeps paths, adds max frame 16 MiB and max opened projects 8. No migration (D11).
- **Done when:** the contract reads in present tense, every message has a body and reply, limits and rejections are listed.

## 5.2 — Failing tests

- **Read only:** helper.md after 4.1; `packages/core/src/writing/helper/parseHelperMessage.ts`, `helperMessages.ts`, `helperPaths.ts`; `packages/core/src/writing/helper/node/dispatch/dispatcher.ts`, `runHelperHost.ts`; existing tests under `packages/core/__tests__/writing/helper/`.
- **Decided:** seams: `parseHelperMessage` for the new types; a `startHelperSocket({token, origin, logger})` server in `core/src/writing/helper/node/socket/` tested with a real loopback client: wrong token, wrong origin, missing token, path outside root, symlink escape, oversize frame, unknown type → refused or `error`; an `edit` then `compile` returns only changed page indices (fake compiler).
- **Done when:** tests fail because the code is missing, not on syntax.

## 5.3 — Core server

- **Read only:** the files of 4.2; `packages/core/src/writing/helper/node/mirror/projectMirror.ts`, `node/build/runBuildJob.ts`, `node/build/sendBuiltPdf.ts`.
- **Decided:** WebSocket handshake by hand over `node:http` `upgrade` (RFC 6455 framing, binary only, no extensions), so no dependency; page splitting with pdf.js is not used on Node — the helper hashes pages from the PDF's page objects through `pdf-lib` only if already a core dependency, otherwise it sends the whole PDF with `changed` = all pages and logs it (session 11 adds LaTeX page diff). Log every refused connection with reason.
- **Done when:** 4.2 passes; core typecheck; size limits.
- **Do not touch:** `packages/core/src/writing/latex/`, `editorHost/`.

## 5.4 — Browser client

- **Read only:** `packages/browser/src/helper/client/browserLatexHelper.ts`, `createNativeLatexHelper.ts`, `connection/`, `project/syncProject.ts`, `project/buildProject.ts`; `packages/core/src/writing/helper/latexHelper.ts:9-39`.
- **Decided:** `ILatexHelper` grows `openProject`, `edit`, `compile(mode)` returning `pages`; the client opens the native port for the handshake, then the socket; where session 1 found the socket blocked, the same messages run over the native port. `project/syncProject.ts` and the mirror code in `core/src/writing/helper/node/mirror/` are deleted. The setup card in `helper/setup/` is untouched apart from imports.
- **Done when:** client tests over a fake socket pass; a real build of a template through the helper in headless Chrome for Testing succeeds (report what was not checked).
