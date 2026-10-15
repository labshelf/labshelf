import { promises as fs } from "node:fs";
import * as os from "node:os";
import osModule from "node:os";
import * as path from "node:path";

import type { AppContext } from "../../../../src/app/context";
import { App } from "../../../../src/ui/app";
import { completePath } from "../../../../src/ui/app/input/promptCompletion";
import { idle, makeTmpRoot, openApp, press, screenText, seedLibrary, typeText } from "../../../fixtures/appHarness";

describe("completePath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-complete-"));
    for (const folder of ["alpha", "alps", "gamma", ".hidden"]) { await fs.mkdir(path.join(dir, folder)); }
    for (const file of ["beta.pdf", "Upper.PDF", "notes.txt", ".secret.pdf"]) { await fs.writeFile(path.join(dir, file), ""); }
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("completes the common prefix and lists the candidates when several match", async () => {
    expect(await completePath(`${dir}/al`)).toEqual({ completed: `${dir}/alp`, candidates: ["alpha/", "alps/"] });
  });

  it("completes a single folder with a trailing slash", async () => {
    expect(await completePath(`${dir}/gam`)).toEqual({ completed: `${dir}/gamma/`, candidates: [] });
  });

  it("completes a single PDF without a slash", async () => {
    expect(await completePath(`${dir}/be`)).toEqual({ completed: `${dir}/beta.pdf`, candidates: [] });
  });

  it("recognizes PDFs by extension regardless of case", async () => {
    expect(await completePath(`${dir}/Up`)).toEqual({ completed: `${dir}/Upper.PDF`, candidates: [] });
  });

  it("lists folders and PDFs only, without hidden entries, when the path ends with a slash", async () => {
    const result = await completePath(`${dir}/`);
    expect(result.candidates).toEqual(["alpha/", "alps/", "beta.pdf", "gamma/", "Upper.PDF"]);
    expect(result.completed).toBe(`${dir}/`);
  });

  it("shows hidden entries once the prefix starts with a dot", async () => {
    const result = await completePath(`${dir}/.`);
    expect(result.candidates).toEqual([".hidden/", ".secret.pdf"]);
    expect(result.completed).toBe(`${dir}/.`);
  });

  it("leaves the text alone when nothing matches", async () => {
    expect(await completePath(`${dir}/zzz`)).toEqual({ completed: `${dir}/zzz`, candidates: [] });
    expect(await completePath(`${dir}/not`)).toEqual({ completed: `${dir}/not`, candidates: [] });
  });

  it("leaves the text alone when the folder does not exist", async () => {
    expect(await completePath(`${dir}/missing/x`)).toEqual({ completed: `${dir}/missing/x`, candidates: [] });
  });

  it("completes inside a subfolder", async () => {
    await fs.mkdir(path.join(dir, "gamma", "delta"));
    expect(await completePath(`${dir}/gamma/de`)).toEqual({ completed: `${dir}/gamma/delta/`, candidates: [] });
  });

  it("expands ~ to the home folder but keeps it as typed", async () => {
    const homedir = jest.spyOn(osModule, "homedir").mockReturnValue(dir);
    try {
      expect(await completePath("~/al")).toEqual({ completed: "~/alp", candidates: ["alpha/", "alps/"] });
      expect(await completePath("~/gam")).toEqual({ completed: "~/gamma/", candidates: [] });
    } finally {
      homedir.mockRestore();
    }
  });
});

describe("App tags (t)", () => {
  let tmp: string;
  let root: string;
  let ctx: AppContext;
  let app: App;

  beforeEach(async () => {
    ({ tmp, root } = await makeTmpRoot());
    await seedLibrary(root);
    ({ ctx, app } = await openApp(root, tmp));
  });

  afterEach(async () => {
    await idle(app).catch(() => undefined);
    await ctx.dispose();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("completes an existing tag with Tab", () => {
    press(app, "t", "C-u");
    typeText(app, "tr");
    press(app, "tab");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("transformers, ");
    press(app, "esc");
  });

  it("lists the candidates when several tags start the same way", async () => {
    press(app, "j", "t");
    typeText(app, "n");
    press(app, "tab");
    expect(screenText(app)).toContain("nlp");
    press(app, "esc");
    await idle(app);
  });
});
