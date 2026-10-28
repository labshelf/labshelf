// Pins how the Publish form becomes a template manifest: validation of the untrusted draft and the author swap at submit.
import { parseTemplateManifest, serializeTemplateManifest, type PublishDraft } from "../../../src/index";
import { createPublishTemplateManifest, withAuthors } from "../../../src/templates/index.js";
import type { PublishableProject } from "../../../src/templates/index.js";

const project: PublishableProject = {
  id: "thesis", title: "My thesis", folder: "/lib/projects/thesis", engineLabel: "pdfLaTeX",
  format: "latex", engine: "pdflatex", main: "main.tex",
};
const draft: PublishDraft = { name: "Deep Nets: a Survey", category: "thesis", license: "MIT", description: "A thesis." };

describe("createPublishTemplateManifest", () => {
  it("derives the id from the name and takes format, engine and main from the project", () => {
    const result = createPublishTemplateManifest(draft, project);
    expect(result).toEqual({
      ok: true,
      manifest: {
        id: "deep-nets-a-survey", name: "Deep Nets: a Survey", description: "A thesis.", category: "thesis",
        format: "latex", engine: "pdflatex", main: "main.tex", license: "MIT", authors: ["unsigned"],
      },
    });
  });

  it("cuts the id at 60 characters without a trailing dash", () => {
    const name = `${"a".repeat(59)} b`;
    const result = createPublishTemplateManifest({ ...draft, name }, project);
    expect(result.ok && result.manifest.id).toBe("a".repeat(59));
  });

  it("rejects a category outside the catalog's list", () => {
    const result = createPublishTemplateManifest({ ...draft, category: "memo" }, project);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Category must be one of") });
  });

  it("rejects an empty or over-long name and an over-long description", () => {
    expect(createPublishTemplateManifest({ ...draft, name: "  " }, project).ok).toBe(false);
    expect(createPublishTemplateManifest({ ...draft, name: "x".repeat(81) }, project).ok).toBe(false);
    expect(createPublishTemplateManifest({ ...draft, description: "x".repeat(501) }, project).ok).toBe(false);
  });
});

describe("withAuthors", () => {
  it("swaps template.yaml for a copy that lists the login and leaves other files alone", () => {
    const built = createPublishTemplateManifest(draft, project);
    if (!built.ok) { throw new Error("manifest expected"); }
    const other = { path: "files/main.tex", bytes: Uint8Array.from([1]) };
    const files = [{ path: "template.yaml", bytes: new TextEncoder().encode(serializeTemplateManifest(built.manifest)) }, other];
    const swapped = withAuthors(files, built.manifest, "octocat");
    expect(swapped[1]).toBe(other);
    const parsed = parseTemplateManifest(new TextDecoder().decode(swapped[0]?.bytes));
    expect(parsed).toEqual({ ok: true, manifest: { ...built.manifest, authors: ["octocat"] } });
  });
});
