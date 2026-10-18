/** Verifies rewriting the settings of a project folder keeps every field and comment that is not patched. */
import { updateProjectSettings } from "@labshelf/core";

import { memoryCatalog, readText, writeTree } from "../../../support/memoryProjectCatalog";

const DIR = "/lib/projects/a";

describe("updateProjectSettings", () => {
  it("patches main and keeps comments", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, DIR, { "labshelf.yaml": "# mine\nid: a\nformat: latex\n" });
    await updateProjectSettings(context, DIR, { main: "paper.tex" });
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe("# mine\nid: a\nformat: latex\nmain: paper.tex\n");
  });

  it("keeps every field it does not patch, unknown keys included", async () => {
    const context = memoryCatalog();
    const text = "id: a\nformat: latex\nmain: old.tex\nengine: xelatex\nextra: 1\n";
    await writeTree(context.fs, DIR, { "labshelf.yaml": text });
    await updateProjectSettings(context, DIR, { main: "paper.tex" });
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe("id: a\nformat: latex\nmain: paper.tex\nengine: xelatex\nextra: 1\n");
  });

  it("rejects and leaves the file unchanged when the yaml is invalid", async () => {
    const context = memoryCatalog();
    const text = "id: a\nformat: nope\n";
    await writeTree(context.fs, DIR, { "labshelf.yaml": text });
    await expect(updateProjectSettings(context, DIR, { main: "x.tex" })).rejects.toThrow(/format must be/);
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe(text);
  });
});
