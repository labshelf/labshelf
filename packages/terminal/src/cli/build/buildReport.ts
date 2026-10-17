// Words what a project build reported: located problems as compiler-style lines and a missing toolchain with its install hint.
import * as path from "node:path";

import { TECTONIC_VERSION, texLiveGuideUrl, type ToolchainMissing } from "@labshelf/core";
import type { LocatedProblem } from "@labshelf/core";

const TECTONIC_INSTALL = "https://tectonic-typesetting.github.io/en-US/install.html";

/** `path:line: severity: message`, then the hint indented on the next line; paths are relative to `cwd` so editors can jump to them. */
export function problemLines(problems: readonly LocatedProblem[], projectFolder: string, cwd: string): string[] {
  return problems.flatMap((problem) => {
    const file = path.relative(cwd, path.resolve(projectFolder, problem.file));
    const where = problem.line === undefined ? file : `${file}:${problem.line}`;
    const line = `${where}: ${problem.severity}: ${problem.message}`;
    return problem.hint ? [line, `  ${problem.hint}`] : [line];
  });
}

export function toolchainMissingText(missing: ToolchainMissing, platform: string): string {
  const tectonic = `Install Tectonic (${TECTONIC_INSTALL}) or TeX Live (${texLiveGuideUrl(platform)}), then run build again.`;
  switch (missing.reason) {
    case "declined": return `No LaTeX toolchain is set up. ${tectonic}\nRun in a terminal to let LabShelf download Tectonic ${TECTONIC_VERSION} for you.`;
    case "tex-live-missing": return `TeX Live is not installed. ${tectonic}`;
    case "tectonic-unsupported": return `Tectonic has no release for this system. Install TeX Live: ${texLiveGuideUrl(platform)}`;
    case "download-failed": return `Downloading Tectonic failed: ${missing.message}\n${tectonic}`;
  }
}
