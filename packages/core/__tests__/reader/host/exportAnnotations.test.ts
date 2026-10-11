import { exportAnnotations } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

describe("exportAnnotations", () => {
  it("copies the Markdown to the clipboard and confirms", async () => {
    const { ports } = setupHost({ seed: sidecar });
    await exportAnnotations(ports, "clipboard");
    const markdown = ports.writeClipboard.mock.calls[0]![0];
    expect(markdown).toContain("# Efficient Algorithms");
    expect(markdown.indexOf("## Page 1")).toBeLessThan(markdown.indexOf("## Page 2"));
    expect(ports.notify).toHaveBeenCalledWith("Annotations copied as Markdown", "ok");
    expect(ports.saveAnnotations).not.toHaveBeenCalled();
  });

  it("hands the Markdown to the host's save for a file export, without touching the clipboard", async () => {
    const { ports } = setupHost({ seed: sidecar });
    await exportAnnotations(ports, "file");
    expect(ports.saveAnnotations).toHaveBeenCalledWith(expect.stringContaining("> h"));
    expect(ports.writeClipboard).not.toHaveBeenCalled();
    expect(ports.notify).not.toHaveBeenCalled();
  });
});
