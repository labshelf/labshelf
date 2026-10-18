# Session 7 — Firefox run and the macOS screenshots

- **Goal:** A12 observed in Firefox; A10 screenshots in the manual. Then `finish` is already done; delete the plan directory.
- **Starts from:** session 6 committed (helper docs, website tutorial and policy page, tlmgr self-update and forced rebuild fixes).
- **Owns:** `website/index.html` (Figure 10 placeholder only), `website/media/helper/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 7.1 | Firefox real run (A12) | — | main thread, with the user's OK | steps below observed | [ ] |
| 7.2 | macOS screenshots (A10) | task | user on a Mac, main thread swaps the placeholder | figure shows the real dialog | [ ] |
| 7.3 | Delete the plan directory | — | main thread | directory gone | [ ] |

## 7.1 — Firefox

Firefox reads host manifests only from `~/Library/Application Support/Mozilla/NativeMessagingHosts/` (no per-profile folder), so this run writes a dev manifest into the user's real folder; ask the user first and remove it after. Use Firefox Developer Edition with a fresh `-profile <scratch>` and `-no-remote`, only when no Developer Edition window is open. Manifest: `name` `dev.labshelf.helper`, `type` `stdio`, `path` a wrapper `HOME=<scratch>/home exec node <repo>/packages/terminal/dist/labshelf-helper.mjs "$@"`, `allowed_extensions` `["labshelf@lucanaasser.dev"]`. Load `packages/browser/dist/firefox` as a temporary add-on, open the options page: "not installed" before the manifest exists, then the card changes without a reload (A1), then a build that installs a missing package succeeds (A2). This Mac has MacTeX in `/Library/TeX/texbin`, which the helper always probes, so the card shows "Ready: System TeX" unless a managed TeX was installed with `installTex`.

## 7.2 — Screenshots

The placeholder is `div.shot[data-screenshot="media/helper/macos-open-anyway.png"]` in `website/index.html` (manual 5.10). Replace it with an `<img>` of the user's screenshot; add a second figure for the blocked dialog only if the user sends one.
