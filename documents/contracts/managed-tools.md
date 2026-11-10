# Contract: managed tools

Read when you change where the managed TeX, Python or pix2tex lives, their lock, how a build finds TeX, or how Python or pix2tex is installed.

The helper, the VS Code extension and the terminal app ship separately but share one managed TeX, one managed Python, one managed pix2tex and one managed chrome-headless-shell per user, in `tex/`, `python/`, `pix2tex/` and `chrome/` under the shared tools folder. Two apps can install at once, so every app follows the lock and layout below.

## Layout

### TeX

`tex/` holds `tinytex/`, `texlive/` (scheme-full, installed with install-tl), `user/` (TEXMFHOME, TEXMFVAR and TEXMFCONFIG of the TeX Live install), `tinytex-packages.txt`, `.staging-<kind>-*/` and `.lock`. A tree counts as installed once it has a `bin/<arch>/` folder. Installers build in a staging folder and move the tree in only when it is complete. When both trees exist, `texlive/` is used. The release year comes from the tree's `release-texlive.txt`.

Downloads are verified: TinyTeX is pinned by SHA-256. install-tl is checked against CTAN's SHA-512 file, and that file against its OpenPGP signature by a pinned TeX Live key. A download that fails a check is not installed.

PLATFORM: on macOS the helper removes the quarantine attribute from the TinyTeX folder after install and on first use, so macOS does not block its binaries.

### Python

`python/` holds a python-build-standalone `install_only` tree (interpreter at `bin/python3`, or `python.exe` on Windows), SymPy and mpmath in its `site-packages`, `.pin.json`, `.staging-python-*/` and `.lock`. A Python counts as installed once the interpreter and `sympy-<version>.dist-info` exist. The system Python is never used.

The pin holds the python-build-standalone release, the CPython version and, per OS and architecture, an archive URL with its SHA-256, plus the SymPy and mpmath wheels by SHA-256. `.pin.json` records the pin the tree was installed from. Downloads are verified before anything is unpacked; the wheels are unzipped into `site-packages` by the helper itself, without pip. The installer builds in a staging folder and replaces the old tree only when the new one is complete, so a failure before the swap changes nothing.

PLATFORM: on macOS the install removes the quarantine attribute from `python/`.

### pix2tex

`pix2tex/` holds `venv/` (a venv of the managed Python, interpreter at `venv/bin/python3`, or `venv/Scripts/python.exe` on Windows), `weights/` with `weights.pth` and `image_resizer.pth`, `pix2tex-pin.json` (`{ version }`), `.staging-pix2tex-*/` and `.lock`. It counts as installed only when `pix2tex-pin.json` names the pinned version; a venv or weights without it are not an install. The system Python is never used or changed.

The pin (`equations/pix2texPin.ts`) holds pix2tex 0.1.4 with CPU-only PyTorch and, per OS and architecture, a requirements file in `equations/node/pix2tex-requirements/<platform>.txt` and the approximate total download: `darwin-arm64` (about 350 MB), `darwin-x64` (about 440 MB; torch 2.2.2, the last with Intel macOS wheels, with numpy below 2), `linux-x64` (about 510 MB), `linux-arm64` (about 445 MB) and `win32-x64` (about 400 MB). A platform with no entry, or a null one, has no install offer. Every line of a requirements file pins one package with `==` and its SHA-256 hashes, including every transitive dependency; Linux and Windows files name the PyTorch CPU index with PyPI as the extra index. The files are generated with `uv pip compile --only-binary :all: --generate-hashes` for the managed Python's minor version, as each file's header records. The weights are `weights.pth` and `image_resizer.pth` of LaTeX-OCR's GitHub release `v0.0.1`, each pinned by URL and SHA-256.

The install runs under `pix2tex/.lock`. It installs the managed Python first when that is missing, then, in a staging folder: `python -m venv` with the managed Python, `pip install --require-hashes --no-deps -r <platform file>` with binary wheels only and pip's user configuration ignored, and the download of each weight, verified against its SHA-256. Only then are `venv/` and `weights/` moved into place, replacing an older install, and `pix2tex-pin.json` written last. A failed step, a hash mismatch or a cancel rejects the install and leaves no venv, weights, marker or staging folder; the status stays missing.

Every build that ships the provider and runner copies `pix2tex_worker.py` and `pix2tex-requirements/` beside the compiled module (the VS Code build puts both in `out/`), because they are found through `__dirname`. The worker reads the weights from the folder in `LABSHELF_PIX2TEX_WEIGHTS`, which the runner sets for the managed install; for a Python from the setting `labshelf.equations.pix2texPython` or from the system it is unset and pix2tex uses its own weights. The runner picks the interpreter in that order: the setting, the managed install, then a system Python that imports `pix2tex`.

### Chrome

`chrome/` holds `<version>/` (the unpacked chrome-headless-shell zip of one Chrome for Testing Stable version), `chrome-pin.json` (`{ version, sha256 }`) and `.staging-chrome-*/`. It counts as installed once `chrome-pin.json` names the pinned version and the pinned executable exists inside `<version>/`. Deck PDF export uses it after a system Chromium; it is downloaded only when the user accepts the install.

The pin holds the version and, per OS and architecture (`darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`; Linux on ARM has no build), the zip URL, its SHA-256 and the executable path inside the zip. The install runs under the shared tools folder's `.lock`: it verifies the download before unpacking, unpacks into a staging folder, checks the executable, replaces `<version>/` and writes `chrome-pin.json` last, so a failure leaves no installed version.

PLATFORM: on macOS the install removes the quarantine attribute from `chrome/<version>/`.

## Lock

Only LabShelf apps change `tex/`, `python/`, `pix2tex/` and `chrome/`, and only while they hold that folder's `.lock` (`chrome/` uses the `.lock` of the shared tools folder). An app creates it exclusively with the JSON `{ pid, operation, startedAt }` and removes it when the change ends, whether it succeeded or failed.

- A lock is stale when its `pid` is not a running process, or when its content is not that JSON and the file is older than 15 minutes, the wait limit every app uses. An app takes over a stale lock and logs its content.
- Otherwise it waits, up to that limit, then fails with an error naming its operation and the holder.
- After taking the lock an app looks at the folder again, so what another app installed during the wait is not installed twice.

TeX, Python, pix2tex and Chrome installs, package installs and the rollover reinstall run under the lock. Reading the status and resolving latexmk do not.

## TeX resolution

A build uses the managed TeX first, then a TeX on the system, and reports TeX as missing when neither exists. A system TeX is never changed: no package installs, no updates. When a build stops on a missing file and the managed TeX is TinyTeX, the core build asks tlmgr for the providing package, installs it and builds again, up to a fixed number of rounds. A full TeX Live has every package.

## Python install

The helper binary installs the shared Python with `--install-python`, printing progress and exiting non-zero on failure. The browser can also ask for it with `installPython` ([helper.md](helper.md#messages)). The installers offer it as an unchecked choice, and a failure there never fails the helper install: the Windows setup task `installpython`, the macOS package choice "Python for calculations", and `install.sh --with-python` in the Linux tarball.

## Rollover

TRAP: once a year the package repository moves to the next TeX Live release and tlmgr refuses every repository action. TinyTeX is then reinstalled without asking, and its packages are installed again from `tinytex-packages.txt`. A full TeX Live stays unchanged until the user confirms its reinstall.
