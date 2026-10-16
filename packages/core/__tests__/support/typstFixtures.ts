/** Real Typst compiler inputs for tests: the WASM bytes, one font, and a demo package archive served from memory. */
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { nodeTypstFiles } from "../../src/writing/typst/node/index";
import { openTypstSession, type TypstPackageResolver } from "../../src/writing/typst/index";
import { makeTempDir } from "./tempDirs";

const nodeRequire = createRequire(__filename);

export const TYPST_TEST_FONT_SETTING = '#set text(font: "Liberation Sans")\n';
export const DEMO_PACKAGE_URL = "https://packages.typst.org/preview/demo-pkg-0.1.0.tar.gz";

export function typstWasm(): Uint8Array {
  return new Uint8Array(readFileSync(nodeRequire.resolve("@myriaddreamin/typst-ts-web-compiler/wasm")));
}

function liberationSans(): Uint8Array {
  const pdfjsRoot = path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
  return new Uint8Array(readFileSync(path.join(pdfjsRoot, "standard_fonts", "LiberationSans-Regular.ttf")));
}

export function openTestSession(packages: TypstPackageResolver) {
  return openTypstSession({ wasm: typstWasm(), fonts: [liberationSans()], files: nodeTypstFiles, packages });
}

/** The bytes of a real .tar.gz of the `demo-pkg` 0.1.0 package, which exports `greet(name)`. */
export async function demoPackageArchive(): Promise<Buffer> {
  const dir = await makeTempDir();
  const content = path.join(dir, "content");
  await fs.mkdir(content);
  await fs.writeFile(path.join(content, "typst.toml"), '[package]\nname = "demo-pkg"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n');
  await fs.writeFile(path.join(content, "lib.typ"), "#let greet(n) = [Hello #n]\n");
  const archive = path.join(dir, "pkg.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", content, "."]);
  return fs.readFile(archive);
}

export function respond(status: number, body: Uint8Array | string = ""): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status });
}
