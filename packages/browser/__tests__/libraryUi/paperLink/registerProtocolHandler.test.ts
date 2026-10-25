import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ILogger } from "@labshelf/core";
import { registerLinkHandler } from "../../../src/libraryUi/paperLink/registerProtocolHandler";

const url = "chrome-extension://abc/libraryPage/index.html?link=%s";

function setup(declaredInManifest: boolean, register = jest.fn()) {
  const log = { log: jest.fn() } as unknown as ILogger;
  registerLinkHandler({ declaredInManifest, handlerUrl: url, register, log });
  return { register, log };
}

describe("registerLinkHandler", () => {
  it("registers the page for web+labshelf when the manifest does not declare it", () => {
    expect(setup(false).register).toHaveBeenCalledWith("web+labshelf", url);
  });
  it("leaves registration to the manifest when it declares the handler", () => {
    expect(setup(true).register).not.toHaveBeenCalled();
  });
  it("logs a refusal with its context and does not throw", () => {
    const { log } = setup(false, jest.fn(() => { throw new DOMException("denied", "SecurityError"); }));
    expect(log.log).toHaveBeenCalledWith("WARN", "library-link", expect.any(String), expect.objectContaining({ url, error: "SecurityError: denied" }));
  });
});

describe("manifests", () => {
  const read = (name: string) => JSON.parse(readFileSync(join(__dirname, "../../..", name), "utf8")) as Record<string, unknown>;
  it("Firefox declares the web+labshelf handler on the library page", () => {
    expect(read("manifest.firefox.json").protocol_handlers).toEqual([
      { protocol: "web+labshelf", name: "LabShelf", uriTemplate: "/libraryPage/index.html?link=%s" },
    ]);
  });
  it("Chrome has no manifest key for it, so the page registers itself", () => {
    expect(read("manifest.chrome.json").protocol_handlers).toBeUndefined();
  });
});
