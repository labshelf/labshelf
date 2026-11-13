// Contract of the pix2tex pin and its requirement files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pix2texPlatform, type Pix2texPin } from "../../../src/equations/pix2texPin.js";
import { ALL_PLATFORMS, names } from "./installPix2texHarness.js";

const REAL_PIN = (jest.requireActual("../../../src/equations/pix2texPin.js") as { PIX2TEX_PIN: Pix2texPin }).PIX2TEX_PIN;

// ---- 4.1b: the pin and its requirement files ---------------------------------------------------

const REQUIREMENTS_DIR = resolve(__dirname, "../../../src/equations/node/pix2tex-requirements");

/** Logical requirement lines: continuations joined, blanks, comments and option lines dropped. */
function requirementLines(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, " ");
  return joined.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("-"));
}

describe("pix2tex pin", () => {
  it("4.1b has a version", () => {
    expect(REAL_PIN.version).toMatch(/^\d+\.\d+/);
  });

  it("4.1b lists every supported platform, each with a requirements entry or null", () => {
    expect(Object.keys(REAL_PIN.platforms).sort()).toEqual([...ALL_PLATFORMS].sort());
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(typeof entry.requirements).toBe("string");
        expect(entry.requirements.length).toBeGreaterThan(0);
      }
    }
  });

  it("4.1b supports at least one platform", () => {
    expect(ALL_PLATFORMS.some((platform) => REAL_PIN.platforms[platform] !== null)).toBe(true);
  });

  it("4.1b gives every supported platform a positive download size in MB", () => {
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(Number.isFinite(entry.downloadMb)).toBe(true);
        expect(entry.downloadMb).toBeGreaterThan(0);
      }
    }
  });

  it("4.1b has a <platform>.txt requirements file for every supported platform", () => {
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(basename(entry.requirements)).toBe(`${platform}.txt`);
        expect(existsSync(join(REQUIREMENTS_DIR, `${platform}.txt`))).toBe(true);
      }
    }
  });

  it("4.1b pins every requirement with == and a sha256 hash, and lists at least one requirement", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) { continue; }
      const lines = requirementLines(readFileSync(join(REQUIREMENTS_DIR, `${platform}.txt`), "utf8"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/==/);
        expect(line).toMatch(/--hash=sha256:[0-9a-f]{64}/);
      }
    }
  });

  it("4.1b has a 64-hex sha256 after every --hash=sha256 in every requirements file", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) { continue; }
      const text = readFileSync(join(REQUIREMENTS_DIR, `${platform}.txt`), "utf8");
      const hashes = text.match(/--hash=\S+/g) ?? [];
      expect(hashes.length).toBeGreaterThan(0);
      for (const hash of hashes) { expect(hash).toMatch(/^--hash=sha256:[0-9a-f]{64}$/); }
    }
  });

  it("4.1b has no requirements file for a platform that the pin marks null", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) {
        expect(existsSync(join(REQUIREMENTS_DIR, `${platform}.txt`))).toBe(false);
      }
    }
  });

  it("4.1b lists weights, each with a file, an https url and a 64-hex sha256", () => {
    expect(REAL_PIN.weights.length).toBeGreaterThan(0);
    for (const weight of REAL_PIN.weights) {
      expect(weight.file.length).toBeGreaterThan(0);
      expect(weight.url).toMatch(/^https:\/\//);
      expect(weight.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("4.1b maps node platform and architecture to a pin platform", () => {
    expect(pix2texPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(pix2texPlatform("darwin", "x64")).toBe("darwin-x64");
    expect(pix2texPlatform("win32", "x64")).toBe("win32-x64");
    expect(pix2texPlatform("linux", "x64")).toBe("linux-x64");
    expect(pix2texPlatform("linux", "arm64")).toBe("linux-arm64");
  });

  it("4.1b maps an unknown platform or architecture to undefined", () => {
    expect(pix2texPlatform("win32", "arm64")).toBeUndefined();
    expect(pix2texPlatform("freebsd", "x64")).toBeUndefined();
    expect(pix2texPlatform("linux", "ia32")).toBeUndefined();
  });

  it("4.1b has a contract section managed-tools#pix2tex that names the pin version, every supported platform and every weight file", () => {
    const repo = resolve(__dirname, "../../../../..");
    const section = execFileSync("node", ["scripts/docs/doc.mjs", "contracts/managed-tools#pix2tex"], { cwd: repo, encoding: "utf8" });
    expect(section).toContain(REAL_PIN.version);
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] !== null) { expect(section).toContain(platform); }
    }
    for (const weight of REAL_PIN.weights) { expect(section).toContain(weight.file); }
  });
});
