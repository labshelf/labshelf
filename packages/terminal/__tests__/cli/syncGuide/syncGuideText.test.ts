import { syncGuide } from "@labshelf/core";

import { syncGuideText } from "../../../src/cli/syncGuide/syncGuideText";

describe("syncGuideText", () => {
  const text = syncGuideText(syncGuide);

  it("names every tool, including the no-cloud one, with its official link", () => {
    for (const tool of [...syncGuide.tools, syncGuide.noCloud.tool]) {
      expect(text).toContain(tool.name);
      expect(text).toContain(tool.url);
    }
  });

  it("carries the title, the steps and the after-setup advice as plain text", () => {
    expect(text).toContain(syncGuide.title);
    expect(text).toContain(syncGuide.tools[0]!.steps[1]);
    expect(text).toContain(syncGuide.afterSetup.conflictNote);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\u001b/);
  });
});
