// Tests the host side of the preview's body page report: the port gets the count, and a host without the port ignores it.
import { setupHost } from "./hostFixture";

describe("bodyPages message", () => {
  it("hands the root and its content pages to the preview port", async () => {
    const { host, ports } = setupHost();
    const preview = { bodyPages: jest.fn() };
    Object.assign(ports, { preview });
    await host.handle({ command: "bodyPages", root: "/p/main.tex", contentPages: 7 } as never);
    expect(preview.bodyPages).toHaveBeenCalledWith("/p/main.tex", 7);
  });

  it("does not throw when the preview port has no bodyPages", async () => {
    const { host, ports } = setupHost();
    Object.assign(ports, { preview: { showSource: jest.fn() } });
    await expect(host.handle({ command: "bodyPages", root: "/p/main.tex", contentPages: 7 } as never)).resolves.toBeUndefined();
  });
});
