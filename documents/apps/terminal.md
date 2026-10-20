# Terminal app (`labshelf`)

Read when you build, change or verify the terminal app.

A keyboard-driven explorer and a scriptable CLI over the local library. It works with or without VS Code. Its layout uses yazi's columns and keys with Zotero's pane model: folders | papers | preview ([product.md](../product.md)). Press `?` in the app for every binding; the help is generated from the keymap. The terminal app is distributed on npm as @labshelf/terminal (`npm install -g @labshelf/terminal`).

## Build and run

```bash
pnpm --filter @labshelf/terminal build      # → packages/terminal/dist/labshelf.mjs (+ thumbnailWorker.mjs)
ln -s "$PWD/packages/terminal/dist/labshelf.mjs" /opt/homebrew/bin/labshelf
labshelf doctor                             # checks library, config and the image protocol
```

- The app finds the library through `--library`, then `LABSHELF_LIBRARY`, then the shared config ([library-format.md](../contracts/library-format.md#shared-configuration)). `labshelf init <path>` writes the shared config. The default library folder is `~/LabShelf`.
- With no library configured, the first run shows a numbered prompt with the same choices as VS Code: `<sync folder>/LabShelf` for each detected sync folder, `~/LabShelf` (only on this computer) and another folder ([sync.md](../contracts/sync.md)).
- `labshelf move <path>` moves the library (a non-empty folder that is not a library gets `<path>/LabShelf`); there is no `mv` alias. `labshelf sync-help` prints the guide for syncing between computers. `labshelf conflicts` lists conflicting copies; on a TTY it asks `[m]ine / [o]ther / [b]oth / [s]kip` for each. The explorer's status line shows an "N conflicts" segment, and `:conflicts` opens the same list as an overlay.
- `labshelf bridge install|status|uninstall` connects the browser extension to the library by installing the Native Messaging host for every installed browser; it prints each manifest path and any browser it could not set up, and exits non-zero when none was set up ([contract](../contracts/bridge.md#host)).
- `labshelf helper install|status|uninstall` lets the browser extension build LaTeX with this app, through the same installer and the same exit codes as `bridge` ([contract](../contracts/native-host.md)). When LabShelf Helper is already registered, install leaves it in place and says so; `--replace` takes over. Every other `labshelf` run refreshes the launchers this app installed, so they keep working after a Node or package update.
- Thumbnails need kitty, Ghostty, iTerm2 or WezTerm. In the VS Code terminal, set `terminal.integrated.enableImages` and `LABSHELF_IMAGES=iterm`. Inside tmux, images are off unless forced.
- Thumbnails are faster with `brew install poppler` (pdftoppm). Without it, pdf.js renders them through `@napi-rs/canvas`.
- Imports read scans and broken-font PDFs with Tesseract (English). The first such import downloads the language data into the cache folder, so it needs the network once.
- PDFs open in the system viewer, or in `LABSHELF_PDF_VIEWER` or `terminal.pdfViewer` from the config. The viewer is a command; the PDF path is appended to it. A `{page}` token in the command is replaced by the page to open, for example `zathura -P {page}`, `okular -p {page}` or `evince -i {page}`.
- `labshelf open <id | cite key | link>` accepts a [`labshelf:` link](../contracts/links.md) (`labshelf:vaswani2017#p5`, `web+labshelf:` or percent-encoded). A viewer with `{page}` gets the link's page, else the paper's saved reading position, else 1. The system opener cannot take a page, so with it the command opens the PDF and prints `Opened <key> — go to page <n>` for a link that names a page. A link whose cite key matches no paper fails with a usage error naming the key.

## Writing projects

The project commands act on the writing project in the current folder or the folder given as the first argument. They exit 0 on success, 1 on findings or errors, and 2 when a toolchain is missing or a question cannot be asked.

- `labshelf install [project-dir]` (default: the current folder) reads the project's `labshelf.yaml` and imports, one at a time by DOI, each listed paper whose cite key the library lacks, under the listed key. It prints a line per paper (added, already in the library, in the library under another key, no DOI, failed, added without a PDF) and a summary, and exits 1 when a listed key still resolves to no paper. A missing or unreadable `labshelf.yaml` is a usage error (exit 2).
- `labshelf build [--watch]` builds the project and prints each error as `file:line: message`. When no LaTeX is installed, the first build asks whether to install Light (TinyTeX, adds packages on demand) or Full (TeX Live, offline) into the managed TeX folder shared with the other apps, and shows the install progress on stderr. Without a terminal it declines the question, so a CI run installs TeX Live and sets `engine:` in `labshelf.yaml`. `--watch` rebuilds on every source change until Ctrl-C.
- `labshelf cite [--format latex|typst|key]` opens a fuzzy paper picker on `/dev/tty`, prints the citation of the picked paper to stdout and adds its entry to `labshelf.bib`.
- `labshelf projects [--json]` lists the library's writing projects; `g w` opens the same list as the explorer's Writing pane.
- `labshelf check [--json]` runs the pre-submission checks on the built PDF and exits 1 when one fails, for example a de-anonymised submission.

A GitHub Actions workflow that builds and checks a LaTeX project on every push. The job builds the terminal app from source. The project commits `labshelf.bib` and sets `engine: pdflatex` in `labshelf.yaml`, because the job library starts empty and the job cannot answer questions:

```yaml
name: paper
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      LABSHELF_LIBRARY: ${{ runner.temp }}/library
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { repository: labshelf/labshelf, path: .labshelf }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: sudo apt-get install -y latexmk texlive-latex-recommended texlive-latex-extra
      - run: pnpm install --frozen-lockfile && pnpm --filter @labshelf/terminal build
        working-directory: .labshelf
      - run: |
          labshelf() { node .labshelf/packages/terminal/dist/labshelf.mjs "$@"; }
          labshelf init "$LABSHELF_LIBRARY"
          labshelf install
          labshelf build
          labshelf check
      - uses: actions/upload-artifact@v4
        with: { name: paper, path: "*.pdf" }
```

## LabShelf Helper

LabShelf Helper builds LaTeX projects for the browser extension over native messaging ([contract](../contracts/helper.md)). Its source is `src/helper/`; it shares nothing at run time with the `labshelf` command.

```bash
pnpm --filter @labshelf/terminal build              # → dist/labshelf-helper.mjs, run with Node
pnpm --filter @labshelf/terminal build:helper-sea   # → dist/sea/labshelf-helper-<os>-<arch>, a single executable that answers `hello`
```

- `labshelf-helper --register` registers the binary through the core native-host installer for every installed browser, and `--unregister` removes only the registrations that point at it ([contract](../contracts/native-host.md)). The installers run both. `dist/helperHost.mjs` is the host script that `labshelf helper install` registers; it answers as the terminal app.
- Its data and logs live in the per-user data folder ([contract](../contracts/helper.md#data-folder)). On macOS and Linux the folder follows `HOME` (and `XDG_DATA_HOME` on Linux), so a run with a scratch `HOME` stays isolated.

To verify against the unpacked extension, in Playwright's Chrome for Testing and never the user's browser:

1. Build the helper and the extension (`pnpm --filter @labshelf/browser build:chrome`).
2. Write a wrapper script, because the manifest `path` must be an executable without arguments:
   ```bash
   #!/bin/sh
   HOME=<scratch>/home exec node <repo>/packages/terminal/dist/labshelf-helper.mjs "$@"
   ```
3. Put a manifest for `dev.labshelf.helper` at `<user-data-dir>/NativeMessagingHosts/dev.labshelf.helper.json` with `path` the wrapper ([manifest format](../contracts/native-host.md#manifests)). The manifest's `key` gives the unpacked extension the allowed id.
4. Launch Chrome for Testing as in [browser.md → headless run](browser.md#headless-run), with `--user-data-dir=<user-data-dir>`, and open `options/index.html`. The helper's frames are in `<scratch>/home/Library/Application Support/LabShelf Helper/logs/`.

## Helper releases

The `helper-v<version>` tag triggers the Helper release workflow. Its version must match the helper version declared in core. The workflow builds and smoke-tests executables for macOS arm64/x64, Linux arm64/x64 and Windows x64, packages the installers and publishes them with checksums, provenance attestations and an Ed25519-signed update manifest. The executable smoke test reads the protocol version from core.

The repository secret `HELPER_UPDATE_KEY` signs updates. Windows signing uses `SIGNPATH_API_TOKEN` and the `SIGNPATH_*` repository variables when configured; without them the workflow publishes unsigned Windows assets. Publish a tag only after the code is committed and the affected packages pass their checks.

## Adding papers over the network

- `labshelf add` and the explorer's add accept a DOI, PMID, PMCID, arXiv id or a landing-page URL. The core network import resolves metadata, skips a paper the library already has (DOI, arXiv id, or title and year), and finds the PDF through the core chain. A landing page without a downloadable PDF is saved without one.
- No custom resolver is configured and the registries' contact email is the default, until a setting exists.

## Verification

Always rebuild first (`node build/build.mjs`). A stale bundle silently shows the old UI.

Isolate every run from your real setup. Put this in a wrapper script, because zsh does not word-split `$VAR` commands:

```bash
cp -R ~/LabShelf <scratch>/lib
XDG_CONFIG_HOME=<scratch>/config XDG_CACHE_HOME=<scratch>/cache LABSHELF_TOKEN_STORE=file \
  node packages/terminal/dist/labshelf.mjs -L <scratch>/lib "$@"
```

There are two ways to check the app:

- **Text frames.** `--dump-frame 120x30 --keys "hjl<tab><enter><C-d>"` renders one frame as plain text through the real app and input decoder. No TTY is needed. A space in `--keys` is a key press. Use this to check layout and key handling.
- **Real pty.** Use a small Python `pty.fork()` harness (run Python with `-I`) that sets the window size with `TIOCSWINSZ`, writes keys with delays and captures the bytes. Check:
  - alternate screen in and out: `\x1b[?1049h` / `\x1b[?1049l`;
  - cursor restored: `\x1b[?25h`;
  - with `LABSHELF_IMAGES=iterm`, the `\x1b]1337;File=` image escapes.

To check the interplay with VS Code:

1. Mark a status in the terminal and confirm that `metadata.yaml` changed only in `status`. With VS Code open on the same copy, its list updates within a second.
