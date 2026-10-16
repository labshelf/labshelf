/** Contract of publishedDoiOf: the journal DOI of a preprint, from arXiv's author-reported DOI or CrossRef's preprint relation. */
import { publishedDoiOf, type RegistryEnv } from "../../../src/import/registries/index";

const feed = (doi?: string): string =>
  `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>T</title>${doi ? `<arxiv:doi>${doi}</arxiv:doi>` : ""}</entry></feed>`;
const crossref = (doi: string): string => `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
const ARXIV = "https://export.arxiv.org/api/query?id_list=1706.03762";
const related = (...ids: Array<{ type: string; id: string }>): object => ({
  message: { relation: { "is-preprint-of": ids.map((r) => ({ "id-type": r.type, id: r.id })) } },
});

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

describe("publishedDoiOf", () => {
  it("returns the DOI the arXiv feed carries", async () => {
    const { env, calls } = fakeNetwork({ [ARXIV]: feed("10.5555/3295222") });
    expect(await publishedDoiOf(env, { arxivId: "1706.03762" })).toBe("10.5555/3295222");
    expect(calls).toEqual([ARXIV]);
  });

  it("rejects arXiv's own preprint DOI and falls to CrossRef with the preprint DOI", async () => {
    const preprint = "10.48550/arXiv.1706.03762";
    const { env } = fakeNetwork({ [ARXIV]: feed(preprint), [crossref(preprint)]: related({ type: "doi", id: "10.5555/journal" }) });
    expect(await publishedDoiOf(env, { arxivId: "1706.03762", doi: preprint })).toBe("10.5555/journal");
  });

  it("returns the journal DOI CrossRef relates to an arXiv DOI", async () => {
    const preprint = "10.48550/arXiv.1706.03762";
    const { env, calls } = fakeNetwork({ [crossref(preprint)]: related({ type: "uri", id: "http://x" }, { type: "doi", id: "10.5555/journal" }) });
    expect(await publishedDoiOf(env, { doi: preprint })).toBe("10.5555/journal");
    expect(calls).toEqual([crossref(preprint)]);
  });

  it("returns the journal DOI CrossRef relates to a bioRxiv DOI", async () => {
    const preprint = "10.1101/2020.01.01.123456";
    const { env } = fakeNetwork({ [crossref(preprint)]: related({ type: "doi", id: "10.1016/j.cell.2020.1" }) });
    expect(await publishedDoiOf(env, { doi: preprint })).toBe("10.1016/j.cell.2020.1");
  });

  it("rejects a preprint DOI that CrossRef returns as the related work", async () => {
    const preprint = "10.1101/2020.01.01.123456";
    const { env } = fakeNetwork({ [crossref(preprint)]: related({ type: "doi", id: "10.1101/2020.02.02.654321" }) });
    expect(await publishedDoiOf(env, { doi: preprint })).toBeUndefined();
  });

  it("does not ask CrossRef about a DOI that is not a preprint's", async () => {
    const { env, calls } = fakeNetwork({});
    expect(await publishedDoiOf(env, { doi: "10.1016/j.cell.2020.1" })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("returns undefined when no source records a journal version", async () => {
    const preprint = "10.48550/arXiv.1706.03762";
    const { env } = fakeNetwork({ [ARXIV]: feed(), [crossref(preprint)]: { message: {} } });
    expect(await publishedDoiOf(env, { arxivId: "1706.03762", doi: preprint })).toBeUndefined();
  });

  it("returns undefined when the network is down", async () => {
    const env: RegistryEnv = { fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch };
    expect(await publishedDoiOf(env, { arxivId: "1706.03762", doi: "10.48550/arXiv.1706.03762" })).toBeUndefined();
  });
});
