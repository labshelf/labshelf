sha: 0069f02
files: documents/contracts/{managed-tools,helper,native-host}.md, packages/core/src/latex/toolchain/node/managedTex/**, packages/core/src/latex/toolchain/{tinyTex.ts,node/downloadVerified.ts}, packages/core/src/writing/helper/**, packages/core/src/latex/build/node/runCancellable.ts, packages/terminal/installers/**, packages/browser/src/helper/**
source: Explore scout

## Contracts
- managed-tools.md:5-13: shared root per OS (mac ~/Library/Application Support/LabShelf, win %LOCALAPPDATA%\LabShelf, linux $XDG_DATA_HOME/labshelf); one subfolder per tool, only `tex/` today, own `.lock`. Text says "one managed TeX"; no Python.
- :28-30 installed = `bin/<arch>/` exists; build in `.staging-<kind>-*`, move in. Pins: version+SHA-256 in core (tinyTexPin.ts:6-30).
- :34-40 lock: `wx` create of JSON {pid,operation,startedAt}; stale if pid dead; poll 500 ms, 15 min; recheck state after lock; status reads unlocked.
- helper.md:11-12 transport: native host `dev.labshelf.helper` (hello, ready, session{port,token}); then WS on 127.0.0.1:<OS port>, first frame `auth` (32-byte token), Origin must match hello origin; one socket per token.
- :21-25 frame = 4-byte LE len + JSON envelope {v:5,id,type} + raw payload. PROTOCOL_VERSION=5 (helperMessages.ts:10) bumps on any message change; update helper.md.
- :49-63 messages: openProject, edit, save, compile, cancel(projectId), installTex, installAllPackages, publishTemplate...; replies ready{tex,host}, progress{phase,message,fraction?}, built, error. Codes: helper.md:99. 16 MiB/msg.
- native-host.md:5-9: desktop apps register the same host with own launcher; ready.host = helper|vscode|terminal.
- documents/ideas/computational-notes.md says terminal out of scope (task text includes it).

## Managed TeX (core/src/latex/toolchain/node/managedTex/)
- Reusable as-is: sharedToolsRoot.ts, toolLock.ts:94 `withToolLock(folder, op, logger, run)`, install/{stagingDir,singleTopDir,clearQuarantine}.ts, toolchain/downloadVerified.ts (SHA-256 before write).
- Template: install/installTinyTex.ts:44-68 (pin, download, stage, tar, swap, quarantine). Deps in install/installTypes.ts.
- Provider: managedTexProvider.ts (status/install under lock, managed>system), texLayout.ts, sharedTexProvider.ts:1-29 (factory, root=sharedToolsRoot/"tex").
- Python mirror = pin file, layout finder, installer, provider, shared factory. Skip tlmgr, texLive*.
- Callers: terminal/src/cli/build/buildEnvironment.ts, vscode/src/writing/build/node/sharedTex.ts, helper/node/runHelperHost.ts.

## Handlers
- dispatch/handlerTypes.ts: HelperHandler(message, send, payload); map keyed by message type. dispatcher.ts runs in arrival order; UNQUEUED = cancel, templateThumbnail.
- New `runCell`: add to helperMessages.ts + readToHelper.ts, bump version, factory spread into runHelperHost.ts:51-60 (model: tex/texInstallHandlers.ts), decide queue/UNQUEUED, client in browser/src/helper/client/createNativeLatexHelper.ts + core latexHelper.ts.
- Streaming: `send` may fire many times per id; ProgressPhase fixed list (helperMessages.ts:28), no cell phase.
- Cancel: only per-project build (build/buildHandlers.ts:97-122), keyed by projectId, not request id.

## Installer / browser
- Built in packages/terminal: build/{sea,build}.mjs, installers/{windows/labshelf-helper.iss, macos/build-pkg.sh, linux/build-linux.sh}. .iss has no [Components]/[Tasks]; installers only copy binary and run `--register`. No optional components; TeX installs via `installTex` message from the browser, not the installer.
- Browser: browser/src/helper/setup/{setupCard,setupView,setupNotInstalled,helperLinks}.ts. States (latexHelper.ts:13-16): not-installed | update-helper | update-extension | ready{tex}. Not-installed shows download link and polls. `ready` carries only `tex`; no capability list.
- No Python/SymPy code in packages.

## Running processes
- VS Code: registerNodeWriting.ts:17 OutputChannel "LabShelf Figures"; builds via vscode/src/writing/build/node/. Terminal spawn: terminal/src/platform/system.ts.
- Runner: latex/build/node/runCancellable.ts `runCancellable(exe,args,cwd,AbortSignal,{shell,onOutput,env})` -> {code, 64 KiB output tail}; detached group, SIGTERM -pid (win taskkill /T /F); rejects BuildCancelled. No timeout, no SIGKILL escalation, stdin ignored, stdout/stderr merged.
