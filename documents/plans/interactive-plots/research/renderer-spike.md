# Renderer spike: plotly.js strict under each host CSP

Spec 1.1 of plan interactive-plots. Harness: `node documents/plans/interactive-plots/research/spike/run.mjs`
(Playwright's bundled Chromium, new headless mode with SwiftShader WebGL; a local HTTP server sends each host's CSP
verbatim as a response header, with a fresh nonce and the server origin standing in for the webview `cspSource`).
Each page loads `mark.js` (clock, `securitypolicyviolation` listener), then the bundle, then `draw.js`, all by
nonce'd `<script src>`. `draw.js` draws a 2D `scatter` (lines+markers) and a 3D `surface` (WebGL, with colorbar).
Raw per-host data: `spike/results.json`.

A plot passes when:

- 2D: the main SVG has non-zero size, the line path is drawn, Plotly's injected rules apply (`.main-svg` and
  `.modebar` compute to `position: absolute`), and moving the mouse to a data point shows a hover label.
- 3D: the canvas has non-zero size, Plotly shows no WebGL error, and a screenshot of the plot has more than 20
  distinct colours in its centre.

## Bundle

`plotly.js-strict-dist-min` 4.2.0 (`plotly-strict.min.js`, UMD): **4.94 MB raw, 1.51 MB gzip**.

## Results

Times are ms from the first script to: bundle evaluated (`load`), first 2D plot drawn, 3D plot drawn. They come from
headless Chromium on the dev Mac. The first 3D draw of the run (htmlShell row) costs about 2.4 s for a cold SwiftShader
shader compile; later rows take about 0.7 s.

| host (CSP source) | 2D | 3D | hover | styled | load | first 2D | 3D | violations reported |
|---|---|---|---|---|---|---|---|---|
| htmlShell (`packages/vscode/src/ui/htmlShell.ts:18`) | **fail** | pass | no | no | 343 | 366 | 2417 | 4: `style-src-elem` x2 (Plotly global `<style>`; maplibre `<style>`), `style-src-attr` x2 (colorbar `style=""`) |
| htmlShell + dataImages (`htmlShell.ts:17-18`) | **fail** | pass | no | no | 344 | 365 | 728 | same 4 |
| Spaces webview (`packages/vscode/src/spaces/view.ts:176`, `:309`) | **fail** | pass | no | no | 344 | 366 | 695 | same 4 |
| reader panel (`packages/vscode/src/reader/shell.ts:60`) | pass | pass | yes | yes | 339 | 360 | 695 | none |
| browser extension pages (`packages/browser/manifest.chrome.json:73`, firefox `:89`) | pass | pass | yes | yes | 337 | 359 | 711 | none |
| htmlShell + core fix | pass | pass | yes | yes | 338 | 359 | 666 | 2: `style-src-attr` (colorbar `style=""`) |
| htmlShell + dataImages + core fix | pass | pass | yes | yes | 338 | 359 | 713 | 2: `style-src-attr` (colorbar `style=""`) |
| Spaces + core fix | pass | pass | yes | yes | 337 | 358 | 715 | 2: `style-src-attr` (colorbar `style=""`) |
| htmlShell + core fix, surface without colorbar | pass | pass | yes | yes | 339 | 361 | 663 | none |
| htmlShell + core fix + empty-style hash in CSP | pass | pass | yes | yes | 338 | 359 | 687 | none |

The three violation sites in the minified bundle:

1. `plotly.js:21:85979`, `lib.addStyleRule` / `addRelatedStyleRule`: when no element `#plotly.js-style-global`
   exists, it creates an empty `<style>`, appends it, and calls `sheet.insertRule`. Under `style-src 'nonce-…'` the
   un-nonced element is blocked and gets no sheet, so Plotly warns "Cannot addRelatedStyleRule, probably due to strict
   CSP" and adds none of its CSS. Result: the three stacked `main-svg` layers and the modebar are `position: static`,
   the hover layer sits under the plot, and **the 2D plot draws but looks broken and has no hover**. The 3D surface
   still draws, because WebGL needs no CSS, but its layout CSS is missing as well.
2. `plotly.js:21:182752`: the bundled maplibre CSS injects a `<style id="9f215cf0…">` at import time. It is harmless
   because LabShelf uses no map traces, but the violation is still reported.
3. `plotly.js:15:16458`: d3 `selection.attr("style", "")` on the colorbar fill rects (`rect.cbfill`, enter and
   update, so 2 reports). Setting an empty attribute changes nothing, and the colorbar fills come through CSSOM
   (`.style()`), so the colorbar draws correctly. The report is noise only. The "no colorbar" row confirms it is the
   only remaining source.

The reader and extension pages pass as is: the reader allows `'unsafe-inline'` styles, and the extension pages CSP
leaves `style-src` unrestricted. `'unsafe-eval'` and blob: workers are not needed anywhere, because the strict
bundle uses neither. Images (`img-src`) are not needed either: Spaces has no `img-src` and draws both plots.

## Verdict

**plotly works, with one small core-side fix for the nonce-only hosts (htmlShell with or without dataImages, and
Spaces). No host CSP has to change. There is no reason to fall back to uPlot + three.js.**

### Required fix, in core (how core loads Plotly)

In the plot loader, before `import("../plot/plotly.js")`, create the `<style>` element Plotly looks up by id, with the
page's script nonce on it. Plotly then finds it and adds every rule through CSSOM (`insertRule` on an allowed sheet).
Also create the maplibre id, empty, so that import-time injection is skipped. This is what `spike/fix.js` does; the
"+ core fix" rows are this code:

```js
const nonce = document.querySelector("script[nonce]")?.nonce ?? "";
for (const id of ["plotly.js-style-global", "9f215cf04c5486422605d13261cb87401f4e7763b6296af81e98efbc0130da53"]) {
  if (document.getElementById(id)) continue;
  const style = document.createElement("style");
  style.id = id;
  style.nonce = nonce;
  document.head.appendChild(style);
}
```

The natural home is `loadCorePlotly` in session 2's renderer, or the top of `packages/core/src/qmd/plot/plotly.ts`
before its import is evaluated. Note that ESM hoists imports, so in `plotly.ts` the pre-creation has to run in the
loader before the dynamic import. It is harmless on the reader and extension pages: they have no nonce, so it is
empty, and their CSP allows the style anyway. The maplibre id is a content hash inside the bundle: pin the plotly
version (already exact) and re-run this spike on upgrade.

### Optional fix for the remaining report (colorbar `style=""`)

The report has no visual effect. If zero reported violations is required while colour scales are shown, allow
exactly the empty style attribute in the nonce-only hosts' `style-src`: `'unsafe-hashes'
'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='` (sha256 of ""). The last row shows it clears the report. The
lines that would change:

- `packages/vscode/src/ui/htmlShell.ts:18`: `style-src 'nonce-${nonce}' 'unsafe-hashes' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' ${cspSource};`
- `packages/vscode/src/spaces/view.ts:176` and `:309`: the same change to `style-src`.
- These CSP strings are pinned by `packages/vscode/__tests__/ui/htmlShell.test.ts`,
  `packages/vscode/__tests__/webview/htmlShellSites.test.ts` and the Spaces tests.

The alternative is to leave the CSPs alone and accept the two reports per colour-scaled plot. The planner decides.

## Limits of this spike

- The CSP is sent as a header; the VS Code hosts use `<meta http-equiv>`. Both enforce the same `script-src` and
  `style-src` directives.
- The bundle is loaded as a classic `<script>` (UMD global). The hosts will get it as an esbuild ESM chunk through
  `import()`, which the spike does not exercise. The CSP outcome is the same, since chunks load from `cspSource` like
  the entry script.
- Chromium only, with SwiftShader WebGL. The Electron webview and Firefox (the extension) were not run.
