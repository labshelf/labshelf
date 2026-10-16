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

  it("offers the best-ranked sign-in or bot-check page as the page to open", () => {
    const walled = "https://pub.example/pdf/1";
    const attempts = [attempt({ outcome: "html" }), attempt({ url: walled, outcome: "bot", status: 403 }), attempt({ url: "https://c.example/p", outcome: "login" })];
    expect(summarizeAttempts(attempts).access).toEqual({ kind: "bot", url: walled });
    expect(summarizeAttempts([attempt()]).access).toBeUndefined();
  });

  it("prefers the library proxy's sign-in page over an earlier publisher wall", () => {
    const proxyLogin = "https://login.ezproxy.uni.edu/login?url=x";
    const attempts = [
      attempt({ url: "https://pub.example/pdf/1", outcome: "login" }),
      attempt({ url: "https://pub.example/pdf/2", outcome: "bot", status: 403 }),
      attempt({ url: proxyLogin, outcome: "login", proxy: "Uni library" }),
    ];
    expect(summarizeAttempts(attempts).access).toEqual({ kind: "login", url: proxyLogin });
  });

  it("falls back to the first wall when a proxy attempt did not reach a sign-in page", () => {
    const attempts = [attempt({ url: "https://pub.example/pdf/1", outcome: "bot", status: 403 }), attempt({ outcome: "html", proxy: "Uni library" })];
    expect(summarizeAttempts(attempts).access).toEqual({ kind: "bot", url: "https://pub.example/pdf/1" });
  });

  it("sets needsLogin when any attempt ended in a login or paywall page", () => {
    expect(summarizeAttempts([attempt({ outcome: "login", status: 401 }), attempt({ url: "https://b.example/p.pdf" })]))
      .toMatchObject({ blocked: false, needsLogin: true });
  });
});
