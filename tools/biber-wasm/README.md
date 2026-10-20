<!-- Builds biber, the biblatex backend, as a WebAssembly module from pinned upstream sources; how to build, use, verify and bump it. -->
# biber for WebAssembly

Builds [biber](https://github.com/plk/biber) as a WebAssembly module so the LabShelf Helper can run it the way it runs Typst, without launching a native executable that macOS Gatekeeper blocks.

The module is a static perl for `wasm32-emscripten` with biber's XS dependencies linked in. biber's perl tree is preloaded at `/opt/perl-wasm`.

## Build

```bash
tools/biber-wasm/build.sh
```

You need Docker. The build takes about 4 minutes from scratch on 14 cores. It writes these files to `tools/biber-wasm/dist/` (git-ignored):

| File | What |
|---|---|
| `biber.js` | emscripten `MODULARIZE` factory (CommonJS, export name `biber`) |
| `biber.wasm` | perl with every XS module, about 6.6 MB |
| `biber.data` | preloaded perl tree mounted at `/opt/perl-wasm`, about 25 MB |
| `manifest.json` | `{ biber, bcfVersion, files: { name: sha256 } }` |
| `LICENSES.txt` | version and license of every bundled component |

Intermediate builds live in the Docker volume `labshelf-biber-wasm-cache`. Each step skips itself when its output is already there, so delete the volume (`docker volume rm labshelf-biber-wasm-cache`) after you change anything below `scripts/`. Every download is checked against `sources.lock`.

## Pinned versions

The pins live in `versions.sh` (emsdk 6.0.13 is pinned in the `Dockerfile`) and `cpan-dists.txt`:

- perl 5.42.0 (the perl that TeX Live 2026's biber binary bundles), with 64-bit integers
- biber 2.22, which accepts `.bcf` control files of version 3.11
- libxml2 2.9.14
- the 94 CPAN distributions of biber's closure, each with an exact version. `cpan-dists.txt` gives each one a kind: `pp` and `xs` are shipped, `build` is used only during the build, `overlay` is replaced by a file in `overlay/`, and `skip` is left out.

## Using the module

```js
const biber = require("./biber.js");
const Module = await biber({
  noInitialRun: true,
  locateFile: (name) => path.join(distDir, name),
  print, printErr,
  preRun: [(m) => { m.ENV.SOME_VAR = "value"; }],
});
Module.FS.mkdirTree("/home/web_user/biber");
Module.FS.chdir("/home/web_user/biber");
Module.FS.writeFile("main.bcf", bcfBytes);
Module.FS.writeFile("refs.bib", bibBytes);
let exit;
try { exit = Module.callMain(["/opt/perl-wasm/bin/biber", "--nolog", "main.bcf"]); }
catch (e) { exit = e.status; } // perl's exit status is returned; an abort throws an ExitStatus with .status
const bbl = Module.FS.readFile("main.bbl");
```

- Use one module instance per run. The runtime exits when perl returns (`EXIT_RUNTIME`), which flushes output but also makes the instance unusable afterwards.
- Set environment variables in `preRun`. The C environment is read once at startup, so later writes to `Module.ENV` are not seen.
- `FS`, `ENV` and `callMain` are exported.
- In Node, a non-zero exit also sets `process.exitCode`, because emscripten's exit handler does that. A long-running host must save and restore `process.exitCode` around `callMain`.

## Differences from native biber

- Data::Uniqid is replaced by `overlay/Data/Uniqid.pm`, which uses a counter. The CPAN version builds ids from the clock and the pid, and in emscripten the clock has millisecond resolution and the pid is always 42, so ids collide and names overwrite each other.
- These are left out: remote data sources (`http(s)://` `.bib` files, which need LWP and OpenSSL), `--convert-control` (XML::LibXSLT), the legacy CJK encodings (Encode::CN/JP/KR/TW and Encode::HanExtra/JIS2K/EUCJPASCII), the per-region time zone files of DateTime::TimeZone, and every DateTime locale except `en` and `en-US`. biber only builds dates in UTC, floating or fixed-offset zones with the default locale.
- XS modules are compiled through their own `Makefile.PL`, so the defines it sets reach the wasm build (for example `-DHAVE_UTF8` for XML::LibXML). Text::BibTeX and Params::Validate use Module::Build, so `scripts/steps/xs-modules.sh` compiles them by hand with the same flags. The defines used are written to `build/xs/defines.txt` in the cache volume.

## Verifying

```bash
node tools/biber-wasm/test/perl-checks.cjs tools/biber-wasm/dist   # XML::LibXML returns decoded text; 5000 ids are unique
tools/biber-wasm/test/compare.sh tools/biber-wasm/dist [dir-with-main.bcf ...]
```

`compare.sh` generates a 204-entry `.bib` with `test/make-fixtures.cjs`. The file has accented names written as LaTeX macros and as raw UTF-8, `crossref`, `xdata`, names that need `uniquename` and `uniquelist`, and labels with the same author and year. It compiles two documents with TeX Live's `pdflatex`: one with authoryear, `uniquename=full`, `uniquelist=true` and `sorting=nyt`, and one with `ngerman` and `sortlocale=de_DE`. Then it runs native biber once and the wasm biber three times on each document. Every `.bbl` must be byte-identical to the native one and the same on every run. Native biber must come from TeX Live (`TEXBIN`, default `/usr/local/texlive/2026/bin/universal-darwin`).

## Bumping biber (yearly, with TeX Live)

1. Set `BIBER_VERSION` in `versions.sh`. If TeX Live's biber binary bundles a newer perl, set `PERL_VERSION` to match.
2. Print the new dependency closure:
   `docker run --rm -v labshelf-biber-wasm-cache:/cache -v "$PWD/tools/biber-wasm":/work labshelf-biber-wasm bash scripts/resolve-deps.sh > /tmp/dists.txt`
   Known distributions keep their kind. Classify the ones marked `new`: `xs` if they install a `.so`, otherwise `pp`, or `build`/`skip` if biber never loads them at run time. Replace the body of `cpan-dists.txt` with the result.
3. Remove the lines of replaced files from `sources.lock`, delete the cache volume and run `build.sh`. New downloads are added to the lock, so review the diff.
4. Run both checks above with the new TeX Live's biber and `pdflatex`. `manifest.json` takes `bcfVersion` from `$BCF_VERSION` in `Biber/Constants.pm`.
