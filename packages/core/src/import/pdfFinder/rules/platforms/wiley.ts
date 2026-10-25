/** Rules for Wiley Online Library and the society journals it hosts, which serve PDFs at /doi/pdfdirect/<doi>. */
import { createDoiPathRule } from "../doiPathRule.js";
import type { PublisherRule } from "../publisherRule.js";

export const WILEY_RULES: PublisherRule[] = [
  createDoiPathRule({
    platform: "Wiley",
    host: "onlinelibrary.wiley.com",
    // Society journals live on their own subdomain of the same platform.
    hosts: /(^|\.)onlinelibrary\.wiley\.com$/i,
    // 10.1002/10.1111 are Wiley's own; the rest are societies hosted on a subdomain (AGU, Physiological Society, NYAS, ACSESS, ASLO) or on the main host (MJA, Traffic and other Blackwell-era journals).
    prefixes: ["10.1002", "10.1111", "10.1029", "10.1113", "10.1034", "10.1196", "10.2135", "10.2136", "10.4319", "10.5694"],
    pdfPath: "pdfdirect",
    example: "10.1002/jcc.20035",
  }),
];
