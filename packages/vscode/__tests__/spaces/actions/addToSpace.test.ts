// Verifies Space selection adds references only after the user chooses a destination.
import * as vscode from "vscode";
import { addToSpace } from "../../../src/spaces/actions/index.js";

function setup() {
  const addPapers = jest.fn(async () => {});
  const store = { list: () => [{ state: "ready", space: { id: "reading", name: "Reading" } }], addPapers };
  const current = { store };
  const service = { current: () => current, createSpace: jest.fn(async () => "created") };
  return { service, addPapers };
}

afterEach(() => jest.clearAllMocks());

it("adds the selection to the chosen Space", async () => {
  const { service, addPapers } = setup();
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ id: "reading", label: "Reading" });
  expect(await addToSpace(service as never, ["paper-a", "paper-b"])).toBe(true);
  expect(addPapers).toHaveBeenCalledWith("reading", ["paper-a", "paper-b"]);
});

it("creates a Space before adding references", async () => {
  const { service, addPapers } = setup();
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: "New Space…" });
  await addToSpace(service as never, ["paper-a"]);
  expect(service.createSpace).toHaveBeenCalled();
  expect(addPapers).toHaveBeenCalledWith("created", ["paper-a"]);
});

it("does not write when the picker is dismissed", async () => {
  const { service, addPapers } = setup();
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
  expect(await addToSpace(service as never, ["paper-a"])).toBe(false);
  expect(addPapers).not.toHaveBeenCalled();
});


it("refuses a destination after the library changes while the picker is open", async () => {
  const { service, addPapers } = setup();
  (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async () => {
    service.current = () => undefined as never;
    return { label: "New Space…" };
  });
  await expect(addToSpace(service as never, ["paper-a"])).rejects.toThrow("library changed");
  expect(service.createSpace).not.toHaveBeenCalled();
  expect(addPapers).not.toHaveBeenCalled();
});
