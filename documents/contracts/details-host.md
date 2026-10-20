# Contract: the Details surface and its hosts

Read when you change the Details surface, the selection it follows, or the code that hosts it.

The Details surface shows what the user selected in the paper list or in All projects. It speaks both existing protocols, the library UI's ([library-ui-host.md](library-ui-host.md)) and All projects', over one channel. The message unions in core's `details` module are the single source of truth for shapes. A host that runs Details in another context (a webview) passes every message through `parseDetailsMessage` and drops what fails it.

## Envelope

Every message except `details.show` wraps one message of an existing protocol:

| Field | Value |
|---|---|
| `channel` | `library` for the library UI protocol, `projects` for the All projects protocol |
| `msg` | a message of that protocol, checked by that protocol's own guard |

A message is valid only on its own channel. The host answers a wrapped message the way that protocol's host answers it, and wraps the answer on the same channel. Two exceptions:

- `folder.open` on the library channel is not answered as a library message. The host exposes it as an event and shows that folder in the paper list: the VS Code view fires `onDidRequestFolder` and the extension navigates the list; the browser page intercepts it before the library endpoint, posts `navigate` to the list and focuses the Library tab.
- `project.selected` is not sent by Details; only the All projects page reports a selection.

## `details.show`

Host to Details: `{type: "details.show", target}`, where `target` is one of:

- `{kind: "paper", ids}`: the selected papers;
- `{kind: "project", id}`: the selected project;
- `null`: nothing is selected.

Details shows the target and asks for its data on the matching channel (`paper.details`, `detail`).

## Tabs

The surface keeps its tabs itself; hosts send only `details.show`.

- One preview tab, its label in italics, shows the latest target. `null` empties it.
- The user pins the preview with its pin button or a double-click. Only one paper or one project can be pinned, never several papers. The pinned tab stays when the next target opens a new preview.
- A target that already has a pinned tab activates that tab and leaves the preview as it is.
- Closing the active pinned tab activates the next pinned tab, else the previous one, else the preview.
- Pinned items persist through the `PrefsPort` as `detailsPins`; the active tab does not. A pinned paper missing from a library snapshot, or a pinned project missing from a `projects` message, drops out.

## Startup

1. Details mounts and posts `ready` on both channels.
2. The host answers each `ready` the way it answers that protocol's `ready`.
3. The host then sends `details.show` with the selection hub's `current()`, so a Details surface mounted late shows the selection made before it existed.

## Last selection wins

The host feeds every selection into one selection hub (`createSelectionHub`). The paper list's `paper.selected` and All projects' `project.selected` each publish a target under the source the app names. Details shows the last target published. When the user returns to a source, the host activates that source, and Details shows the target that source last published. Activating a source that has published nothing leaves Details as it is.
