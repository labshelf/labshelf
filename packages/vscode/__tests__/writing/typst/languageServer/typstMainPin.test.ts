// Tests pinning the project's main file in the language server, only when it changes.
import * as path from "node:path";

import { registerTypstMainPin } from "../../../../src/writing/typst/languageServer/typstMainPin";
import { fakeHost, fakeLogger, openInEditor, readyEntry } from "../../../support/writingFixtures";

type Entry = ReturnType<typeof readyEntry>;
const typstProject = (main = "main.typ"): Entry => readyEntry("/code/repo", { settings: { id: "repo", format: "typst" }, main });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const registered: { subscriptions: { dispose: () => void }[] }[] = [];

function setup(initial: Entry[], client: { sendRequest: jest.Mock } | undefined = { sendRequest: jest.fn(async () => undefined) }) {
  let entries = initial;
  const listeners: (() => void)[] = [];
  const context = { subscriptions: [] as { dispose: () => void }[] };
  const logger = fakeLogger();
  const projects = {
    list: () => entries, paths: path,
    onDidChange: (handler: () => void) => { listeners.push(handler); return { dispose: () => {} }; },
  };
  const server = { start: jest.fn(async () => client) };
  registerTypstMainPin({ context: context as never, server: server as never, host: fakeHost(logger), projects: projects as never });
  registered.push(context);
  return { client, server, logger, setEntries: (next: Entry[]) => { entries = next; listeners.forEach((l) => l()); } };
}

beforeEach(() => { jest.clearAllMocks(); openInEditor("/elsewhere/a.typ"); });
afterEach(() => { registered.splice(0).forEach((context) => context.subscriptions.forEach((subscription) => subscription.dispose())); });

describe("main pin", () => {
  it("pins the project's main file when the editor moves into the project", async () => {
    const { client } = setup([typstProject("src/thesis.typ")]);
    openInEditor("/code/repo/src/chapter.typ");
    await flush();
    expect(client!.sendRequest).toHaveBeenCalledWith("workspace/executeCommand", { command: "tinymist.pinMain", arguments: ["/code/repo/src/thesis.typ"] });
  });

  it("pins again only when the main file changes", async () => {
    const { client, setEntries } = setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    openInEditor("/code/repo/other.typ");
    await flush();
    expect(client!.sendRequest).toHaveBeenCalledTimes(1);
    setEntries([typstProject("paper.typ")]);
    await flush();
    expect(client!.sendRequest).toHaveBeenCalledTimes(2);
    expect(client!.sendRequest).toHaveBeenLastCalledWith("workspace/executeCommand", { command: "tinymist.pinMain", arguments: ["/code/repo/paper.typ"] });
  });

  it("does not pin without a running server", async () => {
    const { logger } = setup([typstProject()], undefined);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not start the server for LaTeX projects or projects without a main file", async () => {
    const latex = setup([readyEntry("/code/repo", { settings: { id: "repo", format: "latex" } })]);
    openInEditor("/code/repo/main.tex");
    await flush();
    const noMain = setup([readyEntry("/code/repo", { settings: { id: "repo", format: "typst" }, main: undefined })]);
    openInEditor("/code/repo/x.typ");
    await flush();
    expect(latex.server.start).not.toHaveBeenCalled();
    expect(noMain.server.start).not.toHaveBeenCalled();
  });

  it("logs a failed pin and retries on the next change", async () => {
    const client = { sendRequest: jest.fn().mockRejectedValueOnce(new Error("server not ready")).mockResolvedValue(undefined) };
    const { logger } = setup([typstProject()], client);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.objectContaining({ main: "/code/repo/main.typ" }));
    openInEditor("/code/repo/other.typ");
    await flush();
    expect(client.sendRequest).toHaveBeenCalledTimes(2);
  });
});
