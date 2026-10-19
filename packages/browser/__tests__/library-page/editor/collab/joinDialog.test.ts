/**
 * @jest-environment node
 */
// The join dialog asks for the invite and a name, joins, opens the project and tells the user when it fails.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));
const inputBox = jest.fn();
const toast = jest.fn();
jest.mock("@labshelf/core/dom", () => ({ inputBox: (...args: unknown[]) => inputBox(...args), toast: (...args: unknown[]) => toast(...args) }));
const findProject = jest.fn();
jest.mock("../../../../src/library-page/projects-data/findProject", () => ({ findProject: (...args: unknown[]) => findProject(...args) }));

import type { ILogger, ProjectEntry } from "@labshelf/core";
import { runJoinDialog, saveDisplayName, UnknownShareKindError } from "../../../../src/library-page/editor/collab";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const entry = { kind: "ready", folder: "projects/draft", settings: { id: "draft" } } as unknown as ProjectEntry;

function setup(join: jest.Mock = jest.fn(async () => ({ projectId: "draft", folder: "projects/draft" }))) {
  const shares = { join, setName: jest.fn(async () => undefined), name: () => "Guest" };
  const session = { current: jest.fn(() => undefined), openProject: jest.fn(async () => true) };
  return { shares, session, run: (invite?: string) => runJoinDialog({ shares, fs: memoryLibraryFs(), logger, session, ...(invite === undefined ? {} : { invite }) }) };
}

beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  inputBox.mockReset();
  toast.mockReset();
  findProject.mockReset().mockResolvedValue(entry);
});

describe("runJoinDialog", () => {
  it("asks for the invite, then the name prefilled with the saved one, joins and opens the project", async () => {
    await saveDisplayName("Ada");
    inputBox.mockResolvedValueOnce("labshelf-invite").mockResolvedValueOnce("Ada L");
    const { shares, session, run } = setup();
    await run();
    expect(inputBox.mock.calls[1][0]).toMatchObject({ value: "Ada" });
    expect(shares.setName).toHaveBeenCalledWith("Ada L");
    expect(shares.join).toHaveBeenCalledWith("labshelf-invite");
    expect(session.openProject).toHaveBeenCalledWith(entry);
    expect(toast).not.toHaveBeenCalled();
  });

  it("skips the invite question when the page was opened with an invite", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    const { shares, run } = setup();
    await run("from-link");
    expect(inputBox).toHaveBeenCalledTimes(1);
    expect(shares.join).toHaveBeenCalledWith("from-link");
  });

  it("does nothing when the user cancels either question", async () => {
    inputBox.mockResolvedValueOnce(undefined);
    const first = setup();
    await first.run();
    inputBox.mockResolvedValueOnce("invite").mockResolvedValueOnce(undefined);
    const second = setup();
    await second.run();
    expect(first.shares.join).not.toHaveBeenCalled();
    expect(second.shares.join).not.toHaveBeenCalled();
  });

  it("toasts the failure and opens nothing", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    const { session, run } = setup(jest.fn(async () => { throw new Error("No member answered"); }));
    await run("invite");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("No member answered"), "error");
    expect(session.openProject).not.toHaveBeenCalled();
  });

  it("explains an invite for a kind of share this version cannot open", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    const { run } = setup(jest.fn(async () => { throw new UnknownShareKindError("notebook"); }));
    await run("invite");
    expect(toast).toHaveBeenCalledWith("This invite is for something LabShelf cannot open yet.", "error");
  });
});
