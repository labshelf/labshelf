// Tests for runDoctor's library/config/sync-lock checks.
import { promises as fs } from "node:fs";

import { runDoctor, type Output } from "../../src/cli";
import { createTempLibrary, makeTempDir, type PaperFixture } from "../fixtures/library";
import { CliSessionHarness, PAPERS } from "../fixtures/cliSession";

function capture(): { io: Output; text: () => string } {
  const lines: string[] = [];
  return { io: { out: (t) => lines.push(t), err: (t) => lines.push(t), columns: 100 }, text: () => lines.join("\n") };
}

let harness: CliSessionHarness;

beforeEach(async () => {
  harness = new CliSessionHarness();
  await harness.setup();
});

afterEach(async () => {
  await harness.teardown();
});

describe("runDoctor", () => {
  it("passes for a configured library and reports each check on its own line", async () => {
    const lib = await createTempLibrary(PAPERS as PaperFixture[]);
    const { io, text } = capture();
    expect(await runDoctor(lib.root, "flag", { version: 1, libraryRoot: lib.root }, io)).toBe(0);
    expect(text()).toMatch(/^ok {2}\s+node\s+v\d+/m);
    expect(text()).toMatch(new RegExp(`^ok {2}\\s+library\\s+${lib.root.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\(from flag\\)$`, "m"));
    expect(text()).toContain("configured (test-client-");
    expect(text()).toMatch(/^warn\s+drive sign-in\s+signed out/m);
    expect(text()).toMatch(/^warn\s+last sync\s+never/m);
  });

  it("fails when no library is configured", async () => {
    const { io, text } = capture();
    expect(await runDoctor(undefined, "none", { version: 1 }, io)).toBe(1);
    expect(text()).toMatch(/^FAIL\s+library\s+not configured/m);
    expect(text()).toContain("no libraryRoot yet");
  });

  it("fails when the configured folder has no papers/ folder", async () => {
    const empty = await makeTempDir();
    const { io, text } = capture();
    expect(await runDoctor(empty, "env", { version: 1 }, io)).toBe(1);
    expect(text()).toMatch(/^FAIL\s+library/m);
  });

  it("warns about a held sync lock and shows the last sync", async () => {
    const lib = await createTempLibrary();
    await fs.writeFile(lib.paths.layout.lockPath(), JSON.stringify({ app: "vscode", pid: 1 }));
    await fs.writeFile(lib.paths.layout.lastRunPath(), JSON.stringify({ app: "vscode", finishedAt: new Date().toISOString() }));
    const { io, text } = capture();
    expect(await runDoctor(lib.root, "config", { version: 1 }, io)).toBe(0);
    expect(text()).toMatch(/^warn\s+sync lock\s+held: .*"app":"vscode"/m);
    expect(text()).toMatch(/^ok {2}\s+last sync\s+just now by vscode/m);
  });
});
