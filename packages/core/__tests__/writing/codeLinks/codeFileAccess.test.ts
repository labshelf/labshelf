// Tests which files a listing may read: inside a workspace folder, or picked by the user, never any other outside path; and the path a picked file is written with.
import path from "node:path";
import { posixPathOps } from "../../../src/path/index";
import { deriveCodeLinkPath, resolveCodeLinkFile, type CodeFileAccess } from "../../../src/writing/codeLinks/index";

const PROJECT = "/home/ana/work/thesis/paper";
const ACCESS: CodeFileAccess = { workspaceFolders: ["/home/ana/work/thesis"], picked: ["/home/ana/somewhere/model.py"] };

describe("resolveCodeLinkFile", () => {
  it("reads a file inside a workspace folder, even above the project folder", () => {
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "code/fit.py", ACCESS)).toBe("/home/ana/work/thesis/paper/code/fit.py");
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "../analysis/fit.py", ACCESS)).toBe("/home/ana/work/thesis/analysis/fit.py");
  });

  it("reads a picked file outside the workspace", () => {
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "../../../somewhere/model.py", ACCESS)).toBe("/home/ana/somewhere/model.py");
  });

  it("refuses an outside path the user never picked, and absolute or backslashed paths", () => {
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "../../../.ssh/config.py", ACCESS)).toBeUndefined();
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "../../../somewhere/other.py", ACCESS)).toBeUndefined();
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "/home/ana/somewhere/model.py", ACCESS)).toBeUndefined();
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "..\\analysis\\fit.py", ACCESS)).toBeUndefined();
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "c:/code/fit.py", ACCESS)).toBeUndefined();
  });

  it("refuses everything outside without workspace folders or picks", () => {
    expect(resolveCodeLinkFile(posixPathOps, PROJECT, "code/fit.py", { workspaceFolders: [], picked: [] })).toBeUndefined();
  });
});

describe("deriveCodeLinkPath", () => {
  it("writes a picked file relative to the project folder, climbing with ../", () => {
    expect(deriveCodeLinkPath(posixPathOps, PROJECT, "/home/ana/somewhere/model.py")).toBe("../../../somewhere/model.py");
    expect(deriveCodeLinkPath(path.win32, "C:\\work\\paper", "C:\\code\\fit.py")).toBe("../../code/fit.py");
  });

  it("refuses a file on another drive", () => {
    expect(deriveCodeLinkPath(path.win32, "C:\\work\\paper", "D:\\code\\fit.py")).toBeUndefined();
    expect(deriveCodeLinkPath(posixPathOps, "/c:/work/paper", "/d:/code/fit.py")).toBeUndefined();
  });
});
