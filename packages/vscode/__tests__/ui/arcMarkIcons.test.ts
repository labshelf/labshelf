// Tests the Arc mark and status mark icon pairs, and the build step that bakes the files into out/marks/.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { ARC_PROGRESSES, ARC_TONES, ARC_TONE_COLORS, arcMark, statusMark } from "@labshelf/core";

// FILE_TYPE_TOKENS is not exported by the core index; the build step reads the same source file.
import { FILE_TYPE_TOKENS } from "../../../core/src/ui/tokens/colorTokens";
import { arcIcons, statusIcons } from "../../src/ui";

describe("arcIcons", () => {
  it("returns the light and dark file of a tone and progress under the extension's out/marks/", () => {
    const icon = arcIcons(vscode.Uri.file("/ext"))("warn", "half");
    expect(icon.light.fsPath).toBe("/ext/out/marks/warn-half-light.svg");
    expect(icon.dark.fsPath).toBe("/ext/out/marks/warn-half-dark.svg");
  });
});

describe("statusIcons", () => {
  it("returns the Unread dot pair for unread and the status's Arc mark pair otherwise", () => {
    const icon = statusIcons(vscode.Uri.file("/ext"));
    expect(icon("unread").dark.fsPath).toBe("/ext/out/marks/unread-dark.svg");
    expect(icon("reading").light.fsPath).toBe("/ext/out/marks/accent-half-light.svg");
    expect(icon("done").light.fsPath).toBe("/ext/out/marks/ok-full-light.svg");
  });
});

describe("build/arcMarks.mjs", () => {
  it("writes a light and a dark SVG for every tone and progress with the tone's colour", () => {
    const outDir = mkdtempSync(join(tmpdir(), "labshelf-marks-"));
    try {
      const script = `import("./build/arcMarks.mjs").then((m) => m.writeArcMarks(${JSON.stringify(outDir)}))`;
      execFileSync(process.execPath, ["-e", script], { cwd: resolve(__dirname, "../.."), stdio: "pipe" });
      const marks = join(outDir, "marks");
      expect(readdirSync(marks)).toHaveLength(ARC_TONES.length * ARC_PROGRESSES.length * 2 + 4);
      expect(readFileSync(join(marks, "err-full-light.svg"), "utf8")).toBe(arcMark("err", "full", ARC_TONE_COLORS.err.light));
      expect(readFileSync(join(marks, "accent-none-dark.svg"), "utf8")).toBe(arcMark("accent", "none", ARC_TONE_COLORS.accent.dark));
      expect(readFileSync(join(marks, "unread-light.svg"), "utf8")).toBe(statusMark("unread", ARC_TONE_COLORS.accent.light));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("writes the REF mark of each theme with the file-ref token colour", () => {
    const outDir = mkdtempSync(join(tmpdir(), "labshelf-marks-"));
    try {
      const script = `import("./build/arcMarks.mjs").then((m) => m.writeArcMarks(${JSON.stringify(outDir)}))`;
      execFileSync(process.execPath, ["-e", script], { cwd: resolve(__dirname, "../.."), stdio: "pipe" });
      const marks = readdirSync(join(outDir, "marks"));
      expect(marks).toEqual(expect.arrayContaining(["ref-light.svg", "ref-dark.svg"]));
      const { value: dark, light } = FILE_TYPE_TOKENS["file-ref"];
      expect(readFileSync(join(outDir, "marks", "ref-light.svg"), "utf8")).toContain(light);
      expect(readFileSync(join(outDir, "marks", "ref-dark.svg"), "utf8")).toContain(dark);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
