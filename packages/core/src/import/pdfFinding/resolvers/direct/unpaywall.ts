/** Unpaywall's legal open-access copies (publisher, repository, preprint server) for a DOI. */
import { lookupJson } from "../timedFetch.js";
import type { PdfResolver } from "../../types.js";

interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url?: string | null;
  host_type?: string | null;
}

interface UnpaywallResponse {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

const HOST_RANK: Record<string, number> = { publisher: 2, repository: 1 };

export const unpaywallResolver: PdfResolver = {
  name: "unpaywall",
  async resolve(ctx, env) {
    if (!ctx.doi) return [];
    const payload = await lookupJson<UnpaywallResponse>(
      env,
      `https://api.unpaywall.org/v2/${encodeURIComponent(ctx.doi)}?email=${encodeURIComponent(ctx.contactEmail)}`,
    );
    if (!payload) return [];
    const out: string[] = [];
    if (payload.best_oa_location?.url_for_pdf) out.push(payload.best_oa_location.url_for_pdf);
    const others = [...(payload.oa_locations ?? [])].sort((a, b) => hostRank(b) - hostRank(a));
    for (const loc of others) {
      if (loc.url_for_pdf) out.push(loc.url_for_pdf);
      else if (loc.url && /\.pdf(?:[?#]|$)/i.test(loc.url)) out.push(loc.url);
    }
    return [...new Set(out)];
  },
};

function hostRank(location: UnpaywallLocation): number {
  return HOST_RANK[(location.host_type ?? "").toLowerCase()] ?? 0;
}
