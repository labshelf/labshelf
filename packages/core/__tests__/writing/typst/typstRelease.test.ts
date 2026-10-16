/** Verifies the pinned Typst release matches the installed compiler package and lists unique, checksummed fonts. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION } from "../../../src/writing/typst/index";

const nodeRequire = createRequire(__filename);

describe("Typst release pin", () => {
  it("pins the web compiler package version", () => {
    const manifest = JSON.parse(readFileSync(nodeRequire.resolve("@myriaddreamin/typst-ts-web-compiler/package.json"), "utf8")) as { version: string };
    expect(manifest.version).toBe("0.7.0");
  });

  it("matches the Typst version compiled into the wasm", () => {
    const wasm = readFileSync(nodeRequire.resolve("@myriaddreamin/typst-ts-web-compiler/wasm"));
    expect(wasm.includes(`typst-assets-${TYPST_VERSION}`)).toBe(true);
  });

  it("downloads fonts from the matching typst-assets tag", () => {
    expect(TYPST_FONT_BASE_URL).toContain(`v${TYPST_VERSION}/`);
  });

  it("lists each font file once with a 64-hex sha256", () => {
    const files = TYPST_FONTS.map((font) => font.file);
    expect(new Set(files).size).toBe(files.length);
    for (const font of TYPST_FONTS) { expect(font.sha256).toMatch(/^[0-9a-f]{64}$/); }
  });
});
