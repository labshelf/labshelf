/**
 * The Europe PMC REST API: the PMCID and non-Europe-PMC full-text links. Its own PDF endpoints sit behind a bot
 * check, so PMC copies are left to the PMC resolver. The record is accepted only when its DOI equals the one asked
 * for, because Europe PMC maps some DOIs to an unrelated paper.
 */
import { warn } from "../../env.js";
import { lookupJson } from "../timedFetch.js";
import type { PdfResolver, ResolveContext } from "../../types.js";
import { acceptRecord } from "./acceptRecord.js";
import { learnIds } from "./learnIds.js";

interface EpmcResult {
  pmcid?: string | null;
  doi?: string | null;
  title?: string | null;
  pubYear?: string | null;
  inPMC?: string | null;
  inEPMC?: string | null;
  fullTextUrlList?: { fullTextUrl?: Array<{ documentStyle?: string | null; site?: string | null; url?: string | null }> } | null;
}

const SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export const europePmcResolver: PdfResolver = {
  name: "europepmc",
  async resolve(ctx, env) {
    const query = buildQuery(ctx);
    if (!query) return [];
    const payload = await lookupJson<{ resultList?: { result?: EpmcResult[] } | null }>(
      env,
      `${SEARCH}?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=3`,
    );
    const results = payload?.resultList?.result ?? [];
    const result = results.find((r) => !ctx.doi || (r.doi ?? "").toLowerCase() === ctx.doi.toLowerCase());
    if (!result) {
      if (results.length) warn(env, "no result carries the searched DOI", { query, found: results.map((r) => r.doi ?? null) });
      return [];
    }
    const year = Number(result.pubYear);
    const record = { title: result.title ?? undefined, ...(Number.isNaN(year) || !result.pubYear ? {} : { year }) };
    if (!acceptRecord("europepmc", ctx, env, record)) return [];

    const inPmc = result.inPMC === "Y" || result.inEPMC === "Y";
    learnIds(ctx, { pmcid: inPmc && result.pmcid ? result.pmcid.toUpperCase() : undefined });
    const links = result.fullTextUrlList?.fullTextUrl ?? [];
    const pdfs = links.filter((l) => l.site !== "Europe_PMC" && (l.documentStyle ?? "").toLowerCase() === "pdf" && l.url);
    return [...new Set(pdfs.map((l) => l.url as string))];
  },
};

function buildQuery(ctx: ResolveContext): string | undefined {
  if (ctx.doi) return `DOI:"${ctx.doi}"`;
  if (ctx.pmcid) return `PMCID:${ctx.pmcid.toUpperCase()}`;
  if (ctx.pmid) return `EXT_ID:${ctx.pmid} AND SRC:MED`;
  return undefined;
}
