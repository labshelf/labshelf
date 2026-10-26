# Contract: native hosts

Read when you change how a LabShelf program is registered with the browsers, where its launcher lives or which program a browser starts.

The browser extension starts two native messaging hosts: `app.labshelf.bridge` ([bridge.md](bridge.md)) and `dev.labshelf.helper` ([helper.md](helper.md)). Browsers find a host through a manifest at an OS-specific per-user path, and each host has one manifest per browser. Several programs can serve a host (the standalone LabShelf Helper, the VS Code extension, the terminal app), and they ship separately, so they must share these rules. The installer writes a manifest for each installed browser.

## Launcher

An app that runs the host as a script installs a launcher in the host folder and points the manifests at it. The launcher runs the app's bundled host script with the app's Node binary. TRAP: VS Code has no Node of its own, so its launcher runs VS Code's Electron binary with `ELECTRON_RUN_AS_NODE=1`.

The standalone helper has no launcher: one binary serves both hosts. TRAP: native messaging passes no host name to the program it starts. So each host gets its own program name: the installer puts `labshelf-bridge` next to `labshelf-helper` (a symlink on macOS and Linux, a `.cmd` shim on Windows that runs `labshelf-helper.exe --host=bridge`), each manifest points at its own name, and the binary serves the host named by `argv[0]`. It uses `argv[0]` because the executable path resolves the symlink. `--register` creates the name and `--unregister` removes it.

PLATFORM: a Flatpak or Snap browser on Linux cannot start a program outside its sandbox, so it gets a warning instead of a manifest.

## Host record and refresh

`host.json` in the host folder describes the launcher next to it and is written and removed together with it. A file that is not such a record is ignored. VS Code on activation and the terminal app on every run compare it with their own Node binary and host script, and rewrite the launcher when they differ. Only the app named by `owner` refreshes. Refresh never installs a host and never touches a manifest.

## Precedence

- The standalone helper's `--register` always writes the manifests of both hosts, replacing any other. `--unregister` removes both.
- An app's install leaves the manifests alone when one points at an existing standalone helper. The app reports it and writes nothing, unless the user chooses that app instead.
- Between VS Code and the terminal app the last install wins: each rewrites the launcher and `host.json` it shares with the other.
- An uninstall removes only the manifests and Windows keys that point at its own launcher or binary. An app's uninstall also removes its launcher and `host.json`.
