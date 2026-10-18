// Tests the Typst language server: it starts once on first use, installs when missing, and a failure is reported once and not retried.
import { languageServerRunning, setLanguageServerRunning } from "../../../../src/writing/typst/languageServerState";
import { TypstLanguageServer, type LanguageClientHandle } from "../../../../src/writing/typst/languageServer/typstLanguageServer";
import { fakeLogger } from "../../../support/writingFixtures";

function setup(over: { resolved?: string; ensure?: jest.Mock; start?: jest.Mock } = {}) {
  const client = { start: over.start ?? jest.fn(async () => {}), stop: jest.fn(async () => {}), sendRequest: jest.fn(async () => undefined) };
  const tinymist = {
    resolve: jest.fn(async () => over.resolved),
    ensure: over.ensure ?? jest.fn(async (onProgress?: (progress: { message: string }) => void) => { onProgress?.({ message: "Downloading" }); return "/tools/tinymist"; }),
  };
  const createClient = jest.fn(async (_path: string): Promise<LanguageClientHandle> => client);
  const showError = jest.fn();
  const withInstallProgress = jest.fn((task: (report: (message: string) => void) => Promise<string>) => task(() => {}));
  const logger = fakeLogger();
  const server = new TypstLanguageServer({ tinymist, createClient, withInstallProgress, showError, logger });
  return { server, client, tinymist, createClient, showError, withInstallProgress, logger };
}

beforeEach(() => { setLanguageServerRunning(false); });
afterEach(() => { jest.clearAllMocks(); setLanguageServerRunning(false); });

describe("TypstLanguageServer", () => {
  it("does nothing until started", () => {
    const { tinymist, createClient } = setup();
    expect(tinymist.resolve).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("installs the binary with progress, starts one client and logs it", async () => {
    const { server, client, tinymist, createClient, withInstallProgress, logger } = setup();
    await Promise.all([server.start(), server.start()]);
    await server.start();
    expect(withInstallProgress).toHaveBeenCalledTimes(1);
    expect(tinymist.ensure).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("/tools/tinymist");
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(languageServerRunning()).toBe(true);
    expect(logger.log).toHaveBeenCalledWith("INFO", "writing/typst", expect.any(String), expect.objectContaining({ serverPath: "/tools/tinymist" }));
  });

  it("skips the install and its progress when the binary resolves", async () => {
    const { server, tinymist, createClient, withInstallProgress } = setup({ resolved: "/usr/bin/tinymist" });
    await server.start();
    expect(tinymist.ensure).not.toHaveBeenCalled();
    expect(withInstallProgress).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledWith("/usr/bin/tinymist");
  });

  it("shows one error with the reason and does not retry after a failed install", async () => {
    const { server, createClient, showError, logger, tinymist } = setup({ ensure: jest.fn(async () => { throw new Error("offline"); }) });
    expect(await server.start()).toBeUndefined();
    expect(await server.start()).toBeUndefined();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("offline"));
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.anything());
    expect(tinymist.ensure).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(languageServerRunning()).toBe(false);
  });

  it("reports a client that fails to start the same way", async () => {
    const { server, showError } = setup({ start: jest.fn(async () => { throw new Error("spawn failed"); }) });
    await server.start();
    await server.start();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("spawn failed"));
    expect(languageServerRunning()).toBe(false);
  });

  it("stops the client once and marks the server as not running", async () => {
    const { server, client } = setup();
    await server.start();
    await server.stop();
    await server.stop();
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(languageServerRunning()).toBe(false);
  });
});
