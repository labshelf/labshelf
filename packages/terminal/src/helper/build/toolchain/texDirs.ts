// Lists the directories where TeX Live, MacTeX and TinyTeX put latexmk.
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** `<root>/<year>/bin/<arch>` for every installed year, the highest year first. */
export async function texLiveBinDirs(root: string): Promise<string[]> {
  const years = (await subdirs(root)).filter((name) => /^\d{4}$/.test(name)).sort().reverse();
  const dirs: string[] = [];
  for (const year of years) {
    for (const arch of (await subdirs(join(root, year, "bin"))).sort()) { dirs.push(join(root, year, "bin", arch)); }
  }
  return dirs;
}

async function tinyTexBinDirs(root: string): Promise<string[]> {
  return (await subdirs(join(root, "bin"))).sort().map((arch) => join(root, "bin", arch));
}

/** Every place a TeX install puts latexmk, probed without reading PATH. */
export async function knownTexDirs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const home = env.HOME ?? homedir();
  const appData = env.APPDATA;
  return [
    "/Library/TeX/texbin",
    ...(await texLiveBinDirs("/usr/local/texlive")),
    ...(await texLiveBinDirs("C:\\texlive")),
    ...(await tinyTexBinDirs(join(home, "Library", "TinyTeX"))),
    ...(await tinyTexBinDirs(join(home, ".TinyTeX"))),
    ...(appData ? await tinyTexBinDirs(join(appData, "TinyTeX")) : []),
    "/usr/bin",
  ];
}
