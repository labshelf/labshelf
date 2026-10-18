import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { fileUrisToPage, pageUrisToFiles, rootInitialize, UriRefusedError } from "../../../../../src/writing/helper/node/lsp/uriMapping.js";

const root = path.join(path.sep, "data", "projects", "p1", "src");
const fileUri = (relative: string) => pathToFileURL(path.join(root, relative)).href;

describe("page to file URIs", () => {
  it("maps a percent-encoded page URI to the working copy file, at any depth", () => {
    const mapped = pageUrisToFiles({ params: { list: [{ uri: "labshelf:/a%20b.typ" }, { uri: "labshelf:/dir/c.typ" }], n: 3 } }, root);
    expect(mapped).toEqual({ params: { list: [{ uri: fileUri("a b.typ") }, { uri: fileUri("dir/c.typ") }], n: 3 } });
    expect(fileUri("a b.typ")).toContain("a%20b.typ");
  });

  it("refuses parent-directory and absolute paths", () => {
    expect(() => pageUrisToFiles({ uri: "labshelf:/../x.typ" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/a/%2E%2E/%2E%2E/x.typ" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/%2Fetc%2Fpasswd" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/%E0%A4%A" }, root)).toThrow(UriRefusedError);
  });
});

describe("file to page URIs", () => {
  it("maps working copy files back, encoding each segment", () => {
    const { payload, outside } = fileUrisToPage({ result: [{ uri: fileUri("a b.typ") }, { uri: fileUri("d/é.typ") }] }, root);
    expect(payload).toEqual({ result: [{ uri: "labshelf:/a%20b.typ" }, { uri: "labshelf:/d/%C3%A9.typ" }] });
    expect(outside).toEqual([]);
  });

  it("nulls a URI outside the working copy and lists it", () => {
    const outsideUri = pathToFileURL(path.join(path.sep, "etc", "passwd")).href;
    const { payload, outside } = fileUrisToPage({ result: { uri: outsideUri, other: "text" } }, root);
    expect(payload).toEqual({ result: { uri: null, other: "text" } });
    expect(outside).toEqual([outsideUri]);
  });
});

describe("rootInitialize", () => {
  it("points rootUri and workspaceFolders at the working copy", () => {
    const out = rootInitialize({ method: "initialize", id: 1, params: { rootUri: "file:///home/x", rootPath: "/home/x", workspaceFolders: [{ uri: "file:///home/x", name: "x" }], capabilities: {} } }, root);
    const params = out.params as Record<string, unknown>;
    expect(params.rootUri).toBe(fileUri(""));
    expect(params.workspaceFolders).toEqual([{ uri: fileUri(""), name: "project" }]);
    expect(params.rootPath).toBeUndefined();
    expect(params.capabilities).toEqual({});
  });

  it("leaves other messages untouched", () => {
    const message = { method: "textDocument/didOpen", params: { rootUri: "x" } };
    expect(rootInitialize(message, root)).toBe(message);
  });
});
