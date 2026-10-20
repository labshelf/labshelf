import { chromium } from "playwright";
import http from "node:http";
// Runs the session 1 proofs: OAuth redirect observation, token endpoint reach, Web Locks lease. Usage: node run.mjs <this dir>
const S = process.argv[2];
const server = http.createServer((q, r) => { r.writeHead(302, { Location: "http://127.0.0.1:8976/callback?code=CODE123&state=STATE456" }); r.end(); }).listen(0);
const port = server.address().port;
const ctx = await chromium.launchPersistentContext(S + "/profile", { headless: true, args: [`--disable-extensions-except=${S}/ext`, `--load-extension=${S}/ext`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const p1 = await ctx.newPage(); await p1.goto(`chrome-extension://${id}/page.html`);
console.log("callback", JSON.stringify(await p1.evaluate((u) => window.signIn(u), `http://localhost:${port}/start`)));
console.log("token", JSON.stringify(await p1.evaluate(() => window.tokenProbe())));
const p2 = await ctx.newPage(); await p2.goto(`chrome-extension://${id}/page.html`);
console.log("p1 lease", await p1.evaluate(() => window.takeLease("lib:A/share:X")));
console.log("p2 lease", await p2.evaluate(() => window.takeLease("lib:A/share:X")));
console.log("p2 other lib", await p2.evaluate(() => window.takeLease("lib:B/share:X")));
await p1.close(); // owner termination
await new Promise((r) => setTimeout(r, 300));
console.log("p2 after p1 closed", await p2.evaluate(() => window.takeLease("lib:A/share:X")));
const p3 = await ctx.newPage(); await p3.goto(`chrome-extension://${id}/page.html`);
console.log("p3 steal", await p3.evaluate(() => window.stealLease("lib:A/share:X")));
console.log("held", JSON.stringify(await p3.evaluate(() => window.queryLease())));
await ctx.close(); server.close();
