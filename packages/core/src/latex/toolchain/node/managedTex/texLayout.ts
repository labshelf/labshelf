// Finds which managed TeX is installed under the shared TeX folder, with its bin dir and release year.
import { promises as fs } from "node:fs";
import { join } from "node:path";

export type ManagedTexKind = "texlive" | "tinytex";

export interface ManagedTex {
  kind: ManagedTexKind;
  root: string;
  /** `<root>/bin/<arch>`, holding tlmgr and latexmk. */
  binDir: string;
  /** The TeX Live release, or null when `release-texlive.txt` is missing or unreadable. */
  year: number | null;
}

// INVARIANT: a full TeX Live is preferred over TinyTeX when both are present.
const KINDS: ManagedTexKind[] = ["texlive", "tinytex"];

export function resolveManagedTexDir(texRoot: string, kind: ManagedTexKind): string {
  return join(texRoot, kind);
}

async function firstBinDir(root: string): Promise<string | null> {
  try {
    const arches = (await fs.readdir(join(root, "bin"), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const arch = arches.map((entry) => entry.name).sort()[0];
    return arch === undefined ? null : join(root, "bin", arch);
  } catch {
    return null;
  }
}

export async function readTexLiveYear(root: string): Promise<number | null> {
  try {
    const match = /version (\d{4})/.exec(await fs.readFile(join(root, "release-texlive.txt"), "utf8"));
    return match?.[1] ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** The managed TeX under `texRoot`, or null when none has a bin dir. */
export async function findManagedTex(texRoot: string): Promise<ManagedTex | null> {
  for (const kind of KINDS) {
    const root = resolveManagedTexDir(texRoot, kind);
    const binDir = await firstBinDir(root);
    if (binDir !== null) { return { kind, root, binDir, year: await readTexLiveYear(root) }; }
  }
  return null;
}
