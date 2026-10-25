/** Contract of the bibliography linter: duplicates, missing DOIs and published preprints, each with its fix, on recorded registry responses. */
import { BIBLIOGRAPHY_HEADER, type RegistryEnv } from "../../../src/index";
import { bibEntries, lintBibliography, missingDoiFix, publishedVersionLookup, type BibFix } from "../../../src/writing/bibliography/index";

const ARXIV = "https://export.arxiv.org/api/query?id_list=1706.03762";
const crossref = (doi: string): string => `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
const feed = (doi: string): string =>
  `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>T</title><arxiv:doi>${doi}</arxiv:doi></entry></feed>`;
const PUBLISHED = {
  message: {
    type: "proceedings-article", title: ["Attention is All you Need"], author: [{ given: "Ashish", family: "Vaswani" }, { given: "Noam", family: "Shazeer" }],
    issued: { "date-parts": [[2017]] }, "container-title": ["Advances in Neural Information Processing Systems"], page: "5998-6008", DOI: "10.5555/3295222.3295349",
  },
};

function fakeNetwork(routes: Record<string, string | object>): { env: RegistryEnv; calls: string[] } {
  const calls: string[] = [];
  const fetchFake = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const body = routes[url];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(typeof body === "string" ? body : JSON.stringify(body));
  };
  return { env: { fetch: fetchFake as typeof fetch }, calls };
}

const apply = (text: string, fix: BibFix): string => text.slice(0, fix.start) + fix.text + text.slice(fix.end);
const offline = publishedVersionLookup(fakeNetwork({}).env);

describe("lintBibliography", () => {
  const preprint = `@misc{vaswani2017,\n  title = {Attention Is All You Need},\n  author = {Vaswani, Ashish},\n  journal = {arXiv preprint arXiv:1706.03762},\n  year = {2017},\n  note = {my favourite}\n}\n`;

  it("warns about an arXiv entry with a published version and replaces it, keeping the key and the user's fields", async () => {
    const { env } = fakeNetwork({ [ARXIV]: feed("10.5555/3295222.3295349"), [crossref("10.5555/3295222.3295349")]: PUBLISHED });
    const [finding] = await lintBibliography(preprint, publishedVersionLookup(env));
    expect(finding).toMatchObject({ rule: "published-version", severity: "warning", key: "vaswani2017" });
    expect(finding!.message).toContain("Advances in Neural Information Processing Systems");
    const fixed = apply(preprint, finding!.fix!);
    expect(fixed).toBe(
      "@article{vaswani2017,\n  title = {Attention is All you Need},\n  author = {Ashish Vaswani and Noam Shazeer},\n"
      + "  journal = {Advances in Neural Information Processing Systems},\n  year = {2017},\n  pages = {5998-6008},\n"
      + "  doi = {10.5555/3295222.3295349},\n  note = {my favourite}\n}\n",
    );
    expect(await lintBibliography(fixed, offline)).toEqual([]);
  });

  it("keeps the entry's own author field when the published record lists a whole collaboration", async () => {
    const atlas = "@misc{atlas2012, title = {Observation}, author = {{ATLAS Collaboration}}, eprint = {1207.7214}, archivePrefix = {arXiv}}";
    const authors = Array.from({ length: 51 }, (_, i) => ({ given: "A.", family: `Member${i}` }));
    const arxiv = "https://export.arxiv.org/api/query?id_list=1207.7214";
    const { env } = fakeNetwork({
      [arxiv]: feed("10.1016/j.physletb.2012.08.020").replace("1706.03762", "1207.7214"),
      [crossref("10.1016/j.physletb.2012.08.020")]: { message: { title: ["Observation"], author: authors, "container-title": ["Physics Letters B"] } },
    });
    const [finding] = await lintBibliography(atlas, publishedVersionLookup(env));
    expect(finding!.fix!.text).toBe(
      "@article{atlas2012,\n  title = {Observation},\n  author = {{ATLAS Collaboration}},\n  journal = {Physics Letters B},\n  doi = {10.1016/j.physletb.2012.08.020}\n}",
    );
  });

  it("says nothing about a preprint when no relation is recorded", async () => {
    const { env, calls } = fakeNetwork({ [ARXIV]: "<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>T</title></entry></feed>" });
    expect(await lintBibliography(preprint, publishedVersionLookup(env))).toEqual([]);
    expect(calls).toEqual([ARXIV]);
  });

  it("finds a bioRxiv DOI's published version through CrossRef and asks once per lookup", async () => {
    const biorxiv = "@article{lab2020, title = {T}, journal = {bioRxiv}, doi = {10.1101/2020.01.01.123456}}";
    const { env, calls } = fakeNetwork({
      [crossref("10.1101/2020.01.01.123456")]: { message: { relation: { "is-preprint-of": [{ "id-type": "doi", id: "10.1016/j.cell.2020.1" }] } } },
    });
    const lookup = publishedVersionLookup(env);
    const [finding] = await lintBibliography(biorxiv, lookup);
    expect(finding).toMatchObject({ rule: "published-version", key: "lab2020" });
    // CrossRef has no record of the journal DOI, so there is nothing to replace the entry with.
    expect(finding!.fix).toBeUndefined();
    await lintBibliography(biorxiv, lookup);
    expect(calls.filter((url) => url === crossref("10.1101/2020.01.01.123456"))).toHaveLength(1);
  });

  it("flags repeated keys with a removal, and repeated DOIs or titles under other keys without one", async () => {
    const text = "@article{a, title = {One}, doi = {10.1234/X}}\n@article{a, title = {Other}, doi = {10.9999/z}}\n"
      + "@article{b, title = {Two}, doi = {https://doi.org/10.1234/x}}\n@inproceedings{c, title = {O{n}e!}, doi = {10.2222/y}}\n";
    const findings = await lintBibliography(text, offline);
    expect(findings.map((f) => [f.rule, f.key, f.message])).toEqual([
      ["duplicate", "a", "a is defined twice; BibTeX uses the first one."],
      ["duplicate", "b", "b has the same DOI as a."],
      ["duplicate", "c", "c has the same title as a."],
    ]);
    expect(apply(text, findings[0]!.fix!)).toBe(text.replace("@article{a, title = {Other}, doi = {10.9999/z}}\n", ""));
    expect(findings[1]!.fix).toBeUndefined();
  });

  it("notes articles without a DOI but not books or preprints", async () => {
    const text = "@article{x, title = {X}}\n@book{y, title = {Y}}\n@misc{z, title = {Z}, eprint = {2101.00001}}";
    const findings = await lintBibliography(text, offline);
    expect(findings.map((f) => [f.rule, f.severity, f.key])).toEqual([["missing-doi", "information", "x"]]);
  });

  it("leaves LabShelf's generated bibliography alone", async () => {
    expect(await lintBibliography(`${BIBLIOGRAPHY_HEADER}\n\n@article{x, title = {X}}\n@article{x, title = {X}}\n`, offline)).toEqual([]);
  });
});

describe("missingDoiFix", () => {
  const text = "@article{x,\n  title = {Deep {Residual} Learning},\n  author = {He, Kaiming},\n  year = {2016}\n}";
  const search = "https://api.crossref.org/works?rows=3&query.bibliographic=" + encodeURIComponent("Deep Residual Learning He, Kaiming");

  it("adds the DOI of the CrossRef record with the same title and year", async () => {
    const { env } = fakeNetwork({ [search]: { message: { items: [
      { title: ["Deep residual learning for image recognition"], DOI: "10.1/wrong", issued: { "date-parts": [[2016]] } },
      { title: ["Deep Residual Learning"], DOI: "10.1109/cvpr.2016.90", issued: { "date-parts": [[2016]] } },
    ] } } });
    const fix = await missingDoiFix(env, text, bibEntries(text)[0]!);
    expect(apply(text, fix!)).toBe(text.replace("{x,", "{x,\n  doi = {10.1109/cvpr.2016.90},"));
  });

  it("adds nothing when the only same-title record is from another year", async () => {
    const { env } = fakeNetwork({ [search]: { message: { items: [{ title: ["Deep Residual Learning"], DOI: "10.1/other", issued: { "date-parts": [[2019]] } }] } } });
    expect(await missingDoiFix(env, text, bibEntries(text)[0]!)).toBeUndefined();
  });
});
