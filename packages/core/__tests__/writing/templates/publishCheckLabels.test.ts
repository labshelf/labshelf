// Pins the publish check ids and row labels, starting with the manifest check.
import { PUBLISH_CHECK_IDS, publishCheckLabel } from "../../../src/writing/templates/index";

describe("publish check labels", () => {
  it("lists the manifest check first", () => {
    expect(PUBLISH_CHECK_IDS[0]).toBe("manifest");
  });

  it("labels the manifest check", () => {
    expect(publishCheckLabel("manifest" as never, "pdfLaTeX")).toBe("Name and description set");
  });
});
