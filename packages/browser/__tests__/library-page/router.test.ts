import type { HostEndpoint } from "@labshelf/core";
import { attachRouter, folderFromHash, hashForFolder } from "../../src/library-page/router";

describe("router hash <-> folder", () => {
  it("round-trips folders, encoding each segment", () => {
    for (const f of ["papers", "papers/A", "papers/Reading group/Refs & notes"]) {
      expect(folderFromHash(hashForFolder(f))).toBe(f);
    }
    expect(hashForFolder("papers/Reading group")).toBe("#/papers/Reading%20group");
  });
  it("falls back to the root for empty, foreign or traversal hashes", () => {
    for (const h of ["", "#", "#/", "#/elsewhere", "#/papers-old/x", "#/papers/../x", "#/papers//x", "#/papers/./x", "#/papers/a%5Cb"]) {
      expect(folderFromHash(h)).toBe("papers");
    }
  });
  it("tolerates a trailing slash", () => {
    expect(folderFromHash("#/papers/A/")).toBe("papers/A");
  });
});

describe("router hashchange", () => {
  function attach(hash: string) {
    const listeners: Array<() => void> = [];
    const post = jest.fn();
    Object.assign(globalThis, { location: { hash }, window: { addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: jest.fn() } });
    attachRouter({ post, subscribe: () => () => undefined } as unknown as HostEndpoint);
    return { post, fire: () => listeners.forEach((fn) => fn()) };
  }

  it("posts the folder of a folder hash and skips tabs and join hashes", () => {
    const folder = attach("#/papers/A");
    folder.fire();
    expect(folder.post).toHaveBeenCalledWith({ type: "navigate", folder: "papers/A" });
    for (const hash of ["#/tabs/library", "#/join/invite"]) {
      const other = attach(hash);
      other.fire();
      expect(other.post).not.toHaveBeenCalled();
    }
  });
});
