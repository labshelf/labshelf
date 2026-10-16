Fixture of a real two-page build: `main.tex` with `\input{chapter}` and `\input{chapters/extra.tex}`.

`main.synctex` is the decompressed output of `latexmk -pdf -synctex=1 -outdir=<out> main.tex` (pdfTeX, TeX Live 2026) run in
the project folder, with the build folders rewritten to `/work/project` and `/work/out`. The expectations in the tests come from
`synctex view -i <line>:1:<file> -o main.pdf` and `synctex edit -o <page>:<x>:<y>:main.pdf` (SyncTeX command line utility 1.5).
