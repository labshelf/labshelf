/**
 * @jest-environment jsdom
 */
// Tests that the project menu offers sharing only with a sharing host and for a normal, working row.
import { fakeHost } from "../../../collab/dom/fakeHost";
import { createProjectMenuEntries } from "../../../../src/writing/allProjects/dom/projectMenu";
import type { ProjectRow } from "../../../../src/writing/allProjects";

const row = (extra: Partial<ProjectRow> = {}): ProjectRow => ({ id: "p1", title: "Thesis", place: "projects", ...extra } as ProjectRow);
const labels = (r: ProjectRow, sharing?: ReturnType<typeof fakeHost>): string[] =>
  createProjectMenuEntries(r, { rows: [r], commands: [], post: jest.fn(), sharing }).flatMap((e) => (e === "separator" ? [] : [e.label]));

describe("project menu sharing", () => {
  it("adds sharing entries before Archive only with a sharing host", () => {
    const without = labels(row());
    const withHost = labels(row(), fakeHost());
    expect(withHost.length).toBeGreaterThan(without.length);
    expect(withHost.indexOf("Archive")).toBeGreaterThan(without.indexOf("Duplicate…") + 1);
  });

  it("adds none for broken, archived or trashed rows", () => {
    for (const r of [row({ broken: "missing" }), row({ place: "archived" }), row({ place: "trash" })]) {
      expect(labels(r, fakeHost())).toEqual(labels(r));
    }
  });
});
