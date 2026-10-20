// Finds the files of a control file's data sources where biber looks for them, refusing any outside the project, the build folder and the TeX tree.
// TeX's `openin_any=p` (see ../../build/texSandbox.ts) bounds what the engine reads; biber has no such guard, so these bounds stand in for it.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import type { DataSource } from "../controlFile.js";

export interface SourcePlaces {
  /** The folder latexmk runs biber in: the main file's folder. */
  cwd: string;
  project: string;
  /** The folder of the `.bcf`. */
  build: string;
  env: NodeJS.ProcessEnv;
}

export interface LocatedSource {
  /** The file to read on disk. */
  file: string;
  /** Where the module's file system holds it, so the name in the `.bcf` resolves from `cwd` as on disk. */
  placed: string;
}

export class DataSourceRefused extends Error {}

const run = promisify(execFile);

const isWithin = (folder: string, file: string): boolean => {
  const relative = path.relative(folder, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const real = (file: string): Promise<string | undefined> => realpath(file).catch(() => undefined);

async function kpsewhich(args: string[], places: SourcePlaces): Promise<string | undefined> {
  const { stdout } = await run("kpsewhich", args, { cwd: places.cwd, env: places.env }).catch(() => ({ stdout: "" }));
  return stdout.trim().split(/\r?\n/)[0] || undefined;
}

async function texTree(places: SourcePlaces): Promise<string | undefined> {
  const root = await kpsewhich(["-var-value=TEXMFROOT"], places);
  return root ? real(root) : undefined;
}

// PLATFORM: biber tries the name as given (from cwd), then beside the `.bcf`, then kpsewhich.
async function locate(source: DataSource, places: SourcePlaces, allowed: string[]): Promise<LocatedSource> {
  for (const candidate of [path.resolve(places.cwd, source.path), path.resolve(places.build, source.path)]) {
    const file = await real(candidate);
    if (file === undefined) { continue; }
    if (!allowed.some((folder) => isWithin(folder, file))) { throw new DataSourceRefused(`Data source ${source.path} is outside the project folder`); }
    return { file, placed: candidate };
  }
  const found = await kpsewhich([source.path], places);
  const file = found === undefined ? undefined : await real(path.resolve(places.cwd, found));
  const tree = file === undefined ? undefined : await texTree(places);
  if (file === undefined) { throw new DataSourceRefused(`Cannot find data source ${source.path}`); }
  if (![...allowed, ...(tree ? [tree] : [])].some((folder) => isWithin(folder, file))) {
    throw new DataSourceRefused(`Data source ${source.path} is outside the project folder and the TeX tree`);
  }
  return { file, placed: path.resolve(places.cwd, source.path) };
}

export async function locateDataSources(sources: readonly DataSource[], places: SourcePlaces): Promise<LocatedSource[]> {
  const allowed = (await Promise.all([places.project, places.build].map(real))).filter((folder): folder is string => folder !== undefined);
  return Promise.all(sources.map((source) => locate(source, places, allowed)));
}
