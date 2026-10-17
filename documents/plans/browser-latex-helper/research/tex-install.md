sha: 1906cb00
files: none
source: [1] https://github.com/rstudio/tinytex-releases ; [2] https://tinytex.yihui.org/install-bin-unix.sh ; [3] https://tinytex.yihui.org/install-bin-windows.ps1 ; [4] https://api.github.com/repos/rstudio/tinytex-releases/releases/tags/daily ; [5] https://yihui.org/tinytex/ ; [6] https://yihui.org/tinytex/faq/ ; [7] https://raw.githubusercontent.com/rstudio/tinytex/main/tools/pkgs-custom.txt ; [8] https://tug.org/texlive/doc/install-tl.html ; [9] https://tug.org/texlive/acquire-netinstall.html ; [10] https://tug.org/texlive/quickinstall.html ; [11] https://tug.org/texlive/doc/texlive-en/texlive-en.html ; [12] https://tug.org/texlive/upgrade.html ; [13] https://tug.org/texlive/windows.html ; [14] local /usr/local/texlive/2026/texmf-dist/scripts/texlive/tlmgr.pl (TL 2026 source) ; [15] local /usr/local/texlive/2026/tlpkg/texlive.profile ; [16] https://api.github.com/repos/rstudio/tinytex-releases/releases/latest

## TinyTeX
- Assets at `https://github.com/rstudio/tinytex-releases/releases/download/daily/<file>`: `TinyTeX-{0,1,2}` or bare `TinyTeX` + `-darwin.tar.xz`, `-linux-x86_64.tar.xz`, `-linux-arm64.tar.xz`, `-windows.exe`. One macOS asset serves both CPUs (`bin/universal-darwin`). Pinned: `download/v2026.10/<name>-v2026.10.<ext>`. [1][2][16]
- Bundles: 0 = infraonly; 1 = ~100 packages, the installer default; bare = more packages; 2 = `scheme-full`, daily only. [1]
- Download MB (-0/-1/bare/-2): Win 24/74/173/1.7G; mac 2/67/211/1.9G; linux-x64 1/54/152/1.8G; arm64 1/54/158/1.8G. Installed size: unverified. [1][4]
- Checksums: no checksum file; the GitHub API gives `digest: sha256:...` per asset. [4]
- Dirs: macOS `~/Library/TinyTeX`; Linux `~/.TinyTeX`; Windows `%APPDATA%\TinyTeX` (`%ProgramData%` if APPDATA has spaces or non-ASCII). `TINYTEX_DIR` sets the parent. [2][3][5]
- Unattended: `curl -sL https://tinytex.yihui.org/install-bin-unix.sh | sh` (needs perl, xz on Linux); Windows `install-bin-windows.bat` (PowerShell). Env `TINYTEX_INSTALLER`, `TINYTEX_VERSION`, `TINYTEX_DIR`; `--no-path` skips PATH (otherwise macOS may `sudo` to write `/etc/paths.d/TinyTeX`). [2][3]
- Packages: `tlmgr install <pkg>`; owner lookup `tlmgr search --global --file "/times.sty"`. Full set: `TINYTEX_INSTALLER=TinyTeX-2`, about 2 GB. [5][6]
- `latexmk` is in `pkgs-custom.txt` (TinyTeX-1), so all bundles except -0 include it. [7]
- Cross-year: re-running the installer drops installed packages; the script prints `tlmgr install <old list>`. R: `tinytex::reinstall_tinytex()`. Manual: save `tlmgr info --list --only-installed --data name`. [2][5][6]
- `update-tlmgr-latest` with TinyTeX: unverified.

## Full TeX Live 2026 (released 2026-03-01)
- Installers: `install-tl-unx.tar.gz` (~5 MB), `install-tl-windows.exe` (~20 MB) or `install-tl.zip`. [9]
- Run `perl ./install-tl --no-interaction --profile <file>`; a profile ignores env vars; Windows adds `-non-admin`. [8]
- Profile keys: `selected_scheme scheme-full`; define all of `TEXDIR TEXMFLOCAL TEXMFSYSCONFIG TEXMFSYSVAR TEXMFCONFIG TEXMFVAR TEXMFHOME`; `instopt_adjustpath` (0 Unix, 1 Windows); `tlpdbopt_install_docfiles`, `tlpdbopt_install_srcfiles`, `tlpdbopt_desktop_integration`, `tlpdbopt_file_assocs`, `tlpdbopt_w32_multi_user`. [8]
- MacTeX 2026 profile: `TEXDIR /usr/local/texlive/2026`, `TEXMFHOME ~/Library/texmf`, `binary_universal-darwin 1`. [15]
- Defaults: `/usr/local/texlive/YYYY`; Windows `C:\texlive\2026`, no admin needed; `TEXMFHOME` `~/texmf` (macOS `~/Library/texmf`). [8][11]
- Size: scheme-full "7+GB" [10]; installer showed 9402 MB with docs [11]. Download size, per-user Windows TEXDIR: unverified.

## Rollover error
- tlmgr source: `Local TeX Live (2025) is older than remote repository (2026).` / `Cross release updates are only supported with` / `  update-tlmgr-latest(.sh/.exe) -- --upgrade` / `See https://tug.org/texlive/upgrade.html for details.` The `tlmgr:` prefix: unverified. [14]
- Upgrade: copy `<root>/2025` to `2026`, fix PATH, `sh update-tlmgr-latest.sh -- --upgrade`, `tlmgr update --self --all`; TUG advises a fresh install. [12]

## `tlmgr search --global --file` (TL 2026)
```
$ tlmgr search --global --file "/times.sty"
tlmgr: package repository https://br.mirrors.cicku.me/ctan/systems/texlive/tlnet (verified)
psnfss:
	texmf-dist/tex/latex/psnfss/times.sty
```
Repository line, then `<package>:` and tab-indented paths. Without a leading `/` it matches substrings. [local run]

## Probe dirs
- MacTeX `/Library/TeX/texbin` (to `/usr/local/texlive/2026/bin/universal-darwin`, verified locally).
- Unix `/usr/local/texlive/<year>/bin/<arch>`; Windows `C:\texlive\<year>\bin\windows`. [8][13]
- TinyTeX `~/Library/TinyTeX/bin/universal-darwin`, `~/.TinyTeX/bin/<arch>-linux`, `%APPDATA%\TinyTeX\bin\windows`. [2][3]
- Distro `/usr/bin`; MiKTeX `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`, `C:\Program Files\MiKTeX\miktex\bin\x64`: unverified.
