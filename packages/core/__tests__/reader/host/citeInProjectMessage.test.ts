// Tests the reader host's answer to citeInProject: the host port when present, a notice when absent.
import { setupHost } from "./hostFixture";

describe("reader citeInProject message", () => {
  it("hands the request to the host port", async () => {
    const { host, ports } = setupHost();
    const citeInProject = jest.fn(async () => undefined);
    (ports as { citeInProject?: typeof citeInProject }).citeInProject = citeInProject;
    await host.handle({ command: "citeInProject", paperId: "p1", page: 4, quote: "A passage." });
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(citeInProject.mock.calls).toEqual([[{ paperId: "p1", page: 4, quote: "A passage." }], [{ paperId: "p1" }]]);
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("tells the user when the host cannot cite", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(ports.notify).toHaveBeenCalledWith("Cite in project is not available here", "info");
  });

  it("surfaces a failing port as a Reader action failed notice", async () => {
    const { host, ports } = setupHost();
    (ports as { citeInProject?: () => Promise<void> }).citeInProject = async () => { throw new Error("no project"); };
    await host.handle({ command: "citeInProject", paperId: "p1" });
    expect(ports.notify).toHaveBeenCalledWith("Reader action failed: no project", "error");
  });
});
