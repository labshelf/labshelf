// Tests that the web entry bundles without reaching Node, and that the build's no-node guard refuses each kind of Node import.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const pkgRoot = path.resolve(__dirname, "..");

/** Bundles `entry` in memory with the web build's no-node plugin; @returns the build's error text, empty on success. */
function bundleForWeb(entry: string): string {
  const script = `
    import { build } from "esbuild";
    import { noNodePlugin } from "./build/noNodePlugin.mjs";
    try {
      await build({ entryPoints: [${JSON.stringify(entry)}], bundle: true, write: false, platform: "browser", format: "cjs",
        external: ["vscode", "@myriaddreamin/typst-ts-renderer"], plugins: [noNodePlugin], logLevel: "silent", tsconfig: "tsconfig.json" });
    } catch (error) { console.log(error.errors.map((e) => e.text).join("\\n")); }`;
  return execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: pkgRoot, encoding: "utf8" }).trim();
}

function fixture(source: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "labshelf-web-")), "entry.ts");
  writeFileSync(file, source);
  return file;
}

describe("the web entry", () => {
  it("bundles for a browser host without any Node import", () => {
    expect(bundleForWeb(path.join(pkgRoot, "src/extensionWeb.ts"))).toBe("");
  }, 60_000);

  it.each([
    ["a node: import", 'import "node:fs";'],
    ["a Node builtin", 'import "path";'],
    ["a node/ folder", 'import "@labshelf/core/node";'],
  ])("refuses %s and names the importer", (reason, source) => {
    const entry = fixture(source);
    expect(bundleForWeb(entry)).toContain(`The web build imports ${reason}`);
    expect(bundleForWeb(entry)).toContain(entry);
  }, 60_000);
});
