# Plan: LaTeX in the browser through LabShelf Helper

Status: draft
Size: 8 sessions. It covers a new process (the helper), a cross-app protocol, TeX installation on three OSes, a release pipeline and browser UI.

## 1. Goal

A person who uses only the browser extension can compile a LaTeX project. The first time they press Compile, a guided card asks them to download "LabShelf Helper" for their OS. They double-click the installer and pick a light (TinyTeX) or full (TeX Live) LaTeX in the card, and from then on builds run on their machine at local speed with no terminal. LabShelf stays free and open source: Windows binaries are signed by the SignPath Foundation, every binary has a published SHA-256 and a GitHub build attestation, and macOS users get a tutorial for the one-time "Open Anyway" step.

## 2. Decisions

- [ ] **D1** Placement, following AGENTS.md section 1:
  - **Core:** the runtime-neutral protocol (message types, validation, chunking, `PROTOCOL_VERSION`) and the client port `ILatexHelper`, in `packages/core/src/writing/helper/`.
  - **Helper:** a second entry of the terminal package, in `packages/terminal/src/helper/`, built to `dist/labshelf-helper.mjs` and packaged as a single binary `labshelf-helper`. It lives in the terminal package because that is the Node desktop app and already bundles core's Node build code.
  - **Browser:** the `connectNative` adapter and the setup card, in `packages/browser/src/helper/`.

  Why: browser and helper share the protocol, so it goes in core. The separate entry keeps pdf.js, canvas and tesseract (terminal externals) out of the binary.
- [ ] **D2** The protocol is a contract in `documents/contracts/helper.md`:
  - **Transport:** native messaging, host name `dev.labshelf.helper`. Every message is `{ v, id, type, … }`.
  - **Message types:** `hello`/`ready` (protocol and helper version, TeX state), `sync`/`need`/`file`/`delete` (only changed files, by SHA-256), `build`/`progress`/`built`/`pdf`, `cancel`, `installTex`, `installAllPackages`, `error`.
  - **Chunks:** binary payloads travel in base64 chunks of at most 512 KiB raw, under the 1 MB host-to-browser limit, with the same size in both directions.
  - **Limits:** paths are relative POSIX, with no `..`, no leading `/`, no `\` and no NUL. The contract also caps file count and project size.
  - **Engines:** `pdflatex`, `xelatex` and `lualatex`. Never Tectonic and never shell-escape.

  Why: one place both apps and the tests pin.
- [ ] **D3** An extension page owns the port: `connectNative` is called from the page that compiles (the editor or the options page), not from the service worker. Why: the PDF bytes go straight to the page, the 199-line runtime router stays as it is, and the page lifetime bounds the port.
- [ ] **D4** The helper keeps its data in one per-user folder:
  - macOS: `~/Library/Application Support/LabShelf Helper/`;
  - Windows: `%LOCALAPPDATA%\LabShelf Helper\`;
  - Linux: `$XDG_DATA_HOME/labshelf-helper/`.

  It holds `projects/<projectId>/` (a source mirror plus build dir, so latexmk reruns only what changed), `tex/` (managed TeX), `bin/` and `logs/`. The helper writes nowhere else, and its stdout carries only protocol frames; logs go to `logs/`.
- [ ] **D5** TeX choice. The card in the extension asks right after the helper first connects:
  - **Light (TinyTeX, ~100 MB):** packages install on demand.
  - **Full (TeX Live, ~5 GB download):** everything included, works offline.

  The native installers only lay down the helper. Why: one implementation with the core look and product copy, instead of three installer UIs (pkg, Inno, deb). The person makes the choice at the same moment of setup.

  If a system TeX is found (latexmk in PATH or in known TeX dirs), the helper uses it and the card skips the choice. Sizes are confirmed in research.
- [ ] **D6** Missing packages and offline use:
  - **Missing packages:** on managed TinyTeX, a build that fails on a missing file runs `tlmgr search --global --file`, installs the package, reports `progress` and rebuilds, up to 10 rounds per build. Each round is logged.
  - **Offline:** "Download all packages" (`tlmgr install scheme-full`) is offered for TinyTeX. It replaces a separate TeX Live install for offline use.
  - **Engine mismatch:** a project that needs pdfLaTeX or LuaLaTeX works in both modes, because TinyTeX is TeX Live.
- [ ] **D7** Annual TeX Live rollover is detected from tlmgr's "remote repository is newer" failure:
  - **Managed TinyTeX:** reinstalls the new year automatically and keeps its installed package list.
  - **Managed full TeX Live:** asks first, because it is 5 GB.
  - **System TeX:** never touched; the helper only reports the error.
- [ ] **D8** Distribution:
  - **Binaries:** Node single executable application (SEA) on Node 22, matching `engines`, for darwin-arm64, darwin-x64, win-x64, linux-x64 and linux-arm64. macOS binaries get an ad-hoc signature (`codesign -s -`), which Apple Silicon requires after SEA injection.
  - **macOS installer:** per-user `.pkg` (home-domain install).
  - **Windows installer:** per-user Inno Setup (`PrivilegesRequired=lowest`).
  - **Linux:** `.deb`, which asks for the password because Linux has no per-user native-messaging location for packages, plus a `.tar.gz`.
  - **Registration:** every installer ends by running `labshelf-helper --register`, and uninstall runs `--unregister`. Registration lives in one place, the helper. It writes host manifests for every installed browser it finds: Chrome, Chromium, Edge, Brave, Vivaldi (`allowed_origins`) and Firefox (`allowed_extensions: ["labshelf@lucanaasser.dev"]`).
- [ ] **D9** Trust:
  - **Signing:** Windows binaries and installers are signed through the SignPath Foundation. macOS stays unsigned (no US$ 99/yr), and Linux stays unsigned.
  - **Verification:** every artifact gets `SHA256SUMS` and a GitHub artifact attestation (`actions/attest-build-provenance`).
  - **Self-update:** the helper checks `latest.json` from GitHub Releases at most once a day, on `hello`. It verifies an Ed25519 signature with `node:crypto` against a public key embedded in the binary, then downloads through core's `downloadVerified`. On Windows it swaps the binary by rename-then-replace.

  Why Ed25519 through `node:crypto` and not minisign: the stdlib does it, so no tool or dependency is needed (AGENTS.md section 3, ladder). Self-update also means the macOS Gatekeeper step happens once.
- [ ] **D10** Extension manifests:
  - add `nativeMessaging` to `manifest.chrome.json` and `manifest.firefox.json`;
  - add a `key` to `manifest.chrome.json` so the unpacked id is stable;
  - the helper's `allowed_origins` lists that id, plus the Chrome Web Store id once it exists.
- [ ] **D11** This plan reverses D5 and D8 of `documents/plans/browser-editor/plan.md` and changes its goal line, D7, A6 and sessions 02 and 03. LaTeX compiles through the helper, and the card appears when it is missing. writing-4's editor mounts this plan's setup card and calls `ILatexHelper`; this plan does not build the editor.
- [ ] **D12** Prerequisite: session 1 of `documents/plans/writing-3-writing-terminal` must land first (core `buildProject`, `ProjectBuildQueue`, `ToolchainPrompt`). The helper supplies a non-interactive `ToolchainPrompt` that never offers Tectonic.
- [ ] **D13** Out of scope: shell-escape and `minted` (a build that needs them fails with a clear message), Typst (browser-editor compiles it with `typst.ts`), Safari, and a macOS Developer ID.

User tasks (outside the code, before session 5 can fully pass):

- **U1** Make the repository public under an OSI license and apply to the SignPath Foundation. Session 6 writes the code signing policy page their review needs.
- **U2** Run `scripts/helperReleaseKey.mjs` (session 3b) once and store the private key as the `HELPER_UPDATE_KEY` Actions secret.
- **U3** When the extension is on the Chrome Web Store, add its id to the helper's allowed origins.

## 3. Acceptance

- [ ] **A1** In a fresh profile with no helper, Compile shows the card with the download for the current OS. After installing, the card moves on to the TeX choice without a reload.
- [ ] **A2** With Light, a template that uses packages outside TinyTeX compiles. The missing packages install automatically, and the card or editor shows each one.
- [ ] **A3** With Full, TeX Live installs unattended with no admin prompt (macOS and Windows) and no terminal.
- [ ] **A4** With a system TeX present, the helper uses it and no choice is offered.
- [ ] **A5** After a one-file edit, the next build sends only that file. A PDF over 1 MB arrives byte-identical (SHA-256 matches).
- [ ] **A6** Messages with `../`, absolute paths, oversize payloads, unknown types or a wrong protocol are rejected with `error`, and nothing is written outside the project folder (tests).
- [ ] **A7** A project that needs shell-escape fails with a message that names the reason, and no shell command runs.
- [ ] **A8** A tampered `latest.json` or binary is rejected, and a valid one replaces the helper (tests; Windows replace in CI).
- [ ] **A9** A tagged release produces binaries and installers for the five targets, `SHA256SUMS` and attestations, and `gh attestation verify` passes. After U1, the Windows installer shows a SignPath signature.
- [ ] **A10** The macOS tutorial is on the website manual, with the macOS 15+ flow and why the helper is unsigned. The user follows it on a Mac.
- [ ] **A11** A simulated year rollover (fake tlmgr) reinstalls managed TinyTeX and keeps its packages, and asks first for managed TeX Live (tests).
- [ ] **A12** The same flow works in Firefox with the gecko id.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1a | [sessions/1a-contract.md](sessions/1a-contract.md) | protocol contract and core protocol | `documents/contracts/helper.md`, `packages/core/src/writing/helper/`, its tests | 1b |
| 1b | [sessions/1b-research.md](sessions/1b-research.md) | research, browser-editor amended, extension key | `research/`, `documents/plans/browser-editor/`, `key` in `manifest.chrome.json` | 1a |
| 2 | [sessions/2-host.md](sessions/2-host.md) | helper process: framing, mirror, build | `packages/terminal/src/helper/` (not `tex/`, `register/`, `update/`), its tests, `packages/terminal/build/build.mjs` | 4 |
| 3a | [sessions/3a-tex.md](sessions/3a-tex.md) | managed TinyTeX / TeX Live, packages, rollover | `packages/terminal/src/helper/tex/`, `helper/main.ts`, its tests | 4 |
| 3b | [sessions/3b-register-update.md](sessions/3b-register-update.md) | browser registration, verified self-update | `helper/register/`, `helper/update/`, `helper/main.ts`, `scripts/helperReleaseKey.mjs` | 4 |
| 4 | [sessions/4-browser.md](sessions/4-browser.md) | `ILatexHelper` adapter, manifests, setup card | `packages/browser/src/helper/`, its tests, manifest permissions, `options/index.ts` | 2, 3a or 3b |
| 5 | [sessions/5-release.md](sessions/5-release.md) | SEA binary, installers, release workflow | `.github/`, `packages/terminal/build/sea.mjs`, `packages/terminal/installers/` | alone |
| 6 | [sessions/6-docs-run.md](sessions/6-docs-run.md) | macOS tutorial, signing policy, docs, real run, finish | `website/`, `documents/apps/`, `documents/architecture.md` | alone |

Order: 1a + 1b → 2 → 3a → 3b → 5 → 6, with 4 alongside 2 or 3 after 1a and 1b. Session 2 also waits for session 1 of `writing-3-writing-terminal` (D12).
