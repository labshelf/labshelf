# Terminal

## Verification

Put environment variables for a run in a wrapper script, because zsh does not word-split `$VAR` commands.

- **Real pty.** A small Python `pty.fork()` harness (run Python with `-I`) sets the window size with `TIOCSWINSZ`, writes keys with delays and captures the bytes. Check the alternate screen in and out (`\x1b[?1049h` / `\x1b[?1049l`), the cursor restored (`\x1b[?25h`) and the image escapes.

## LabShelf Helper

Verify the helper against the unpacked extension in Chrome for Testing. A native messaging manifest's `path` must be an executable without arguments, so point it at a wrapper script; Chrome for Testing reads the manifest from `<user-data-dir>/NativeMessagingHosts/`.

## Website

The demos are ES modules, which browsers do not load from `file://`; serve the folder.
