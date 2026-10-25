// Tests the citation lookup client: answers match their request, silence resolves empty, and links are cached per document.
import { CitationLookup, LOOKUP_TIMEOUT_MS } from "../../../../../src/reader/dom/hover/citations/findCitation";
import { DOCUMENT_REPLACED, type ReaderContext } from "../../../../../src/reader/dom/session";
import type { CitationEntry, CitationQuery } from "../../../../../src/reader";

const query: CitationQuery = { area: { page: 1, left: 0, top: 0, right: 1, bottom: 1 }, link: true };
const entry: CitationEntry = { key: "smith2020" };

function setup() {
  const handlers = new Map<string, () => void>();
  const post = jest.fn();
  const ctx = { host: { post }, eventBus: { on: (name: string, fn: () => void) => handlers.set(name, fn) } } as unknown as ReaderContext;
  return { lookup: new CitationLookup(ctx), post, handlers, requests: () => post.mock.calls.map((c) => (c[0] as { request: number }).request) };
}

describe("CitationLookup", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resolves each request with the answer carrying its number", async () => {
    const { lookup, post, requests } = setup();
    const first = lookup.lookup(query);
    const second = lookup.lookup({ ...query, link: false });
    expect(post).toHaveBeenCalledWith({ command: "lookupCitation", request: 1, query });
    expect(requests()).toEqual([1, 2]);
    lookup.receive(2, [{ key: "b" }]);
    lookup.receive(1, [entry]);
    await expect(first).resolves.toEqual([entry]);
    await expect(second).resolves.toEqual([{ key: "b" }]);
  });

  it("resolves empty when the host does not answer in time and ignores a late answer", async () => {
    const { lookup } = setup();
    const asked = lookup.lookup(query);
    jest.advanceTimersByTime(LOOKUP_TIMEOUT_MS);
    await expect(asked).resolves.toEqual([]);
    expect(() => lookup.receive(1, [entry])).not.toThrow();
  });

  it("answers a cached place without asking again, and asks again after a timeout", async () => {
    const { lookup, post } = setup();
    const first = lookup.lookup(query, "1:12R");
    lookup.receive(1, [entry]);
    await first;
    await expect(lookup.lookup(query, "1:12R")).resolves.toEqual([entry]);
    expect(post).toHaveBeenCalledTimes(1);

    const silent = lookup.lookup(query, "1:99R");
    jest.advanceTimersByTime(LOOKUP_TIMEOUT_MS);
    await silent;
    void lookup.lookup(query, "1:99R");
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("forgets cached places when the document is replaced", async () => {
    const { lookup, post, handlers } = setup();
    const first = lookup.lookup(query, "1:12R");
    lookup.receive(1, [entry]);
    await first;
    handlers.get(DOCUMENT_REPLACED)?.();
    void lookup.lookup(query, "1:12R");
    expect(post).toHaveBeenCalledTimes(2);
  });
});
