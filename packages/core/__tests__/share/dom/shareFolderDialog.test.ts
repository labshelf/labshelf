/** @jest-environment jsdom */
import { runShareFolderDialog } from "../../../src/share/dom/index.js";
import { fakeHost } from "../../collab/dom/fakeHost";

describe("share folder dialog", () => {
  it("never shares a path that holds no papers", async () => {
    const host = fakeHost();
    await runShareFolderDialog(host, "empty");
    expect(host.shareFolder).not.toHaveBeenCalled();
  });
});
