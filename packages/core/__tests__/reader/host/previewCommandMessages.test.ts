// Tests that the preview writing messages reach their optional preview ports and are ignored when a port is absent.
import { setupHost } from "./hostFixture";

const cases: Array<[string, Record<string, unknown>, unknown[]]> = [
  ["runCommand", { id: "markVersion" }, ["markVersion"]],
  ["setAutoCompile", { on: true }, [true]],
  ["setEngine", { engine: "xelatex" }, ["xelatex"]],
  ["setIncludeOnly", { on: false }, [false]],
  ["setCheckLimits", { limits: { pages: 8, words: null, countUpTo: "end" } }, [{ pages: 8, words: null, countUpTo: "end" }]],
  ["fixCitation", { fix: { kind: "replace", key: "a", replacement: "b", file: "m.tex", line: 2 } }, [{ kind: "replace", key: "a", replacement: "b", file: "m.tex", line: 2 }]],
  ["exportProject", { target: "arxivZip" }, ["arxivZip"]],
  ["openSourceLine", { file: "m.tex", line: 9 }, ["m.tex", 9]],
];

describe("preview command messages", () => {
  it.each(cases)("%s calls the port of the same name with its payload", async (command, payload, args) => {
    const { host, ports } = setupHost();
    const port = jest.fn(async () => undefined);
    Object.assign(ports, { preview: { [command]: port } });
    await host.handle({ command, ...payload } as never);
    expect(port).toHaveBeenCalledWith(...args);
  });

  it.each(cases)("%s is ignored when the port lacks the method", async (command, payload) => {
    const { host, ports } = setupHost();
    Object.assign(ports, { preview: { recompile: jest.fn() } });
    await expect(host.handle({ command, ...payload } as never)).resolves.not.toThrow();
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("openCitedPaper passes the page along, and nothing when none is given", async () => {
    const { host, ports } = setupHost();
    const openCitedPaper = jest.fn(async () => undefined);
    Object.assign(ports, { preview: { openCitedPaper } });
    await host.handle({ command: "openCitedPaper", paperId: "p", page: 4 } as never);
    expect(openCitedPaper).toHaveBeenLastCalledWith("p", 4);
    await host.handle({ command: "openCitedPaper", paperId: "p" } as never);
    expect(openCitedPaper).toHaveBeenLastCalledWith("p", undefined);
  });
});
