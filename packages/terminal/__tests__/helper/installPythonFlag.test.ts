// Tests for the helper's --install-python handler against a fake provider (no network).
import { runInstallPython } from "../../src/helper/installPythonFlag";

type Provider = Parameters<typeof runInstallPython>[0];
type Status = Awaited<ReturnType<Provider["install"]>>;

const INSTALLED = { state: "installed", version: "3.12.4", sympy: "1.13.0" } as Status;
const MISSING = { state: "missing" } as Status;

function fakeProvider(install: Provider["install"]): { provider: Provider; install: jest.Mock } {
  const fn = jest.fn(install);
  const provider = { status: async () => MISSING, install: fn } as unknown as Provider;
  return { provider, install: fn };
}

function collect(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message) => void lines.push(message) };
}

describe("runInstallPython", () => {
  it("11.7a returns 0 after a successful install", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { write } = collect();
    expect(await runInstallPython(provider, write)).toBe(0);
  });

  it("11.7a calls install exactly once", async () => {
    const { provider, install } = fakeProvider(async () => INSTALLED);
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("11.7a names the installed Python version on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("3.12.4"))).toBe(true);
  });

  it("11.7a does not write a failure line on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.startsWith("Python install failed:"))).toBe(false);
  });

  it("11.7a passes progress messages from install to write", async () => {
    const { provider } = fakeProvider(async (onProgress) => {
      onProgress?.("Downloading Python", 0.25);
      return INSTALLED;
    });
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("Downloading Python"))).toBe(true);
  });

  it("11.7a returns 1 and writes a failure line when install throws", async () => {
    const { provider } = fakeProvider(async () => {
      throw new Error("network down");
    });
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    const failure = lines.filter((line) => line.startsWith("Python install failed:"));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain("network down");
  });

  it("11.7a returns 1 and writes a failure line when install resolves missing", async () => {
    const { provider } = fakeProvider(async () => MISSING);
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    expect(lines.filter((line) => line.startsWith("Python install failed:"))).toHaveLength(1);
  });

  it("11.7a does not throw when install throws a non-Error value", async () => {
    const { provider } = fakeProvider(async () => {
      throw "boom";
    });
    const { lines, write } = collect();
    await expect(runInstallPython(provider, write)).resolves.toBe(1);
    expect(lines.some((line) => line.startsWith("Python install failed:") && line.includes("boom"))).toBe(true);
  });

  it("11.7a calls install once even when it fails", async () => {
    const { provider, install } = fakeProvider(async () => {
      throw new Error("x");
    });
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
