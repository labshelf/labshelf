import { DEFAULT_CONTACT_EMAIL, importNetworkInput, type ImportOutcome, type NetworkImportEnv, type ResolvedMetadata } from "@labshelf/core";

import { makeImportDeps } from "../../support/importFakes";
import { makeHarness, PAPERS, type MutationHarness } from "../../support/mutationHarness";
import { html, json, makeFindingHarness, pdf, PDF, type FindingHarness } from "../../support/pdfFindingHarness";

const ATTENTION: ResolvedMetadata = { title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 };
const PAPER_DIR = `${PAPERS}/vaswani2017attention`;
const unpaywall = (doi: string): string => `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(DEFAULT_CONTACT_EMAIL)}`;

interface Setup { h: MutationHarness; net: FindingHarness; env: NetworkImportEnv; resolve: jest.Mock }

function setup(metadata: ResolvedMetadata | undefined = ATTENTION): Setup {
  const h = makeHarness();
  const net = makeFindingHarness();
  const resolve = jest.fn(async () => metadata);
  const deps = makeImportDeps();
  const env: NetworkImportEnv = {
    ctx: h.ctx,
    tmpDir: "/lib/tmp",
    importDeps: () => deps,
    records: () => [],
    download: { fetch: net.opts().fetch!, headers: { "User-Agent": "Test/1" } },
    resolveIdentifier: resolve,
  };
  return { h, net, env, resolve };
}

const added = (outcome: ImportOutcome): void => expect(outcome.status).toBe("added");

describe("importNetworkInput with an identifier", () => {
  it("saves the PDF the chain finds for a DOI, asking with the default contact email", async () => {
    const { h, net, env } = setup();
    net.routes[unpaywall("10.1000/abc")] = () => json({ best_oa_location: { url_for_pdf: "https://repo.example.org/a.pdf" } });
    net.routes["https://repo.example.org/a.pdf"] = pdf;

    added(await importNetworkInput(env, "10.1000/abc", PAPERS));

    expect(await h.fs.readFile(`${PAPER_DIR}/paper.pdf`)).toEqual(PDF);
    expect(h.logs.find((l) => l.message === "PDF found")).toMatchObject({ level: "INFO", context: { source: "unpaywall" } });
  });

  it("saves the PDF a DOI's landing page names in citation_pdf_url", async () => {
    const { h, net, env } = setup();
    net.routes["https://doi.org/10.1000/abc"] = () => html('<html><head><meta name="citation_pdf_url" content="https://cdn.example.org/paper.pdf"></head></html>');
    net.routes["https://cdn.example.org/paper.pdf"] = pdf;

    added(await importNetworkInput(env, "10.1000/abc", PAPERS));

    expect(net.calls).toContain("https://doi.org/10.1000/abc");
    expect(await h.fs.readFile(`${PAPER_DIR}/paper.pdf`)).toEqual(PDF);
    expect(h.logs.find((l) => l.message === "PDF found")).toMatchObject({ context: { source: "landing" } });
  });

  it("keeps arXiv's source name and saves a reference when no PDF downloads, logging the attempts", async () => {
    const { h, net, env } = setup();
    net.routes["https://arxiv.org/pdf/1706.03762"] = () => html("<html>log in</html>");

    added(await importNetworkInput(env, "arXiv:1706.03762", PAPERS));

    expect(h.fs.fileList().filter((f) => f.startsWith(PAPER_DIR))).toEqual([`${PAPER_DIR}/bib.bib`, `${PAPER_DIR}/metadata.yaml`]);
    expect((await h.readMeta(PAPER_DIR))["source"]).toBe("1706.03762.pdf");
    expect(h.logs.find((l) => l.message === "No PDF found")).toMatchObject({
      level: "INFO", context: { attempts: ["arxiv: https://arxiv.org/pdf/1706.03762"] },
    });
  });

  it("names the paper with the cite key asked for", async () => {
    const { h, env } = setup();

    const outcome = await importNetworkInput(env, "10.1000/abc", PAPERS, { citeKey: "vaswani17" });

    expect(outcome).toMatchObject({ status: "added", record: { id: "vaswani17", citeKey: "vaswani17" } });
    expect(await h.fs.exists(`${PAPERS}/vaswani17/metadata.yaml`)).toBe(true);
    expect(h.logs.find((l) => l.message === "Requested cite key was taken")).toBeUndefined();
  });

  it("suffixes a cite key that is taken, returns the suffixed one and logs a warning", async () => {
    const { h, env } = setup();
    const deps = makeImportDeps([{ id: "vaswani17" }]);
    env.importDeps = () => deps;

    const outcome = await importNetworkInput(env, "10.1000/abc", PAPERS, { citeKey: "vaswani17" });

    expect(outcome).toMatchObject({ status: "added", record: { id: "vaswani17a", citeKey: "vaswani17a" } });
    expect(h.logs.find((l) => l.message === "Requested cite key was taken")).toMatchObject({
      level: "WARN", context: { requested: "vaswani17", id: "vaswani17a" },
    });
  });

  it("does not look for a PDF of a book", async () => {
    const { net, env } = setup({ title: "Deep Learning", authors: ["Ian Goodfellow"], year: 2016 });

    added(await importNetworkInput(env, "ISBN 978-0-262-03561-3", PAPERS));

    expect(net.calls).toEqual([]);
  });

  it("logs a registry that throws and fails with the identifier it could not find", async () => {
    const { h, env, resolve } = setup();
    resolve.mockRejectedValue(new Error("registry down"));

    expect(await importNetworkInput(env, "10.1000/abc", PAPERS)).toEqual({ status: "failed", error: "Could not find DOI 10.1000/abc", input: "10.1000/abc" });
    expect(h.logs.find((l) => l.message === "Registry lookup failed")).toMatchObject({ level: "WARN", context: { message: "registry down" } });
  });
  it("asks the registries on the app's network and logs one that fails", async () => {
    const { h, net, env } = setup();
    delete env.resolveIdentifier;

    expect(await importNetworkInput(env, "10.1000/abc", PAPERS)).toMatchObject({ status: "failed" });

    expect(net.calls.some((url) => url.startsWith("https://api.crossref.org/works/"))).toBe(true);
    expect(h.logs.find((l) => l.message === "Registry lookup failed")).toMatchObject({ level: "WARN", context: { status: 404 } });
  });
});

describe("importNetworkInput with a link", () => {
  it("stores an article page's title tidied, its DOI, and no PDF when none downloads", async () => {
    const { h, net, env } = setup();
    const page = `<html><head><meta name="citation_title" content="Self-attention_at   scale"><meta name="citation_author" content="Lee, Ann">
      <meta name="citation_publication_date" content="2020"><meta name="citation_doi" content="10.1000/page"></head></html>`;
    net.routes["https://example.org/article/2"] = () => html(page);
    env.resolveIdentifier = async () => undefined;

    added(await importNetworkInput(env, "https://example.org/article/2", PAPERS));

    const meta = await h.readMeta(`${PAPERS}/lee2020self`);
    expect(meta).toMatchObject({ title: "Self attention at scale", doi: "10.1000/page" });
    expect(await h.fs.exists(`${PAPERS}/lee2020self/paper.pdf`)).toBe(false);
  });

  it("reports an article page already in the library as a duplicate, writing nothing", async () => {
    const { h, net, env } = setup();
    const page = `<html><head><meta name="citation_title" content="A Study of Things"><meta name="citation_doi" content="10.1000/have"></head></html>`;
    net.routes["https://example.org/article/3"] = () => html(page);
    env.resolveIdentifier = async () => undefined;
    env.records = () => [{ id: "have", title: "Other", citeKey: "have", path: `${PAPERS}/have`, status: "unread", doi: "10.1000/HAVE" }];

    expect(await importNetworkInput(env, "https://example.org/article/3", PAPERS)).toEqual({ status: "duplicate", existingId: "have", input: "https://example.org/article/3" });
    expect(h.fs.fileList().filter((f) => f.startsWith(`${PAPERS}/`))).toEqual([]);
  });

  it("fails a web page that names no paper without asking the registries", async () => {
    const { h, net, env } = setup();
    net.routes["https://example.org/blog"] = () => html("<html><head><title>My holiday</title></head><body>hi</body></html>");

    expect(await importNetworkInput(env, "https://example.org/blog", PAPERS)).toEqual({ status: "failed", error: "No paper found on the page", input: "https://example.org/blog" });
    expect(net.calls).toEqual(["https://example.org/blog"]);
    expect(h.logs.find((l) => l.message === "Landing page describes no paper")).toBeDefined();
  });

  it("imports a PDF link under the name in the URL and removes the download", async () => {
    const { h, net, env } = setup();
    net.routes["https://example.org/files/My%20Paper.pdf"] = pdf;

    added(await importNetworkInput(env, "https://example.org/files/My%20Paper.pdf", PAPERS));

    expect(h.fs.fileList().some((f) => f.startsWith("/lib/tmp/"))).toBe(false);
    expect((await h.readMeta(PAPER_DIR))["source"]).toBe("My Paper.pdf");
  });

  it("finds the PDF of an article page through the chain, from the page's own links", async () => {
    const { h, net, env } = setup();
    const page = `<html><head><meta name="citation_title" content="A Study of Things"><meta name="citation_author" content="Lee, Ann">
      <meta name="citation_publication_date" content="2020/05/01"><meta name="citation_pdf_url" content="https://example.org/study.pdf"></head></html>`;
    net.routes["https://example.org/article/1"] = () => html(page);
    net.routes["https://example.org/study.pdf"] = pdf;

    added(await importNetworkInput(env, "https://example.org/article/1", PAPERS));

    expect(await h.fs.readFile(`${PAPERS}/lee2020study/paper.pdf`)).toEqual(PDF);
  });

  it("fails a link whose bytes have something before the PDF header, writing nothing", async () => {
    const { h, net, env } = setup();
    net.routes["https://example.org/p.pdf"] = () => new Response(new TextEncoder().encode("\n%PDF-1.5 body"));

    expect(await importNetworkInput(env, "https://example.org/p.pdf", PAPERS)).toMatchObject({ status: "failed" });
    expect(await h.fs.exists(PAPER_DIR)).toBe(false);
  });

  it("fails a link that is neither a PDF nor a page", async () => {
    const { net, env } = setup();
    net.routes["https://example.org/data"] = () => new Response("just text");

    expect(await importNetworkInput(env, "https://example.org/data", PAPERS)).toEqual({
      status: "failed", error: "The URL did not return a PDF", input: "https://example.org/data",
    });
  });
});

describe("importNetworkInput records the PDF version", () => {
  it("writes preprint for an arXiv paper whose only PDF is arXiv's", async () => {
    const { h, net, env } = setup();
    net.routes["https://arxiv.org/pdf/1706.03762"] = pdf;

    added(await importNetworkInput(env, "arXiv:1706.03762", PAPERS));

    expect(await h.readMeta(PAPER_DIR)).toMatchObject({ pdfVersion: "preprint" });
    expect(h.logs.find((l) => l.message === "PDF found")).toMatchObject({ context: { version: "preprint" } });
  });

  it("writes the version Unpaywall labels the downloaded copy with", async () => {
    const { h, net, env } = setup();
    net.routes[unpaywall("10.1000/abc")] = () => json({ best_oa_location: { url_for_pdf: "https://repo.example.org/a.pdf", version: "acceptedVersion" } });
    net.routes["https://repo.example.org/a.pdf"] = pdf;

    added(await importNetworkInput(env, "10.1000/abc", PAPERS));

    expect(await h.readMeta(PAPER_DIR)).toMatchObject({ pdfVersion: "accepted" });
  });

  it("writes no version for a copy nothing labels", async () => {
    const { h, net, env } = setup();
    net.routes[unpaywall("10.1000/abc")] = () => json({ best_oa_location: { url_for_pdf: "https://repo.example.org/a.pdf" } });
    net.routes["https://repo.example.org/a.pdf"] = pdf;

    added(await importNetworkInput(env, "10.1000/abc", PAPERS));

    expect(await h.readMeta(PAPER_DIR)).not.toHaveProperty("pdfVersion");
  });

  it("writes no version when no PDF downloads", async () => {
    const { h, net, env } = setup();
    net.routes["https://arxiv.org/pdf/1706.03762"] = () => html("<html>log in</html>");

    added(await importNetworkInput(env, "arXiv:1706.03762", PAPERS));

    expect(await h.readMeta(PAPER_DIR)).not.toHaveProperty("pdfVersion");
  });

  it("writes the version of the PDF an article page's chain finds", async () => {
    const { h, net, env } = setup();
    const page = `<html><head><meta name="citation_title" content="A Study of Things"><meta name="citation_author" content="Lee, Ann">
      <meta name="citation_publication_date" content="2020/05/01"><meta name="citation_pdf_url" content="https://arxiv.org/pdf/2005.00001"></head></html>`;
    net.routes["https://example.org/article/1"] = () => html(page);
    net.routes["https://arxiv.org/pdf/2005.00001"] = pdf;

    added(await importNetworkInput(env, "https://example.org/article/1", PAPERS));

    expect(await h.readMeta(`${PAPERS}/lee2020study`)).toMatchObject({ pdfVersion: "preprint" });
  });
});
