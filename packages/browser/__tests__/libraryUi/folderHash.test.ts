import type { HostEndpoint } from "@labshelf/core";
import { attachHashHandlers, parseFolderHash, createFolderHash } from "../../src/libraryUi/folderHash";

describe("router hash <-> folder", () => {
  it("round-trips folders, encoding each segment", () => {
    for (const f of ["papers", "papers/A", "papers/Reading group/Refs & notes"]) {
      expect(parseFolderHash(createFolderHash(f))).toBe(f);
    }
    expect(createFolderHash("papers/Reading group")).toBe("#/papers/Reading%20group");
  });
  it("falls back to the root for empty, foreign or traversal hashes", () => {
    for (const h of ["", "#", "#/", "#/elsewhere", "#/papers-old/x", "#/papers/../x", "#/papers//x", "#/papers/./x", "#/papers/a%5Cb"]) {
      expect(parseFolderHash(h)).toBe("papers");
    }
  });
  it("tolerates a trailing slash", () => {
    expect(parseFolderHash("#/papers/A/")).toBe("papers/A");
  });
});

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
