/** Verifies the checklist's sidebar tree. */
import { posixPathOps } from "../../../src/path/index";
import type { Checklist } from "../../../src/writing/checks/checklist";
import { deriveChecklistSidebarNodes } from "../../../src/writing/checks/checklistSidebar";

describe("deriveChecklistSidebarNodes", () => {
  const checklist: Checklist = {
    groups: [
      { id: "todo", title: "TODOs", open: 1, items: [{ kind: "todo", done: false, todo: { file: "main.tex", line: 4, text: "cite", section: undefined } as never }] },
      {
        id: "reading", title: "Reading", open: 0,
        items: [{ kind: "reading", done: true, paper: { key: "p1", title: "Done paper", status: "done", statusChangedAt: "2026-01-02T00:00:00Z" } }],
      },
    ],
  } as unknown as Checklist;

  describe("deriveChecklistSidebarNodes", () => {
    const tree = deriveChecklistSidebarNodes({
      paths: posixPathOps, checklist, grouping: "kind", pageCount: undefined, reading: new Map(), isExpanded: (_id, byDefault) => byDefault,
    });

    it("orders By kind groups and folds done reading papers into one row", () => {
      expect(tree.nodes.map((node) => node.label)).toEqual(["TODOs", "Reading"]);
      const folded = tree.nodes[1]!.children![0]!;
      expect(folded).toMatchObject({ label: "1 read", dim: true, open: false });
      expect(folded.children).toHaveLength(1);
    });

    it("records each group and item by its row key", () => {
      expect(tree.groups.get("kind:todo")).toBe("todo");
      expect([...tree.items.keys()]).toContain("kind:todo/todo:main.tex:4");
    });
  });
});
