# Contract: native hosts

Read when you change how a LabShelf program is registered with the browsers, where its launcher lives or which program a browser starts. The installer module in core (`nativeHost`) implements this document for every app.

## Hosts

| Host name | Purpose | Protocol |
|---|---|---|
| `app.labshelf.bridge` | gives the browser extension the library folder | [bridge.md](bridge.md) |
| `dev.labshelf.helper` | builds LaTeX for the browser extension | [helper.md](helper.md) |

Each host is a Native Messaging host: a manifest in a browser's per-user folder names the program the browser starts.

## Folders

Each host keeps its launcher, `host.json` and, on Windows, its manifests in one folder:

| OS | Folder |
|---|---|
| macOS, Linux | `~/.config/labshelf/<dir>/` |
| Windows | `%LOCALAPPDATA%\LabShelf\<dir>\` (`<home>\AppData\Local` when the variable is unset) |

`<dir>` is `bridge` or `helper`. On macOS and Linux the host folder is `0o700`, `host.json` and the manifests are `0o600` and the launcher is `0o755`; an install fixes the modes of the paths it writes.

## Launcher

An app that runs the host as a script installs a launcher in the host folder (`labshelf-<dir>` on macOS and Linux, `labshelf-<dir>.cmd` on Windows) and points the manifests at it. The launcher runs the app's bundled host script with the app's Node binary and forwards its arguments. VS Code has no Node of its own, so its launcher runs VS Code's Electron binary with `ELECTRON_RUN_AS_NODE=1`.

The standalone LabShelf Helper has no launcher: it serves both hosts from one binary. Native messaging passes no host name to the program it starts (Chrome passes the caller origin, Firefox the manifest path and extension id), so each host gets its own program name: the installer puts `labshelf-bridge` next to `labshelf-helper` (a symlink on macOS and Linux, a `labshelf-bridge.cmd` shim on Windows), each manifest points at its own name, and the binary serves the host named by the basename it was started as (`argv[0]`, because the executable path resolves the symlink); the Windows shim runs `labshelf-helper.exe --host=bridge`, which the binary also accepts as its first argument on every platform. `--register` creates this name and `--unregister` removes it.

## Manifests

The manifest is named `<host name>.json`. A manifest lists the extension ids allowed to start the host: the extension's fixed Chrome id as `allowed_origins`, or its Firefox id as `allowed_extensions`.

| Browser | macOS (under `~/Library/Application Support`) | Linux |
|---|---|---|
| Chrome | `Google/Chrome/NativeMessagingHosts` | `$XDG_CONFIG_HOME/google-chrome/NativeMessagingHosts` |
| Chromium | `Chromium/NativeMessagingHosts` | `$XDG_CONFIG_HOME/chromium/NativeMessagingHosts` |
| Edge | `Microsoft Edge/NativeMessagingHosts` | `$XDG_CONFIG_HOME/microsoft-edge/NativeMessagingHosts` |
| Brave | `BraveSoftware/Brave-Browser/NativeMessagingHosts` | `$XDG_CONFIG_HOME/BraveSoftware/Brave-Browser/NativeMessagingHosts` |
| Vivaldi | `Vivaldi/NativeMessagingHosts` | `$XDG_CONFIG_HOME/vivaldi/NativeMessagingHosts` |
| Firefox | `Mozilla/NativeMessagingHosts` | `~/.mozilla/native-messaging-hosts` |

`XDG_CONFIG_HOME` defaults to `~/.config`. On Windows each manifest is `<browser>.json` in the host folder, and the key `HKCU\Software\<vendor>\NativeMessagingHosts\<host name>` has the manifest path as its default value (vendor `Google\Chrome`, `Chromium`, `Microsoft\Edge`, `BraveSoftware\Brave-Browser`, `Vivaldi`, `Mozilla`).

An install writes a manifest for each browser the user has installed, found by the browser's data folder or, on Windows, its `HKCU` key. A Flatpak or Snap browser on Linux cannot start a program outside its sandbox, so it gets a warning instead of a manifest.

## Host record

`host.json` in the host folder describes the launcher next to it: `owner` (`vscode` or `terminal`), `nodePath`, `hostScript` and `electronRunAsNode`. It is written and removed together with the launcher. A file that is not such a record is ignored.

## Precedence

Several programs can serve each host, and a browser has one manifest per host.

- The standalone helper's `--register` always writes the manifests of both hosts, replacing any other; `--unregister` removes both.
- An app's install leaves the manifests alone when one points at an existing standalone helper. The app reports it and writes nothing, unless the user chooses to use that app instead.
- Between VS Code and the terminal app the last install wins: each rewrites the launcher and `host.json` it shares with the other.

## Refresh

VS Code on activation and the terminal app on every run compare the paths in `host.json` with their own Node binary and host script, and rewrite the launcher when they differ. Only the app named by `owner` refreshes. Refresh never installs a host, and never touches a manifest.

## Uninstall

An uninstall removes only the manifests (and Windows keys) that point at its own launcher or binary. A manifest that points elsewhere stays. An app's uninstall also removes its launcher and `host.json`.
