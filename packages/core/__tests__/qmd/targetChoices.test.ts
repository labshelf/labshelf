import { deriveSendTargetChoices, type SendTarget, type SendTargetChoice } from "../../src/qmd/targetChoices";

const note = (projectId: string, path: string): SendTarget => ({ kind: "projectNote", projectId, path });

const projects = [
  { projectId: "p1", name: "Alpha", notes: [{ path: "notes/a.qmd", title: "Note A" }, { path: "notes/b.qmd", title: "Note B" }] },
  { projectId: "p2", name: "Beta", notes: [{ path: "notes/c.qmd", title: "Note C" }] },
];

describe("deriveSendTargetChoices", () => {
  it("9.11c lists live recent project notes first in recent order, then each project's other notes and a New note entry", () => {
    const choices: SendTargetChoice[] = deriveSendTargetChoices([note("p2", "notes/c.qmd"), note("p1", "notes/b.qmd")], projects);
    expect(choices).toEqual([
      { kind: "target", target: note("p2", "notes/c.qmd"), label: "Note C", description: "Beta", recent: true },
      { kind: "target", target: note("p1", "notes/b.qmd"), label: "Note B", description: "Alpha", recent: true },
      { kind: "target", target: note("p1", "notes/a.qmd"), label: "Note A", description: "Alpha", recent: false },
      { kind: "newNote", projectId: "p1", label: "New note…", description: "Alpha" },
      { kind: "newNote", projectId: "p2", label: "New note…", description: "Beta" },
    ]);
  });

  it("9.11c lists every note and a New note entry per project when nothing is recent", () => {
    expect(deriveSendTargetChoices([], projects)).toEqual([
      { kind: "target", target: note("p1", "notes/a.qmd"), label: "Note A", description: "Alpha", recent: false },
      { kind: "target", target: note("p1", "notes/b.qmd"), label: "Note B", description: "Alpha", recent: false },
      { kind: "newNote", projectId: "p1", label: "New note…", description: "Alpha" },
      { kind: "target", target: note("p2", "notes/c.qmd"), label: "Note C", description: "Beta", recent: false },
      { kind: "newNote", projectId: "p2", label: "New note…", description: "Beta" },
    ]);
  });

  it("9.11c drops recent targets whose note no longer exists", () => {
    const choices = deriveSendTargetChoices([note("p1", "notes/gone.qmd"), note("gone", "notes/a.qmd")], projects);
    expect(choices.filter((c) => c.kind === "target" && c.recent)).toEqual([]);
    expect(choices.filter((c) => c.kind === "target")).toHaveLength(3);
  });

  it("9.11c drops recent targets of other kinds", () => {
    const recent: SendTarget[] = [
      { kind: "spaceNote", spaceId: "s1", path: "notes/a.qmd" },
      { kind: "discussion", spaceId: "s1", path: "notes/b.qmd" },
    ];
    const choices = deriveSendTargetChoices(recent, projects);
    expect(choices.some((c) => c.kind === "target" && (c.recent || c.target.kind !== "projectNote"))).toBe(false);
    expect(choices).toHaveLength(5);
  });
});
