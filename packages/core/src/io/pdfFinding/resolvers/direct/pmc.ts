/** The PMC open-data bucket on AWS, which serves many PMC PDFs without the bot check that guards pmc.ncbi.nlm.nih.gov. */
import { normalizePmcid } from "../../../identifiers/index.js";
import { lookupText } from "../timedFetch.js";
import type { PdfResolver } from "../../types.js";

const S3_BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com";

export const pmcResolver: PdfResolver = {
  name: "pmc",
  async resolve(ctx, env) {
    const pmcid = normalizePmcid(ctx.pmcid);
    if (!pmcid) return [];
    // The key carries a version, so it is discovered with a cheap listing.
    // The trailing dot in the prefix is required, or "PMC118" also lists "PMC1180...".
    const xml = await lookupText(env, `${S3_BUCKET}/?list-type=2&prefix=${pmcid}.&max-keys=100`);
    const key = xml ? latestPdfKey(xml, pmcid) : undefined;
    return key ? [`${S3_BUCKET}/${key}`] : [];
  },
};

// Keys look like "PMC1182327.2/PMC1182327.2.pdf"; the highest version is the latest.
function latestPdfKey(xml: string, pmcid: string): string | undefined {
  const keys = new RegExp(`<Key>(${pmcid}\\.(\\d+)/${pmcid}\\.\\d+\\.pdf)</Key>`, "g");
  let best: { key: string; version: number } | undefined;
  for (const match of xml.matchAll(keys)) {
    const version = Number(match[2]);
    if (match[1] && (!best || version > best.version)) best = { key: match[1], version };
  }
  return best?.key;
}
