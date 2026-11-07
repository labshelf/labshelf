/** @jest-environment jsdom */
import { createImageView } from "../../../src/qmd/dom/imageView.js";
import type { NoteFilesPort } from "../../../src/qmd/noteFiles.js";
import { qmdSchema } from "../../../src/qmd/editor/qmdSchema.js";

const make = (src: string, files?: NoteFilesPort) => {
  const node = qmdSchema.nodes["image"]!.create({ src, alt: "A graph" });
  return createImageView(files)(node, {} as never, () => 0, [], {} as never) as { dom: HTMLElement; destroy(): void };
};
const port = (read: NoteFilesPort["read"]): NoteFilesPort => ({ read, write: async () => undefined, pickTextFile: async () => null });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => jest.restoreAllMocks());

describe("image view", () => {
  it("uses an absolute src as is", () => {
    expect(make("https://x.org/a.png").dom.querySelector("img")?.getAttribute("src")).toBe("https://x.org/a.png");
  });
  it("reads a relative src into a blob URL and revokes it on destroy", async () => {
    URL.createObjectURL = jest.fn(() => "blob:x");
    URL.revokeObjectURL = jest.fn();
    const read = jest.fn(async () => new Uint8Array([1]));
    const view = make("assets/a.png", port(read));
    await flush();
    expect(read).toHaveBeenCalledWith("assets/a.png");
    expect(view.dom.querySelector("img")?.getAttribute("src")).toBe("blob:x");
    view.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
  it("shows the alt text with the path when there is no file", async () => {
    const view = make("assets/a.png", port(async () => null));
    await flush();
    expect(view.dom.querySelector("img")).toBeNull();
    expect(view.dom.textContent).toBe("A graph");
    expect(view.dom.querySelector("[title]")?.getAttribute("title")).toContain("assets/a.png");
    expect(make("assets/a.png").dom.textContent).toBe("A graph");
  });
});
