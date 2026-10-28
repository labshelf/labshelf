jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

import { createHitCacheKey } from "../../src/background/drafts";
import type { SearchHit } from "../../src/platform";

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({ key: "cid1", title: "A Title", authors: [], ...over });

describe("createHitCacheKey", () => {
  it("is stable for the same result and ignores non-identity fields", () => {
    expect(createHitCacheKey(hit())).toBe(createHitCacheKey(hit()));
    // authors / venue / year are not part of the identity.
    expect(createHitCacheKey(hit({ authors: ["X"], year: 2020 }))).toBe(createHitCacheKey(hit({ authors: ["Y"], year: 1999 })));
  });

  it("separates results that differ in cluster id, landing url, PDF url or title", () => {
    const base = createHitCacheKey(hit());
    expect(createHitCacheKey(hit({ key: "cid2" }))).not.toBe(base);
    expect(createHitCacheKey(hit({ url: "https://a" }))).not.toBe(createHitCacheKey(hit({ url: "https://b" })));
    expect(createHitCacheKey(hit({ pdfUrl: "https://a.pdf" }))).not.toBe(createHitCacheKey(hit({ pdfUrl: "https://b.pdf" })));
    expect(createHitCacheKey(hit({ title: "Other" }))).not.toBe(base);
  });
});
