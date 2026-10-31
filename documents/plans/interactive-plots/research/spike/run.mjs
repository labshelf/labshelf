// Spike: does plotly.js-strict draw a 2D and a 3D plot under each LabShelf host's exact CSP?
// Run: node documents/plans/interactive-plots/research/spike/run.mjs  (always exits 0; the table is the deliverable)
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../../..");
const coreRequire = createRequire(join(repo, "packages/core/package.json"));
const bundlePath = coreRequire.resolve("plotly.js-strict-dist-min");
const bundle = readFileSync(bundlePath);
const { createCanvas, loadImage } = coreRequire("@napi-rs/canvas");

/**
 * Each host's CSP, copied verbatim from its source; `N` is the nonce and `S` the webview cspSource (here the spike
 * server's origin, standing in for https://*.vscode-cdn.net).
 */
const HOSTS = [
  { name: "htmlShell", from: "packages/vscode/src/ui/htmlShell.ts:18",
    csp: (N, S) => `default-src 'none'; script-src 'nonce-${N}' ${S}; style-src 'nonce-${N}' ${S}; font-src ${S};` },
  { name: "htmlShell+dataImages", from: "packages/vscode/src/ui/htmlShell.ts:17-18",
    csp: (N, S) => `default-src 'none'; script-src 'nonce-${N}' ${S}; style-src 'nonce-${N}' ${S}; img-src ${S} data:; font-src ${S};` },
  { name: "spaces", from: "packages/vscode/src/spaces/view.ts:176,309",
    csp: (N, S) => `default-src 'none'; script-src 'nonce-${N}' ${S}; style-src 'nonce-${N}' ${S}; font-src ${S};` },
  { name: "reader", from: "packages/vscode/src/reader/shell.ts:60",
    csp: (N, S) => `default-src 'none'; script-src 'nonce-${N}' 'wasm-unsafe-eval' ${S}; worker-src ${S} blob:; style-src 'unsafe-inline' ${S}; img-src ${S} blob: data:; connect-src ${S}; font-src ${S};` },
  { name: "browser extension_pages", from: "packages/browser/manifest.chrome.json:73 (firefox :89)",
    csp: () => "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
];
// The same nonce-only hosts again with the candidate core fix (fix.js) loaded before Plotly.
for (const name of ["htmlShell", "htmlShell+dataImages", "spaces"]) HOSTS.push({ ...HOSTS.find((h) => h.name === name), name: `${name} + fix`, fix: true });
// Isolates the remaining style-src-attr report: the surface without its colorbar (d3 `.attr("style", "")` on cbfill rects).
HOSTS.push({ ...HOSTS[0], name: "htmlShell + fix, no colorbar", fix: true, noScale: true });
// Candidate CSP addition for that report: allow only the empty style attribute (sha256 of "").
const EMPTY_STYLE = "'unsafe-hashes' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";
HOSTS.push({ name: "htmlShell + fix + empty-style hash", from: "candidate", fix: true,
  csp: (N, S) => `default-src 'none'; script-src 'nonce-${N}' ${S}; style-src 'nonce-${N}' ${EMPTY_STYLE} ${S}; font-src ${S};` });

const page = (nonce, fix, noScale) => `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>plot spike</title></head>
<body${noScale ? ' data-noscale=""' : ""}><div id="p2d"></div><div id="p3d"></div>
<script nonce="${nonce}" src="/mark.js"></script>${fix ? `\n<script nonce="${nonce}" src="/fix.js"></script>` : ""}
<script nonce="${nonce}" src="/plotly.js"></script>
<script nonce="${nonce}" src="/draw.js"></script>
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (type, body, headers = {}) => { res.writeHead(200, { "content-type": type, ...headers }); res.end(body); };
  if (url.pathname === "/plotly.js") return send("text/javascript", bundle);
  if (["/mark.js", "/fix.js", "/draw.js"].includes(url.pathname)) return send("text/javascript", readFileSync(join(here, url.pathname.slice(1))));
  const host = HOSTS.find((h) => `/host/${encodeURIComponent(h.name)}` === url.pathname);
  if (!host) { res.writeHead(404); return res.end(); }
  const nonce = randomBytes(16).toString("base64");
  send("text/html", page(nonce, host.fix, host.noScale), { "content-security-policy": host.csp(nonce, `http://${req.headers.host}`) });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/** Distinct colours in the middle of a screenshot; a drawn surface has many, a blank or failed canvas one or two. */
async function distinctColours(png) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(Math.floor(image.width / 4), Math.floor(image.height / 4), Math.floor(image.width / 2), Math.floor(image.height / 2));
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return seen.size;
}

const browser = await chromium.launch({ channel: "chromium", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const results = [];
for (const host of HOSTS) {
  const tab = await browser.newPage({ viewport: { width: 700, height: 1000 } });
  const consoleErrors = [];
  tab.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  tab.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  const row = { host: host.name, from: host.from, csp: host.csp("NONCE", "SRC") };
  try {
    await tab.goto(`${origin}/host/${encodeURIComponent(host.name)}`);
    await tab.waitForFunction(() => window.__spike && window.__spike.done, null, { timeout: 60_000 });
    const spike = await tab.evaluate(() => window.__spike);
    const dom = await tab.evaluate(() => {
      const size = (el) => { const r = el?.getBoundingClientRect(); return r ? Math.round(r.width) * Math.round(r.height) : 0; };
      const p2d = document.getElementById("p2d");
      const p3d = document.getElementById("p3d");
      const svgs = p2d.querySelectorAll("svg.main-svg");
      const line = p2d.querySelector(".scatterlayer .trace path.js-line");
      const modebar = p2d.querySelector(".modebar");
      const canvas = p3d.querySelector("canvas");
      return {
        svgArea: size(svgs[0]), svgCount: svgs.length,
        lineDrawn: Boolean(line && (line.getAttribute("d") || "").length > 20),
        // Plotly's injected rules: .main-svg and .modebar are position:absolute; unstyled, they fall back to static.
        mainSvgPosition: svgs[0] ? getComputedStyle(svgs[0]).position : "none",
        modebarPosition: modebar ? getComputedStyle(modebar).position : "none",
        canvasArea: size(canvas), webglMessage: (p3d.textContent || "").includes("WebGL"),
        dragRect: (() => { const r = p2d.querySelector(".nsewdrag")?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })(),
      };
    });
    let hover = false;
    if (dom.dragRect) {
      // Hover the 10th point (x = 1.8): its pixel position comes from Plotly's own axis mapping.
      const pt = await tab.evaluate(() => { const gd = document.getElementById("p2d"); const xa = gd._fullLayout.xaxis; const ya = gd._fullLayout.yaxis; return { x: xa._offset + xa.d2p(1.8), y: ya._offset + ya.d2p(Math.sin(1.8)) }; });
      const box = await tab.locator("#p2d").boundingBox();
      await tab.mouse.move(box.x + pt.x - 20, box.y + pt.y);
      await tab.mouse.move(box.x + pt.x, box.y + pt.y, { steps: 5 });
      await tab.waitForTimeout(400);
      hover = await tab.evaluate(() => document.querySelectorAll("#p2d .hoverlayer .hovertext").length > 0);
    }
    const colours = dom.canvasArea > 0 ? await distinctColours(await tab.locator("#p3d").screenshot()) : 0;
    const styled = dom.mainSvgPosition === "absolute" && dom.modebarPosition === "absolute";
    Object.assign(row, {
      pass2d: !spike.error && dom.svgArea > 0 && dom.lineDrawn && styled && hover,
      pass3d: !spike.error && dom.canvasArea > 0 && !dom.webglMessage && colours > 20,
      hover, styled, colours, ...dom, dragRect: undefined,
      tLoadedMs: Math.round(spike.tLoaded ?? -1), t2dMs: Math.round(spike.t2d ?? -1), t3dMs: Math.round(spike.t3d ?? -1),
      error: spike.error ?? null,
      violations: [...new Map(spike.violations.map((v) => [`${v.directive}|${v.blocked}|${v.sample}|${v.source}`, v])).values()],
      violationCount: spike.violations.length,
    });
  } catch (error) {
    Object.assign(row, { pass2d: false, pass3d: false, error: String(error.message).slice(0, 300) });
  }
  row.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
  results.push(row);
  await tab.close();
}
await browser.close();
server.close();

const raw = bundle.length;
const gzip = gzipSync(bundle, { level: 9 }).length;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`plotly.js-strict-dist-min ${coreRequire("plotly.js-strict-dist-min/package.json").version}: raw ${mb(raw)}, gzip ${mb(gzip)}\n`);
console.log("| host | 2D | 3D | hover | styled | 3D colours | load ms | first 2D ms | 3D ms | violations |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  const v = (r.violations ?? []).map((x) => `${x.directive}${x.blocked ? ` (${x.blocked})` : ""}${x.sample ? ` "${x.sample.slice(0, 40)}"` : ""} @${x.source}`).join("; ") || "none";
  console.log(`| ${r.host} | ${r.pass2d ? "pass" : "FAIL"} | ${r.pass3d ? "pass" : "FAIL"} | ${r.hover ?? "-"} | ${r.styled ?? "-"} | ${r.colours ?? "-"} | ${r.tLoadedMs ?? "-"} | ${r.t2dMs ?? "-"} | ${r.t3dMs ?? "-"} | ${(r.violationCount ?? 0)}x: ${v} |`);
}
for (const r of results) if (r.error || r.consoleErrors.length) console.log(`\n${r.host}: error=${r.error ?? "none"}\n  console: ${r.consoleErrors.join("\n  console: ") || "none"}`);
writeFileSync(join(here, "results.json"), `${JSON.stringify({ bundle: { raw, gzip }, results }, null, 2)}\n`);
process.exit(0);
