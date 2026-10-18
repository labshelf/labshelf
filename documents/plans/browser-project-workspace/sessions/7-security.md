# Session 7 — harden the standalone helper

- **Goal:** close the security gaps of the helper and the bridge it serves; the items that already hold stay as they are.
- **Starts from:** session 6 committed (socket transport, standalone bridge and managed Tinymist in place).
- **Ends with:** every item below marked "add" is done with a test where it is logic, and `helper.md`, `native-host.md`, `managed-tools.md` describe it.
- **Owns:** `packages/core/src/writing/latex/build/node/runLatexBuild.ts`, `latexBuildCommand.ts`, `packages/core/src/writing/latex/toolchain/node/managed/install/`, `packages/core/src/writing/helper/node/{log,lsp}/`, `packages/core/src/nativeHost/node/install/`, `packages/terminal/src/helper/`, `packages/terminal/installers/`, `.github/workflows/helper-release.yml`, the three contracts, their tests.

Runs alone: it changes installers and the release workflow.

Already in place (no work): manifests pinned to our ids (`packages/core/src/nativeHost/hostSpecs.ts`, `node/layout/hostManifest.ts:10-18`); self-update verifies Ed25519 against a pinned key and the asset SHA-256 (`packages/terminal/src/helper/update/latestManifest.ts:20-23`, `updatePublicKey.ts:3`, `selfUpdater.ts:28`); message validation and size limits on stdio (`packages/core/src/writing/helper/parseHelperMessage.ts:24`, `messageFields.ts:64,105`, `node/stdio/frameReader.ts:6,29`) and on the bridge (`packages/core/src/bridge/requestValidation.ts:21,46`, `protocol.ts:11-13`); bridge path containment with realpath and symlink refusal (`packages/core/src/bridge/node/pathConfinement.ts:14-56`); per-user install on macOS and Windows (`installers/windows/labshelf-helper.iss:19-25`); Windows SignPath signing (`helper-release.yml:81-137`); unregister on Windows uninstall (`labshelf-helper.iss:37`) and through dpkg on Linux; spawn without a shell (`runCancellable.ts:48`). The WebSocket rules of D5 are session 5's.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 7.1 | TeX runs without shell escape, files restricted | contract | implementer (sonnet), tests first | env and args tests pass | [ ] |
| 7.2 | Tinymist confined to the project root | contract | implementer (sonnet), tests first | relay tests pass | [ ] |
| 7.3 | Downloads, permissions, logs | contract | implementer (opus), tests first | tests pass | [ ] |
| 7.4 | Release and uninstall | task | main thread | workflow and macOS uninstall in place | [ ] |
| 7.5 | Review | — | architecture-reviewer | no finding left | [ ] |
| 7.6 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 7.1 — TeX restrictions (add)

- **Read only:** `packages/core/src/writing/latex/build/latexBuildCommand.ts:32-35`; `build/node/runLatexBuild.ts:38`; `build/classifyTexProblems.ts:16-33`; `packages/core/src/writing/helper/node/build/runBuildJob.ts:45`; `documents/contracts/helper.md` (No shell-escape).
- **Decided:** every build in every app passes `-no-shell-escape` to the engine through latexmk and sets `openout_any=p` and `openin_any=p` in the child env (community templates are untrusted). Reading files outside the project still works for TeX's own tree under `p`; a project that needs shell escape still ends `needs-shell-escape`. The `.fmt` build of session 3 gets the same flags.
- **Done when:** tests pin args and env for preview, full and format builds.

## 7.2 — Tinymist root (add)

- **Read only:** `packages/core/src/writing/helper/node/lsp/` (session 6); `documents/contracts/helper.md` (`lsp`); `packages/core/src/bridge/node/pathConfinement.ts:14-56`.
- **Decided:** Tinymist starts with the project folder as `--root` and its package cache in the helper's data folder; the relay drops any page message whose `uri` (or `textDocument.uri`, `rootUri`, `workspaceFolders`) resolves outside the project root with `resolveInLibrary`, and any `workspace/executeCommand`; server-to-page `file:` URIs outside the root are dropped and logged.
- **Done when:** tests over a fake child pin the refused URIs and methods.

## 7.3 — Downloads, permissions, logs (add)

- **Read only:** `packages/core/src/writing/latex/toolchain/node/managed/install/tinyTexAsset.ts:7,45`, `installTinyTex.ts:19-21`, `texLiveInstaller.ts:30-44`; `packages/core/src/nativeHost/node/install/launcherFiles.ts:12-17`, `manifestFiles.ts:14`; `packages/terminal/src/helper/update/replaceBinary.ts:12-13`; `packages/core/src/writing/helper/node/log/helperLogger.ts`.
- **Decided:** TinyTeX is pinned like Tinymist: version and per-target SHA-256 in core, no digest from the GitHub API at runtime. TeX Live's `install-tl` archive is checked against CTAN's `.sha512` and its detached `.sha512.asc` signature with the TeX Live public key pinned in core (verified with `node:crypto` if possible, else `gpgv` when present; otherwise the full TeX Live install is refused with a message). The data folder, host folders and `logs/` are created `0o700`, `host.json`, manifests and logs `0o600`, binaries `0o755`; on start the helper refuses to run from a binary or data folder writable by group or others (logged, Windows skipped). The logger redacts the socket token, share keys and URL fragments through one redaction step in `helperLogger.ts`; no message payload is logged.
- **Done when:** tests pin hash mismatch, signature failure, file modes (POSIX) and redaction.

## 7.4 — Release and uninstall (add)

- **Read only:** `.github/workflows/helper-release.yml:81-137`; `packages/terminal/build/sea.mjs:60`; `packages/terminal/installers/macos/build-pkg.sh:20`, `macos/scripts/`; `packages/terminal/installers/linux/README.txt:12`.
- **Decided:** a release fails instead of publishing unsigned Windows artifacts when the SignPath token is missing (today it warns at `helper-release.yml:90`). macOS stays ad-hoc signed (browser-latex-helper D9; plan Q1 here). `labshelf-helper --uninstall` unregisters both hosts and removes `bin/` and the bridge name; the macOS manual and the Linux README name it. The website manual is updated by the docs pass, not here.
- **Done when:** the workflow change is in place; `--uninstall` is tested over a scratch home.
