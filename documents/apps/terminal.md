# Terminal app (`labshelf`)

Read when you build, change or verify the terminal app.

A keyboard-driven explorer and a scriptable CLI over the local library. It works with or without VS Code, and it syncs with Drive on its own. Its layout uses yazi's columns and keys with Zotero's pane model: folders | papers | preview ([product.md](../product.md)). Press `?` in the app for every binding; the help is generated from the keymap.

## Build and run

```bash
pnpm --filter @labshelf/terminal build      # → packages/terminal/dist/labshelf.mjs (+ thumbnailWorker.mjs)
ln -s "$PWD/packages/terminal/dist/labshelf.mjs" /opt/homebrew/bin/labshelf
labshelf doctor                             # checks library, config, Drive and the image protocol
```

- The app finds the library through `--library`, then `LABSHELF_LIBRARY`, then the shared config ([library-format.md](../contracts/library-format.md#shared-configuration)). `labshelf init <path>` writes the shared config.
- Drive: `labshelf auth login`, or `:login` in the explorer.
- Thumbnails need kitty, Ghostty, iTerm2 or WezTerm. In the VS Code terminal, set `terminal.integrated.enableImages` and `LABSHELF_IMAGES=iterm`. Inside tmux, images are off unless forced.
- Thumbnails are faster with `brew install poppler` (pdftoppm). Without it, pdf.js renders them through `@napi-rs/canvas`.
- Imports read scans and broken-font PDFs with Tesseract (English). The first such import downloads the language data into the cache folder, so it needs the network once.
- PDFs open in the system viewer, or in `LABSHELF_PDF_VIEWER` or `terminal.pdfViewer` from the config. The viewer is a command; the PDF path is appended to it. A `{page}` token in the command is replaced by the page to open, for example `zathura -P {page}`, `okular -p {page}` or `evince -i {page}`.
- `labshelf open <id | cite key | link>` accepts a [`labshelf:` link](../contracts/links.md) (`labshelf:vaswani2017#p5`, `web+labshelf:` or percent-encoded). A viewer with `{page}` gets the link's page, else the paper's saved reading position, else 1. The system opener cannot take a page, so with it the command opens the PDF and prints `Opened <key> — go to page <n>` for a link that names a page. A link whose cite key matches no paper fails with a usage error naming the key.

## Adding papers over the network

- `labshelf add` and the explorer's add accept a DOI, PMID, PMCID, arXiv id or a landing-page URL. The core network import resolves metadata, skips a paper the library already has (DOI, arXiv id, or title and year), and finds the PDF through the core chain. A landing page without a downloadable PDF is saved without one.
- `labshelf install [project-dir]` (default: the current folder) reads the project's `labshelf.yaml` and imports, one at a time by DOI, each listed paper whose cite key the library lacks, under the listed key. It prints a line per paper (added, already in the library, in the library under another key, no DOI, failed, added without a PDF) and a summary, and exits 1 when a listed key still resolves to no paper. A missing or unreadable `labshelf.yaml` is a usage error (exit 2).
- No custom resolver is configured and the registries' contact email is the default, until a setting exists.

## Verification

Always rebuild first (`node build/build.mjs`). A stale bundle silently shows the old UI.

Isolate every run from your real setup. Put this in a wrapper script, because zsh does not word-split `$VAR` commands:

```bash
cp -R ~/Documents/LabShelfLibrary <scratch>/lib
XDG_CONFIG_HOME=<scratch>/config XDG_CACHE_HOME=<scratch>/cache LABSHELF_TOKEN_STORE=file \
  node packages/terminal/dist/labshelf.mjs -L <scratch>/lib "$@"
```

There are two ways to check the app:

- **Text frames.** `--dump-frame 120x30 --keys "h j l <tab> <enter> <C-d>"` renders one frame as plain text through the real app and input decoder. No TTY is needed. Use this to check layout and key handling.
- **Real pty.** Use a small Python `pty.fork()` harness (run Python with `-I`) that sets the window size with `TIOCSWINSZ`, writes keys with delays and captures the bytes. Check:
  - alternate screen in and out: `\x1b[?1049h` / `\x1b[?1049l`;
  - cursor restored: `\x1b[?25h`;
  - with `LABSHELF_IMAGES=iterm`, the `\x1b]1337;File=` image escapes.

To check the interplay with VS Code:

1. Mark a status in the terminal and confirm that `metadata.yaml` changed only in `status`. With VS Code open on the same copy, its list updates within a second.
2. Start a long sync with `S`, then run Sync Now in VS Code. VS Code must report that the terminal is syncing and do nothing else.
