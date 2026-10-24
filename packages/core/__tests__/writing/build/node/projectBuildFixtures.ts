/** Builds temp projects, a fake LaTeX program, a fake managed TeX, a fake Typst session and a recording TeX setup prompt for the project build tests. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ProjectEntry, ProjectSettings } from "../../../../src/writing/index";
import type { TexSetupPrompt } from "../../../../src/writing/build/index";
import type { ProjectBuildDeps } from "../../../../src/writing/build/node/index";
import type { TexInstallKind } from "../../../../src/latex/toolchain/index";
import type { ManagedTexProvider } from "../../../../src/latex/toolchain/node/managedTex/index";
import type { TypstSession } from "../../../../src/writing/typst/index";
import { TypstPackageStore } from "../../../../src/writing/typst/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { makeTempDir } from "../../../support/tempDirs";

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export interface TexChoice {
  /** Whether a TeX installation is found before any install; true when absent. */
  installed?: boolean;
  /** What the user picks when asked to install; declines when absent. */
  pick?: TexInstallKind;
  /** The error the install throws. */
  installError?: Error;
  /** Whether installMissing installs the file; true when absent. */
  packageInstalls?: boolean;
}

export interface BuildFixture {
  folder: string;
  /** Each run of the fake program appends one line here. */
  runs: string;
  /** While this file exists, the next run sleeps before it writes the PDF. */
  marker: string;
  /** While this file exists, runs fail on a missing `foo.sty`; installing it deletes the file. */
  missing: string;
  prompt: TexSetupPrompt & { calls: string[] };
  tex: ManagedTexProvider & { calls: string[] };
  deps: ProjectBuildDeps;
  project(settings?: Partial<ProjectSettings>, main?: string | null): ReadyEntry;
}

function fakeProgram(runs: string, marker: string, missing: string): string {
  return `#!/bin/sh
PATH=/bin:/usr/bin
OUT=""
ARGS=""
while [ $# -gt 0 ]; do
  ARGS="$ARGS $1"
  case "$1" in
    -outdir=*) OUT="\${1#-outdir=}";;
  esac
  shift
done
echo "run$ARGS" >> "${runs}"
if [ -f "${marker}" ]; then rm "${marker}"; sleep 5; fi
mkdir -p "$OUT"
if [ -f "${missing}" ]; then
  printf '(main.tex\\n! LaTeX Error: File \`foo.sty'"'"' not found.\\n' > "$OUT/main.log"
  exit 1
fi
echo "%PDF-1.5 built" > "$OUT/main.pdf"
echo "(main.tex)" > "$OUT/main.log"
`;
}

function recordingPrompt(choice: TexChoice): BuildFixture["prompt"] {
  const calls: string[] = [];
  return {
    calls,
    chooseInstall: async () => { calls.push("choose"); return choice.pick; },
    progress: async (title, run) => { calls.push(`progress:${title}`); return run((message) => calls.push(`report:${message}`)); },
  };
}

function fakeTex(executable: string, missing: string, choice: TexChoice): BuildFixture["tex"] {
  const calls: string[] = [];
  let installed = choice.installed ?? true;
  const status = { source: "none", complete: false } as const;
  return {
    calls,
    resolve: async (engine) => { calls.push(`resolve:${engine}`); return installed ? { engine, executable } : "missing"; },
    install: async (kind, onProgress) => {
      calls.push(`install:${kind}`);
      if (choice.installError) { throw choice.installError; }
      onProgress(0.5);
      onProgress(null);
      installed = true;
      return status;
    },
    installAllPackages: async () => status,
    installMissing: async (fileName) => {
      calls.push(`installMissing:${fileName}`);
      if (choice.packageInstalls === false) { return false; }
      await fs.rm(missing, { force: true });
      return true;
    },
    status: async () => status,
  };
}

const fakeSession = {
  compile: async () => ({ pdf: new TextEncoder().encode("%PDF-typst"), diagnostics: [], citations: { cites: [] } }),
} as unknown as TypstSession;

export async function buildFixture(choice: TexChoice = {}): Promise<BuildFixture> {
  const folder = await makeTempDir();
  const scratch = await makeTempDir();
  const buildRoot = await makeTempDir();
  const runs = path.join(scratch, "runs");
  const marker = path.join(scratch, "marker");
  const missing = path.join(scratch, "missing");
  await fs.writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n");
  await fs.writeFile(path.join(folder, "main.typ"), "Hello\n");
  const latexmk = path.join(scratch, "latexmk");
  await fs.writeFile(latexmk, fakeProgram(runs, marker, missing), { mode: 0o755 });
  const prompt = recordingPrompt(choice);
  const tex = fakeTex(latexmk, missing, choice);
  const packages = new TypstPackageStore({ data: path.join(scratch, "data"), cache: path.join(scratch, "cache") });
  const deps: ProjectBuildDeps = {
    logger: fakeLogger(),
    prompt,
    tex,
    projects: { projectBuildDir: (id) => path.join(buildRoot, id) },
    typst: { get: async () => ({ session: fakeSession, packages }) },
  };
  const project = (settings: Partial<ProjectSettings> = {}, main: string | null = "main.tex"): ReadyEntry => ({
    kind: "ready", folder, location: "library", main: main ?? undefined, settings: { id: "paper", format: "latex", ...settings },
  });
  return { folder, runs, marker, missing, prompt, tex, deps, project };
}

export async function runCount(runs: string): Promise<number> {
  const text = await fs.readFile(runs, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}
