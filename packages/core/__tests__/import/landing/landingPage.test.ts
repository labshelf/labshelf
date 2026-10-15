import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchLandingPage, type ILogger } from "@labshelf/core";

const springer = readFileSync(join(__dirname, "..", "..", "fixtures", "springerArticle.html"), "utf8");
const URL_OF_PAGE = "https://link.springer.com/article/10.1007/s10107-023-01234-5";

const respond = (body: string, type = "text/html; charset=utf-8", status = 200): typeof fetch =>
  jest.fn(async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch;

describe("fetchLandingPage", () => {
  it("reads the facts of an HTML page and passes the request options to fetch", async () => {
    const doFetch = respond(springer);
    const facts = await fetchLandingPage(URL_OF_PAGE, { fetch: doFetch, timeoutMs: 1000, credentials: "include", headers: { "User-Agent": "T" } });
    expect(facts?.ids.doi).toBe("10.1007/s10107-023-01234-5");
    expect(facts?.isPaper).toBe(true);
    expect(doFetch).toHaveBeenCalledWith(URL_OF_PAGE, expect.objectContaining({ redirect: "follow", credentials: "include", headers: { "User-Agent": "T" } }));
  });

  it("returns undefined for a PDF, an HTTP error and a network failure", async () => {
    expect(await fetchLandingPage(URL_OF_PAGE, { fetch: respond("%PDF-1.7", "application/pdf"), timeoutMs: 1000 })).toBeUndefined();
    expect(await fetchLandingPage(URL_OF_PAGE, { fetch: respond("nope", "text/html", 404), timeoutMs: 1000 })).toBeUndefined();
    const failing = jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await fetchLandingPage(URL_OF_PAGE, { fetch: failing, timeoutMs: 1000 })).toBeUndefined();
  });

  it("logs the url and the reason when the fetch fails", async () => {
    const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
    const failing = jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await fetchLandingPage(URL_OF_PAGE, { fetch: failing, timeoutMs: 1000, logger });
    expect(logger.log).toHaveBeenCalledWith("WARN", "landing", "Landing page fetch failed", { url: URL_OF_PAGE, message: "offline" });
  });
});
