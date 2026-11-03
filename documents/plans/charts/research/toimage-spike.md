# toImage spike: Plotly.toImage png and svg under each qmd host CSP

Spec 1.1 of plan charts (D6). Harness kept outside the repo (session scratchpad), modelled on the interactive-plots
renderer spike (`documents/plans/interactive-plots/research/renderer-spike.md`): Playwright's bundled Chromium
(playwright-core 1.64.1, new headless, SwiftShader WebGL), a local HTTP server, and one page per host carrying that
host's exact CSP as a `<meta http-equiv>` with a fresh nonce (the server origin stands in for `webview.cspSource`).
Each page loads, by nonce'd `<script src>`: a `securitypolicyviolation` recorder, `preparePlotlyStyles` (a verbatim
copy of `packages/core/src/qmd/dom/plotView.ts`), `plotly.js-strict-dist-min` 4.2.0, then a draw script that renders
one `heatmap` and one 3D `surface`, both with `colorscale: "Viridis", showscale: true`, and calls
`Plotly.toImage(root, {format: "png"})` and `{format: "svg"}` on each (15 s timeout each).

Checks:

- png: toImage resolves to a `data:image/png` URL that decodes to a 600x400 image with many colours, including in the
  colour bar strip (right 15 % of the image). The PNGs were also inspected by eye.
- svg: toImage resolves to a `data:image/svg+xml` URL whose markup contains the colour bar (`g.cbfills` with
  `rect.cbfill` filled by a gradient).
- colour bar: on screen the DOM has `rect.cbfill` with a `url(#gradient)` fill, and the colour bar appears in the svg
  and in the png.

## Results

| host (CSP) | png | svg | colour bar (screen / svg / png) | violations |
|---|---|---|---|---|
| source editor before (`htmlShell`, no img-src) | **fails** (`img-src` falls back to `default-src 'none'`: `blob:` blocked; toImage rejects with the img `error` Event) | ok | ok / ok / n.a. | `img-src` blob:, `img-src` data:, `style-src-attr` |
| source editor after (`images: 'qmd'`: `img-src <src> data: blob:`) | ok | ok | ok / ok / ok | `style-src-attr` only |
| library pane before (`dataImages`: `img-src <src> data:`) | **fails** (`blob:` blocked by `img-src <src> data:`) | ok | ok / ok / n.a. | `img-src` blob:, `style-src-attr` |
| library pane after (`images: 'qmd'`) | ok | ok | ok / ok / ok | `style-src-attr` only |
| spaces before (no img-src) | **fails** (same as source editor before) | ok | ok / ok / n.a. | `img-src` blob:, `img-src` data:, `style-src-attr` |
| spaces after (`cspImageSource(cspSource, 'qmd')`) | ok | ok | ok / ok / ok | `style-src-attr` only |
| reader (unchanged, `style-src 'unsafe-inline'`, `img-src <src> blob: data:`) | ok | ok | ok / ok / ok | none |
| browser extension page (unchanged, `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`) | ok | ok | ok / ok / ok | none |

Identical for the heatmap and the surface: the png path for the surface loads the WebGL snapshot and the rasterised
SVG the same way.

How toImage works in Chromium (confirmed by the violations): it serialises the SVG, loads it into an `<img>` from a
`blob:` URL, draws it on a canvas and reads `toDataURL`. For WebGL traces the scene snapshot is first embedded as a
`data:image/png` `<image>`. So png needs `img-src blob:` (and `data:` for 3D and for heatmaps). svg needs no image load
and works under every CSP.

Side findings:

- Before the change, the heatmap's own on-screen `<image href="data:image/png…">` was blocked in the source editor and
  Spaces (no img-src): heatmaps would draw blank there. `images: 'qmd'` (data:) fixes that too.
- The remaining `style-src-attr` report on the nonce-only hosts has two sources: the colour bar's empty
  `style=""` (noise, as the renderer spike found) and the heatmap's `image-rendering: pixelated` style attribute,
  which is blocked. Visible effect: on nonce-only hosts the heatmap cells are smoothed (interpolated) on screen and in
  the exported png, while the reader and the extension page draw crisp cells. Charts that use heatmaps should either
  accept the smoothing, or add a nonce'd stylesheet rule for `.heatmaplayer image { image-rendering: pixelated }`
  (fixes the screen only; the exported SVG/PNG does not see page CSS), or allow that exact attribute by hash with
  `'unsafe-hashes'`. Not decided here; it does not affect toImage.

## Decision

**Plotly.toImage png and svg work on every host once the qmd-hosting nonce-only webviews (source editor, library pane,
Spaces) allow `img-src <cspSource> data: blob:`; the colour bar renders on screen, in svg and in png on every host, so
charts may set `showscale: true`.** This session's CSP change (`cspImageSource`, `images: 'qmd'`) is kept. The reader
and the browser extension page need no change. No fallback is needed, so no package 1.4 is added. Should a future
host forbid `blob:`, the fallback is to take toImage's svg (which never loads an image) and rasterise it by a
CSP-safe path, or to paint the PNG like `paintDrawingPng`.

## Limits

- Chromium only, headless, SwiftShader WebGL. VS Code's Electron webview is Chromium and the CSP is the same meta
  tag, so the result should carry over; Firefox (the extension) and Safari (which toImage serves through `data:`
  instead of `blob:`; both are allowed after the change) were not run.
- The bundle is loaded as a classic script, not through the esbuild `import()` chunk; this does not affect `img-src`.
- In VS Code `webview.cspSource` is an https origin, not the page origin; `blob:` URLs are matched by the `blob:`
  keyword regardless, so this does not change the outcome.
