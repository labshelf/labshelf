/** Builds temp projects, a fake LaTeX program, a fake Typst session and a recording toolchain prompt for the project build tests. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { TECTONIC_VERSION, type LatexEngine, type ProjectEntry, type ProjectSettings } from "../../../../src/writing/index";
import type { ToolchainPrompt } from "../../../../src/writing/build/index";
import type { ProjectBuildDeps } from "../../../../src/writing/build/node/index";
import type { TypstSession } from "../../../../src/writing/typst/index";
import { TypstPackageStore } from "../../../../src/writing/typst/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { makeTempDir } from "../../../support/tempDirs";

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export interface BuildFixture {
  folder: string;
  storageDir: string;
  /** Each run of the fake program appends one line here. */
  runs: string;
  /** While this file exists, the next run sleeps before it writes the PDF. */
  marker: string;
  /** A folder holding a fake `latexmk`, to put on PATH. */
  texLiveBin: string;
  saved: Array<{ folder: string; patch: unknown }>;
  prompt: ToolchainPrompt & { calls: string[] };
  deps: ProjectBuildDeps;
  project(settings?: Partial<ProjectSettings>, main?: string | null): ReadyEntry;
}

function fakeProgram(runs: string, marker: string): string {
  return `#!/bin/sh
PATH=/bin:/usr/bin
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --outdir) OUT="$2"; shift;;
    -outdir=*) OUT="\${1#-outdir=}";;
  esac
  shift
done
echo run >> "${runs}"
if [ -f "${marker}" ]; then rm "${marker}"; sleep 5; fi
mkdir -p "$OUT"
echo "%PDF-1.5 built" > "$OUT/main.pdf"
echo "(main.tex)" > "$OUT/main.log"
`;
}

function recordingPrompt(engine: LatexEngine | undefined, confirm: boolean): BuildFixture["prompt"] {
  const calls: string[] = [];
  return {
    calls,
    pickEngine: async (options) => { calls.push(`pick:${options.texLiveInstalled}`); return engine; },
    confirmTectonicDownload: async () => { calls.push("confirm"); return confirm; },
    downloading: async (run) => { calls.push("download"); return run(new AbortController().signal); },
    offerTectonic: async () => { calls.push("offer"); return false; },
  };
}

const fakeSession = {
  compile: async () => ({ pdf: new TextEncoder().encode("%PDF-typst"), diagnostics: [], citations: { cites: [] } }),
} as unknown as TypstSession;

export async function buildFixture(choice: { engine?: LatexEngine; confirm?: boolean; tectonicInstalled?: boolean } = {}): Promise<BuildFixture> {
  const folder = await makeTempDir();
  const storageDir = await makeTempDir();
  const scratch = await makeTempDir();
  const buildRoot = await makeTempDir();
  const runs = path.join(scratch, "runs");
  const marker = path.join(scratch, "marker");
  const program = fakeProgram(runs, marker);
  await fs.writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n");
  await fs.writeFile(path.join(folder, "main.typ"), "Hello\n");
  const texLiveBin = path.join(scratch, "bin");
  await fs.mkdir(texLiveBin);
  await fs.writeFile(path.join(texLiveBin, "latexmk"), program, { mode: 0o755 });
  if (choice.tectonicInstalled) {
    const dir = path.join(storageDir, "tectonic", TECTONIC_VERSION);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "tectonic"), program, { mode: 0o755 });
  }
  const saved: BuildFixture["saved"] = [];
  const prompt = recordingPrompt(choice.engine, choice.confirm ?? false);
  const packages = new TypstPackageStore({ data: path.join(scratch, "data"), cache: path.join(scratch, "cache") });
  const deps: ProjectBuildDeps = {
    logger: fakeLogger(),
    toolchain: prompt,
    storageDir,
    projects: {
      updateProjectSettings: async (target, patch) => { saved.push({ folder: target, patch }); },
      projectBuildDir: (id) => path.join(buildRoot, id),
    },
    typst: { get: async () => ({ session: fakeSession, packages }) },
  };
  const project = (settings: Partial<ProjectSettings> = {}, main: string | null = "main.tex"): ReadyEntry => ({
    kind: "ready", folder, location: "library", main: main ?? undefined, settings: { id: "paper", format: "latex", ...settings },
  });
  return { folder, storageDir, runs, marker, texLiveBin, saved, prompt, deps, project };
}

export async function runCount(runs: string): Promise<number> {
  const text = await fs.readFile(runs, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}
