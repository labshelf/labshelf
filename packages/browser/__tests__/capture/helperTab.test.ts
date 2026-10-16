// The helper tab opens the walled URL, waits out the wall, fetches from inside the tab, and always closes.
const create = jest.fn();
const remove = jest.fn();
const get = jest.fn();
const log = jest.fn(async () => undefined);
jest.mock("../../src/platform", () => ({
  bx: { tabs: { create: (o: unknown) => create(o), remove: (id: number) => remove(id), get: (id: number) => get(id) } },
}));

import { fetchViaHelperTab } from "../../src/capture/tab/helperTab";

const PDF_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/pdf/x.pdf";
const PDF_B64 = btoa("%PDF-1.5 body");
const page = (html: string) => ({ ready: true, pdf: false, url: PDF_URL, html });
const POW_WALL = page('<html><head><title>Preparing to download</title><script>var POW_CHALLENGE = "abc";</script></head></html>');

// Stands in for chrome.scripting: answers the settle probe from `states`, one per poll, and the in-tab fetch with a PDF.
function fakeScripting(states: unknown[]): jest.Mock {
  const executeScript = jest.fn(async ({ func }: { func: { name: string } }) =>
    func.name === "pageState" ? [{ result: states.length > 1 ? states.shift() : states[0] }] : [{ result: { b64: PDF_B64, url: PDF_URL } }]);
  (globalThis as { chrome?: unknown }).chrome = { scripting: { executeScript } };
  return executeScript;
}

describe("fetchViaHelperTab", () => {
  afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome; jest.clearAllMocks(); });

  it("loads the walled URL itself, waits until the wall is gone, and fetches the PDF from the tab", async () => {
    create.mockResolvedValue({ id: 7 });
    remove.mockResolvedValue(undefined);
    const executeScript = fakeScripting([POW_WALL, POW_WALL, { ready: true, pdf: true, url: PDF_URL, html: "" }]);
    const got = await fetchViaHelperTab({ log, error: jest.fn() }, [PDF_URL], new AbortController().signal);
    expect(create).toHaveBeenCalledWith({ url: PDF_URL, active: false });
    expect(executeScript.mock.calls.filter(([c]) => c.func.name === "pageState").length).toBeGreaterThanOrEqual(4);
    expect(got?.url).toBe(PDF_URL);
    expect(remove).toHaveBeenCalledWith(7);
  }, 10_000);

  it("stops waiting and closes the tab when the run no longer needs it", async () => {
    create.mockResolvedValue({ id: 8 });
    remove.mockResolvedValue(undefined);
    fakeScripting([POW_WALL]);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    expect(await fetchViaHelperTab({ log, error: jest.fn() }, [PDF_URL], stop.signal)).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(8);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs the tab id when the helper tab cannot be closed, and still returns the result", async () => {
    create.mockResolvedValue({ id: 42 });
    remove.mockRejectedValue(new Error("No tab with id: 42"));
    // No scripting API in node, so the tab never settles and the fetch yields undefined.
    expect(await fetchViaHelperTab({ log, error: jest.fn() }, ["https://publisher.example/paper.pdf"], new AbortController().signal)).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(42);
    expect(log).toHaveBeenCalledWith("WARN", "capture", "Helper tab did not close", { tabId: 42, message: "No tab with id: 42" });
  });
});
