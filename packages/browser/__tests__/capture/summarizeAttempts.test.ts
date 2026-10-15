/** What the "No PDF found" dialog is told: links tried, sources consulted, and whether a bot check or a login stood in the way. */
import type { PdfAttempt } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/paperRecordStore", () => ({ listAllRecords: async () => [], upsertRecord: async () => undefined }));
jest.mock("../../src/platform/settings", () => ({ getSettings: async () => ({}), updateSettings: async () => undefined }));

import { summarizeAttempts } from "../../src/capture/captureService";

const attempt = (over: Partial<PdfAttempt> = {}): PdfAttempt => ({ source: "page", url: "https://a.example/1.pdf", outcome: "error", ...over });

describe("summarizeAttempts", () => {
  it("counts distinct links and sources and flags nothing when every fetch just failed", () => {
    const attempts = [attempt(), attempt({ url: "https://a.example/2.pdf", source: "publisher", outcome: "html", status: 200 }), attempt({ source: "publisher" })];
    expect(summarizeAttempts(attempts)).toEqual({ tried: 2, sources: ["page", "publisher"], blocked: false, needsLogin: false });
  });

  it("sets blocked when any attempt ended in a bot check", () => {
    expect(summarizeAttempts([attempt(), attempt({ url: "https://b.example/p.pdf", outcome: "bot", status: 403 })]))
      .toMatchObject({ blocked: true, needsLogin: false });
  });

  it("sets needsLogin when any attempt ended in a login or paywall page", () => {
    expect(summarizeAttempts([attempt({ outcome: "login", status: 401 }), attempt({ url: "https://b.example/p.pdf" })]))
      .toMatchObject({ blocked: false, needsLogin: true });
  });

  it("does not double-count the helper-tab retry of a blocked link", () => {
    const attempts = [attempt({ outcome: "bot", status: 403 }), attempt({ source: "page (via tab)", outcome: "bot" })];
    expect(summarizeAttempts(attempts)).toEqual({ tried: 1, sources: ["page"], blocked: true, needsLogin: false });
  });

  it("is not blocked just because a tab retry exists without a bot outcome", () => {
    expect(summarizeAttempts([attempt({ outcome: "html" }), attempt({ source: "page (via tab)", outcome: "html" })]).blocked).toBe(false);
  });
});
