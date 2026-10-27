import { syncGuide } from "../../../src/library/conflicts/syncGuide.js";

describe("syncGuide", () => {
  const tools = [...syncGuide.tools, syncGuide.noCloud.tool];

  it("gives every tool three steps, an https url and a platform", () => {
    for (const tool of tools) {
      expect(tool.steps).toHaveLength(3);
      tool.steps.forEach((step) => expect(step.trim()).not.toBe(""));
      expect(tool.url).toMatch(/^https:\/\//);
      expect(tool.platforms.length).toBeGreaterThan(0);
    }
  });

  it("uses each tool id once", () => {
    const ids = tools.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists no Linux client for Google Drive and iCloud Drive", () => {
    for (const id of ["google-drive", "icloud-drive"]) {
      expect(tools.find((tool) => tool.id === id)?.platforms).not.toContain("Linux");
    }
  });
});
