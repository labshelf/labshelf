/** Verifies locateTool: the override first, then PATH, then the D6 install locations per platform; the existence probe is injected. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { locateTool } from "../../../../src/qmd/compute/node/locateTool";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const slashes = (value: string | undefined): string | undefined => value?.replace(/\\/g, "/");

/** An existence probe that says yes only for `<root>/**` files named like the tool, whatever the nesting below `root`. */
const existsUnder = (root: string, names: string[]) => async (candidate: string): Promise<boolean> => {
  const normalized = candidate.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return normalized.startsWith(root) && names.includes(base);
};

const nothing = async (): Promise<boolean> => false;

/** An empty directory to stand in for PATH, so the real PATH of the machine never answers. */
const emptyPath = async (): Promise<NodeJS.ProcessEnv> => ({ PATH: await makeTempDir("empty-path-") });

const fakeTool = async (dir: string, name: string): Promise<string> => {
  const file = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
  await fs.writeFile(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.chmod(file, 0o755);
  return file;
};

describe("locateTool on PATH and with an override", () => {
  it("2.2a finds a fake wolframscript on PATH", async () => {
    const dir = await makeTempDir("path-wolfram-");
    const file = await fakeTool(dir, "wolframscript");
    const found = await locateTool("wolframscript", { platform: process.platform, env: { PATH: dir } });
    expect(found).toBe(file);
  });

  it("2.2a finds a fake Rscript on PATH", async () => {
    const dir = await makeTempDir("path-r-");
    const file = await fakeTool(dir, "Rscript");
    const found = await locateTool("Rscript", { platform: process.platform, env: { PATH: dir } });
    expect(found).toBe(file);
  });

  it("2.2a prefers the override over PATH and over the install locations", async () => {
    const onPath = await makeTempDir("path-wolfram-");
    await fakeTool(onPath, "wolframscript");
    const elsewhere = await makeTempDir("override-wolfram-");
    const override = await fakeTool(elsewhere, "wolframscript");
    const found = await locateTool("wolframscript", {
      override,
      platform: "darwin",
      env: { PATH: onPath },
      exists: async () => true,
    });
    expect(found).toBe(override);
  });

  it("2.2a prefers PATH over the install locations", async () => {
    const onPath = await makeTempDir("path-r-");
    const file = await fakeTool(onPath, "Rscript");
    const found = await locateTool("Rscript", { platform: "linux", env: { PATH: onPath }, exists: async () => true });
    expect(found).toBe(file);
  });

  it("2.2a gives undefined when the tool is nowhere", async () => {
    expect(await locateTool("wolframscript", { platform: "linux", env: await emptyPath(), exists: nothing })).toBeUndefined();
    expect(await locateTool("Rscript", { platform: "darwin", env: await emptyPath(), exists: nothing })).toBeUndefined();
  });
});

describe("locateTool in the D6 locations", () => {
  const macWolfram = ["/Applications/Wolfram Engine.app", "/Applications/Mathematica.app", "/Applications/Wolfram.app"];

  it.each(macWolfram)("2.2a finds wolframscript inside %s on macOS", async (app) => {
    const found = slashes(await locateTool("wolframscript", {
      platform: "darwin",
      env: await emptyPath(),
      exists: existsUnder(app, ["wolframscript"]),
    }));
    expect(found).toBeDefined();
    expect(found?.startsWith(app)).toBe(true);
    expect(path.posix.basename(found ?? "")).toBe("wolframscript");
  });

  it.each(["/usr/local/bin", "/opt/homebrew/bin"])("2.2a finds wolframscript in %s on macOS", async (dir) => {
    const found = slashes(await locateTool("wolframscript", {
      platform: "darwin",
      env: await emptyPath(),
      exists: async (candidate) => slashes(candidate) === `${dir}/wolframscript`,
    }));
    expect(found).toBe(`${dir}/wolframscript`);
  });

  it.each(["/Library/Frameworks/R.framework/Resources/bin", "/usr/local/bin", "/opt/homebrew/bin"])("2.2a finds Rscript in %s on macOS", async (dir) => {
    const found = slashes(await locateTool("Rscript", {
      platform: "darwin",
      env: await emptyPath(),
      exists: async (candidate) => slashes(candidate) === `${dir}/Rscript`,
    }));
    expect(found).toBe(`${dir}/Rscript`);
  });

  it.each(["/usr/bin", "/usr/local/bin"])("2.2a finds wolframscript in %s on Linux", async (dir) => {
    const found = slashes(await locateTool("wolframscript", {
      platform: "linux",
      env: await emptyPath(),
      exists: async (candidate) => slashes(candidate) === `${dir}/wolframscript`,
    }));
    expect(found).toBe(`${dir}/wolframscript`);
  });

  it.each(["/usr/bin", "/usr/local/bin"])("2.2a finds Rscript in %s on Linux", async (dir) => {
    const found = slashes(await locateTool("Rscript", {
      platform: "linux",
      env: await emptyPath(),
      exists: async (candidate) => slashes(candidate) === `${dir}/Rscript`,
    }));
    expect(found).toBe(`${dir}/Rscript`);
  });

  it("2.2a finds wolframscript.exe under Program Files\\Wolfram Research\\<product>\\<version> on Windows", async () => {
    const programFiles = await makeTempDir("program-files-");
    const dir = path.join(programFiles, "Wolfram Research", "Wolfram Engine", "14.0");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "wolframscript.exe"), "");
    const found = slashes(await locateTool("wolframscript", { platform: "win32", env: { PATH: "", ProgramFiles: programFiles } }));
    expect(found).toBe(slashes(path.join(dir, "wolframscript.exe")));
  });

  it("2.2a finds wolframscript.exe directly under Program Files\\Wolfram Research\\<product> on Windows", async () => {
    const programFiles = await makeTempDir("program-files-");
    const dir = path.join(programFiles, "Wolfram Research", "Mathematica");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "wolframscript.exe"), "");
    const found = slashes(await locateTool("wolframscript", { platform: "win32", env: { PATH: "", ProgramFiles: programFiles } }));
    expect(found).toBe(slashes(path.join(dir, "wolframscript.exe")));
  });

  it("2.2a finds Rscript.exe under Program Files\\R\\R-*\\bin on Windows", async () => {
    const programFiles = await makeTempDir("program-files-");
    const dir = path.join(programFiles, "R", "R-4.3.2", "bin");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "Rscript.exe"), "");
    const found = slashes(await locateTool("Rscript", { platform: "win32", env: { PATH: "", ProgramFiles: programFiles } }));
    expect(found).toBe(slashes(path.join(dir, "Rscript.exe")));
  });

  it("2.2a gives undefined on Windows when Program Files holds neither tool", async () => {
    const programFiles = await makeTempDir("program-files-");
    expect(await locateTool("Rscript", { platform: "win32", env: { PATH: "", ProgramFiles: programFiles } })).toBeUndefined();
    expect(await locateTool("wolframscript", { platform: "win32", env: { PATH: "", ProgramFiles: programFiles } })).toBeUndefined();
  });
});
