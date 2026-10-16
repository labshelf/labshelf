// Tests a version row's label, date, context value and open command for a present and a missing PDF.
import type { ProjectVersion } from "@labshelf/core";
import type { ReadyProject } from "../../../src/writing/figures";
import type { VersionRow } from "../../../src/writing/versions/projectVersionsView";
import { versionTreeItem } from "../../../src/writing/versions/versionTreeItem";
import { readyEntry } from "../../support/writingFixtures";

const project = readyEntry("/code/paper") as ReadyProject;

function row(slug: string, hasPdf: boolean, folderProject = project): VersionRow {
  const version: ProjectVersion = { slug, name: `Name ${slug}`, created: "2026-02-01T10:00:00Z", pdfPath: `/p/${slug}.pdf`, sourcesDir: `/p/${slug}/sources` };
  return { project: folderProject, version, hasPdf };
}

describe("versionTreeItem", () => {
  it("shows the name, the date and an open command when the PDF exists", () => {
    const value = row("submitted", true);
    const item = versionTreeItem(value);
    expect(item.label).toBe("Name submitted");
    expect(typeof item.description).toBe("string");
    expect(item.description).not.toBe("");
    expect(item.description).not.toBe("PDF missing");
    expect(item.contextValue).toBe("labshelfVersion");
    expect(item.command).toEqual({ command: "labshelf.writing.openVersion", title: expect.any(String), arguments: [value] });
  });

  it("says the PDF is missing and has no command when it does not exist", () => {
    const item = versionTreeItem(row("submitted", false));
    expect(item.label).toBe("Name submitted");
    expect(item.description).toBe("PDF missing");
    expect(item.contextValue).toBe("labshelfVersionMissing");
    expect(item.command).toBeUndefined();
  });

  it("gives each version of each project a unique id", () => {
    const other = readyEntry("/code/other") as ReadyProject;
    const ids = [row("a", true), row("b", true), row("a", true, other)].map((value) => versionTreeItem(value).id);
    expect(new Set(ids).size).toBe(3);
  });
});
