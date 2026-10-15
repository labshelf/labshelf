// Closing a helper tab that is already gone is logged as a warning and does not fail the capture.
const create = jest.fn();
const remove = jest.fn();
const log = jest.fn(async () => undefined);
jest.mock("../../src/platform", () => ({
  bx: { tabs: { create: (o: unknown) => create(o), remove: (id: number) => remove(id) } },
}));

import { fetchViaHelperTab } from "../../src/capture/tab/helperTab";

describe("fetchViaHelperTab", () => {
  it("logs the tab id when the helper tab cannot be closed, and still returns the result", async () => {
    create.mockResolvedValue({ id: 42 });
    remove.mockRejectedValue(new Error("No tab with id: 42"));
    // No scripting API in node, so the tab never settles and the fetch yields undefined.
    expect(await fetchViaHelperTab({ log, error: jest.fn() }, ["https://publisher.example/paper.pdf"])).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(42);
    expect(log).toHaveBeenCalledWith("WARN", "capture", "Helper tab did not close", { tabId: 42, message: "No tab with id: 42" });
  });
});
