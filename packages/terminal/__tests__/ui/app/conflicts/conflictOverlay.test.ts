import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../../src/app/context";
import type { App } from "../../../../src/ui/app";
import {
  ATTENTION, eventually, exists, folderOf, idle, makeTmpRoot, openApp, paperDir, press, screenText, seedLibrary, typeText, writeFile,
} from "../../../fixtures/appHarness";

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;
let original: string;
let copy: string;

beforeEach(async () => {
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
  const dir = paperDir(root, folderOf(ATTENTION), ATTENTION);
  original = path.join(dir, "notes.txt");
  copy = path.join(dir, "notes (Ana's conflicted copy 2026-01-02).txt");
  await writeFile(original, "mine");
  await writeFile(copy, "other");
  await ctx.rescanConflicts();
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

function command(line: string): void {
  press(app, ":");
  typeText(app, line);
  press(app, "enter");
}

describe("conflicts overlay", () => {
  it("shows the status segment and lists the copy with its paper title", () => {
    expect(screenText(app)).toContain("1 conflict");
    command("conflicts");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText(app)).toContain("notes.txt");
  });

  it("applies the chosen resolution and clears the segment", async () => {
    command("conflicts");
    press(app, "enter");
    press(app, "enter");
    await eventually(async () => !(await exists(copy)), "copy deleted", app);
    await eventually(() => ctx.conflicts.copies.length === 0, "feed cleared", app);
    expect(await fs.readFile(original, "utf8")).toBe("mine");
    expect(screenText(app)).not.toContain("1 conflict");
  });

  it("says so when there is nothing to resolve", async () => {
    await fs.rm(copy);
    await ctx.rescanConflicts();
    command("conflicts");
    expect(app.overlay).toBeUndefined();
    expect(screenText(app)).toContain("No conflicts");
  });
});
