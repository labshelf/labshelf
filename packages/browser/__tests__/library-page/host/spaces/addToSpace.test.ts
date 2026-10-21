// Checks that Add to Space writes selected paper references through the browser host.
jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), quickPick: jest.fn(), inputBox: jest.fn() }));
import type { SpaceStore } from "@labshelf/core";
import { inputBox, quickPick } from "@labshelf/core/dom";
import { addToSpace } from "../../../../src/library-page/host/spaces";

const notice = jest.fn();
const log = { log: jest.fn(), error: jest.fn() };
const addPapers = jest.fn(async () => undefined);
const createSpace = jest.fn(async () => "created");
const store = { list: () => [{ state: "ready", space: { id: "research", name: "Research" } }], addPapers, createSpace } as unknown as SpaceStore;

beforeEach(() => jest.clearAllMocks());
it("adds selected papers to the chosen Space and reports success", async () => {
  jest.mocked(quickPick).mockResolvedValue("research");
  await addToSpace(store, ["p1", "p2"], notice, log);
  expect(addPapers).toHaveBeenCalledWith("research", ["p1", "p2"]);
  expect(notice).toHaveBeenCalledWith("ok", expect.stringContaining("Space"));
});
it("creates a Space when the picker chooses New Space", async () => {
  jest.mocked(quickPick).mockResolvedValue({ create: true });
  jest.mocked(inputBox).mockResolvedValue("Reading group");
  await addToSpace(store, ["p1"], notice, log);
  expect(createSpace).toHaveBeenCalledWith("Reading group");
  expect(addPapers).toHaveBeenCalledWith("created", ["p1"]);
});
it("keeps references unchanged when the picker is dismissed", async () => {
  jest.mocked(quickPick).mockResolvedValue(undefined);
  await addToSpace(store, ["p1"], notice, log);
  expect(addPapers).not.toHaveBeenCalled();
});
