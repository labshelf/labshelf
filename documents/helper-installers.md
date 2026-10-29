# LabShelf Helper installers

Read when you change how LabShelf Helper is packaged or installed. Moved here from the design system on 2026-10-29: the installers use each platform's own look, so only their words are product decisions.

- **Windows** (Inno Setup, per user, no directory or program-group pages): "LabShelf Helper", publisher LabShelf, installs `labshelf-helper.exe` under the user's data folder and registers it.
- **macOS** (pkg, current user's home only): title "LabShelf Helper"; the conclusion page reads "LabShelf Helper is installed and registered with your browsers." and gives the uninstall command.
- **Linux** (tarball and .deb): a README with Install for your user, `--register`, `--unregister` and `--uninstall`.

How the product offers the Helper (its name, why it is needed, the alternatives) is in the design system README, under Words.
