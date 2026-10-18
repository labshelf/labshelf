import { webviewResource } from "../../../src/editor/webview/webviewResource";

const EXTENSIONS = "chrome-extension://abc/editor/extensions/";

describe("webviewResource", () => {
  it("maps an extension file to its copy next to the editor page", () => {
    expect(webviewResource("https://extension-file+labshelf-2Elabshelf.vscode-resource.vscode-cdn.net/labshelf/dist/reader/reader.js?v=1", EXTENSIONS))
      .toEqual({ kind: "page", url: "chrome-extension://abc/editor/extensions/labshelf/dist/reader/reader.js?v=1" });
  });

  it("asks the host for any other webview resource, split as VS Code's service worker splits it", () => {
    expect(webviewResource("https://file+.vscode-resource.vscode-cdn.net/library/projects/cv/main%20one.pdf?x=2", EXTENSIONS))
      .toEqual({ kind: "host", request: { scheme: "file", authority: "", path: "/library/projects/cv/main%20one.pdf", query: "x=2" } });
  });

  it("leaves URLs that are not webview resources alone", () => {
    expect(webviewResource("chrome-extension://abc/editor/extensions/labshelf/dist/a.js", EXTENSIONS)).toBeUndefined();
    expect(webviewResource("not a url", EXTENSIONS)).toBeUndefined();
  });
});
