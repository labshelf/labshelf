import type { HostEndpoint } from "@labshelf/core";
import { attachHashHandlers } from "../../src/libraryUi/libraryPage";

describe("router hashchange", () => {
  function attach(hash: string, paperIdAtPath: (path: string) => Promise<string | null> = async () => null) {
    const listeners: Array<() => void> = [];
    const post = jest.fn();
    Object.assign(globalThis, { location: { hash }, window: { addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: jest.fn() } });
    attachHashHandlers({ post, subscribe: () => () => undefined } as unknown as HostEndpoint, paperIdAtPath);
    return { post, fire: async () => { listeners.forEach((fn) => fn()); await new Promise((r) => setTimeout(r, 0)); } };
  }

  it("posts the folder of a folder hash and skips tabs and join hashes", async () => {
    const folder = attach("#/papers/A");
    await folder.fire();
    expect(folder.post).toHaveBeenCalledWith({ type: "navigate", folder: "papers/A" });
    expect(folder.post).toHaveBeenCalledTimes(1);
    for (const hash of ["#/tabs/library", "#/join/invite"]) {
      const other = attach(hash);
      await other.fire();
      expect(other.post).not.toHaveBeenCalled();
    }
  });

  it("opens the folder of a paper path and selects the paper", async () => {
    const paper = attach("#/papers/ml/vaswani2017attention", async (path) => (path === "papers/ml/vaswani2017attention" ? "vaswani2017attention" : null));
    await paper.fire();
    expect(paper.post).toHaveBeenNthCalledWith(1, { type: "navigate", folder: "papers/ml" });
    expect(paper.post).toHaveBeenNthCalledWith(2, { type: "select", id: "vaswani2017attention" });
    expect(paper.post).toHaveBeenCalledTimes(2);
  });

  it("keeps an unknown last segment as a folder", async () => {
    const unknown = attach("#/papers/ml/nothing");
    await unknown.fire();
    expect(unknown.post).toHaveBeenCalledWith({ type: "navigate", folder: "papers/ml/nothing" });
    expect(unknown.post).toHaveBeenCalledTimes(1);
  });
});
