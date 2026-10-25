import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";

import { harness, pdfResponse, type Harness } from "../fixtures/paperService";
import { cleanupTempDirs, fakePdfBytes, listFiles, readYaml } from "../fixtures/library";

afterEach(cleanupTempDirs);

// No identifier in the URL: a URL with one is imported through the registries instead.
const LANDING = "https://link.springer.com/article/grassmann-optimization";
const PDF_URL = "https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf";
const SPRINGER = readFileSync(path.join(__dirname, "..", "..", "..", "core", "__tests__", "fixtures", "springerArticle.html"), "utf8");

const htmlResponse = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

async function importLanding(h: Harness, url = LANDING) {
  return (await h.service.importAny([url], ""))[0]!;
}

describe("landing-page import", () => {
  it("saves the paper the page describes with the PDF the chain finds from its links", async () => {
    const h = await harness();
    h.routes.set(LANDING, htmlResponse(SPRINGER));
    h.routes.set(PDF_URL, pdfResponse("springer"));

    const outcome = await importLanding(h);

    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.record).toMatchObject({
      id: "edelman2024optimization", hasPdf: true, doi: "10.1007/s10107-023-01234-5", journal: "Mathematical Programming", year: 2024,
    });
    const folder = h.lib.paperDir("edelman2024optimization");
    expect(await listFiles(folder)).toEqual(["bib.bib", "metadata.yaml", "paper.pdf"]);
    expect(new Uint8Array(await fs.readFile(path.join(folder, "paper.pdf")))).toEqual(fakePdfBytes("springer"));
    expect(await readYaml(path.join(folder, "metadata.yaml"))).toMatchObject({ authors: ["Alan Edelman", "Tomás A. Arias", "Steven T. Smith"] });
    expect(h.resolve).toHaveBeenCalledWith({ type: "doi", value: "10.1007/s10107-023-01234-5" });
  });

  it("prefers the registry record over the page's tags", async () => {
    const h = await harness();
    h.routes.set(LANDING, htmlResponse(SPRINGER));
    h.resolve.mockResolvedValue({ title: "Registry Grassmann Title", authors: ["Alan Edelman"], year: 2024, doi: "10.1007/s10107-023-01234-5" });

    const outcome = await importLanding(h);

    expect(outcome.status === "added" && outcome.record.title).toBe("Registry Grassmann Title");
  });

  it("saves a reference without a PDF when no link on the page serves one, and logs the links it tried", async () => {
    const h = await harness();
    h.routes.set(LANDING, htmlResponse(SPRINGER));
    h.routes.set(PDF_URL, htmlResponse("<html>Please log in</html>"));

    const outcome = await importLanding(h);

    expect(outcome.status === "added" && outcome.record.hasPdf).toBe(false);
    expect(await listFiles(h.lib.paperDir("edelman2024optimization"))).toEqual(["bib.bib", "metadata.yaml"]);
    const notFound = h.logs.find((l) => l.message === "No PDF found");
    expect(notFound).toMatchObject({ level: "INFO", context: { input: LANDING } });
    expect(notFound!.context!["attempts"]).toEqual(expect.arrayContaining([expect.stringContaining(PDF_URL)]));
  });

  it("skips a paper the library already has, without downloading its PDF", async () => {
    const h = await harness([{ id: "have-it", meta: { doi: "10.1007/S10107-023-01234-5" } }]);
    h.routes.set(LANDING, htmlResponse(SPRINGER));
    h.routes.set(PDF_URL, pdfResponse());

    expect(await importLanding(h)).toEqual({ status: "duplicate", existingId: "have-it", input: LANDING });
    expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([LANDING]);
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual(["have-it"]);
  });

  it("skips a paper the library has under the same title and year when the page states no DOI", async () => {
    const h = await harness([{ id: "have-it", title: "Optimization algorithms on the Grassmann manifold with applications", meta: { year: 2024 } }]);
    const withoutDoi = SPRINGER.replace(/<meta name="citation_doi"[^>]*>/, "").replace(/10\.1007\/s10107-023-01234-5/g, "x");
    h.routes.set("https://example.org/some-article", htmlResponse(withoutDoi));
    const outcome = await importLanding(h, "https://example.org/some-article");
    expect(outcome).toEqual({ status: "duplicate", existingId: "have-it", input: "https://example.org/some-article" });
  });

  it("fails a page that describes no paper, instead of reporting that it is not a PDF", async () => {
    const h = await harness();
    h.routes.set("https://example.org/blog", htmlResponse("<html><head><title></title></head><body>posts</body></html>"));

    const outcome = await importLanding(h, "https://example.org/blog");

    expect(outcome).toEqual({ status: "failed", error: "No paper found on the page", input: "https://example.org/blog" });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
    expect(h.logs.some((l) => l.level === "WARN" && l.message === "Landing page describes no paper")).toBe(true);
  });
});
