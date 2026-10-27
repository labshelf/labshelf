// Tests the Arc mark icon pairs and the build step that bakes the files into out/marks/.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { ARC_PROGRESSES, ARC_TONES, ARC_TONE_COLORS, renderArcMarkSvg } from "@labshelf/core";

import { createArcIcons } from "../../src/ui";

describe("createArcIcons", () => {
  it("returns the light and dark file of a tone and progress under the extension's out/marks/", () => {
    const icon = createArcIcons(vscode.Uri.file("/ext"))("warn", "half");
    expect(icon.light.fsPath).toBe("/ext/out/marks/warn-half-light.svg");
    expect(icon.dark.fsPath).toBe("/ext/out/marks/warn-half-dark.svg");
  });
});

describe("build/arcMarks.mjs", () => {
  it("writes a light and a dark SVG for every tone and progress with the tone's colour", () => {
    const outDir = mkdtempSync(join(tmpdir(), "labshelf-marks-"));
    try {
      const script = `import("./build/arcMarks.mjs").then((m) => m.writeArcMarks(${JSON.stringify(outDir)}))`;
      execFileSync(process.execPath, ["-e", script], { cwd: resolve(__dirname, "../.."), stdio: "pipe" });
      const marks = join(outDir, "marks");
      expect(readdirSync(marks)).toHaveLength(ARC_TONES.length * ARC_PROGRESSES.length * 2);
      expect(readFileSync(join(marks, "err-full-light.svg"), "utf8")).toBe(renderArcMarkSvg("err", "full", ARC_TONE_COLORS.err.light));
      expect(readFileSync(join(marks, "accent-none-dark.svg"), "utf8")).toBe(renderArcMarkSvg("accent", "none", ARC_TONE_COLORS.accent.dark));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
