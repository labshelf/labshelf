/**
 * @jest-environment node
 */
// The join dialog asks for the invite and a name, joins, opens the project and tells the user when it fails.
const local: Record<string, unknown> = {};
jest.mock("../../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));
const inputBox = jest.fn();
const toast = jest.fn();
jest.mock("@labshelf/core/dom", () => ({ inputBox: (...args: unknown[]) => inputBox(...args), toast: (...args: unknown[]) => toast(...args) }));
const join = jest.fn();
jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), joinSharedProject: (...args: unknown[]) => join(...args) }));

import { UnknownShareKindError, type ILogger, type ProjectEntry } from "@labshelf/core";
import { runJoinDialog, saveDisplayName } from "../../../../../src/library-page/editor/collab";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const entry = { kind: "ready", folder: "projects/draft", settings: { id: "draft" } } as unknown as ProjectEntry;
const closing = new AbortController().signal;

function setup() {
  const sharing = {
    ports: { projects: { list: () => [entry] } } as never,
    shares: { setName: jest.fn(async () => undefined), name: () => "Guest" } as never,
    ready: jest.fn(async () => undefined), closing,
  };
  const session = { openProject: jest.fn(async () => true) };
  return { sharing, session, run: (invite?: string) => runJoinDialog({ sharing, logger, session, ...(invite === undefined ? {} : { invite }) }) };
}

const errorToasts = (): unknown[] => toast.mock.calls.filter((call) => call[1] === "error").map((call) => call[0]);

beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  inputBox.mockReset();
  toast.mockReset().mockImplementation(() => () => undefined);
  join.mockReset().mockResolvedValue({ kind: "joined", folder: "projects/draft" });
});

describe("runJoinDialog", () => {
  it("asks for the invite, then the name prefilled with the saved one, joins and opens the project", async () => {
    await saveDisplayName("Ada");
    inputBox.mockResolvedValueOnce("labshelf-invite").mockResolvedValueOnce("Ada L");
    const { sharing, session, run } = setup();
    await run();
    expect(inputBox.mock.calls[1][0]).toMatchObject({ value: "Ada" });
    expect((sharing.shares as { setName: jest.Mock }).setName).toHaveBeenCalledWith("Ada L");
    expect(sharing.ready).toHaveBeenCalled();
    expect(join).toHaveBeenCalledWith(sharing.ports, "labshelf-invite", closing);
    expect(session.openProject).toHaveBeenCalledWith(entry);
    expect(errorToasts()).toEqual([]);
  });

  it("skips the invite question when the page was opened with an invite", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    const { sharing, run } = setup();
    await run("from-link");
    expect(inputBox).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith(sharing.ports, "from-link", closing);
  });

  it("does nothing when the user cancels either question", async () => {
    inputBox.mockResolvedValueOnce(undefined);
    await setup().run();
    inputBox.mockResolvedValueOnce("invite").mockResolvedValueOnce(undefined);
    await setup().run();
    expect(join).not.toHaveBeenCalled();
  });

  it("toasts the failure and opens nothing", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    join.mockRejectedValue(new Error("No member answered"));
    const { session, run } = setup();
    await run("invite");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("No member answered"), "error");
    expect(session.openProject).not.toHaveBeenCalled();
  });

  it("shows the problem of an invite the workflow refuses and opens nothing", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    join.mockResolvedValue({ kind: "refused", problem: "This invite link is damaged. Ask for a new one." });
    const { session, run } = setup();
    await run("invite");
    expect(errorToasts()).toEqual(["This invite link is damaged. Ask for a new one."]);
    expect(session.openProject).not.toHaveBeenCalled();
  });

  it("explains an invite for a kind of share this version cannot open", async () => {
    inputBox.mockResolvedValueOnce("Ada");
    join.mockRejectedValue(new UnknownShareKindError("notebook"));
    const { run } = setup();
    await run("invite");
    expect(toast).toHaveBeenCalledWith("This invite is for something LabShelf cannot open yet.", "error");
  });
});
