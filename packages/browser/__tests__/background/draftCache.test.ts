jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

import { hitCacheKey } from "../../src/background/draftCache";
import type { SearchHit } from "../../src/platform";

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({ key: "cid1", title: "A Title", authors: [], ...over });

describe("hitCacheKey", () => {
  it("is stable for the same result and ignores non-identity fields", () => {
    expect(hitCacheKey(hit())).toBe(hitCacheKey(hit()));
    // authors / venue / year are not part of the identity.
    expect(hitCacheKey(hit({ authors: ["X"], year: 2020 }))).toBe(hitCacheKey(hit({ authors: ["Y"], year: 1999 })));
  });

  it("separates results that differ in cluster id, landing url, PDF url or title", () => {
    const base = hitCacheKey(hit());
    expect(hitCacheKey(hit({ key: "cid2" }))).not.toBe(base);
    expect(hitCacheKey(hit({ url: "https://a" }))).not.toBe(hitCacheKey(hit({ url: "https://b" })));
    expect(hitCacheKey(hit({ pdfUrl: "https://a.pdf" }))).not.toBe(hitCacheKey(hit({ pdfUrl: "https://b.pdf" })));
    expect(hitCacheKey(hit({ title: "Other" }))).not.toBe(base);
  });
});
