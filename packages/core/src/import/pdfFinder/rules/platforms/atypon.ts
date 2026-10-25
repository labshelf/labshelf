/** Rules for journals hosted on Atypon's Literatum, which serves PDFs at /doi/pdf/<doi>. */
import { createDoiPathRule } from "../createDoiPathRule.js";
import type { PublisherRule } from "../publisherRule.js";

export const ATYPON_RULES: PublisherRule[] = [
  createDoiPathRule({ platform: "ACM", host: "dl.acm.org", prefixes: ["10.1145"], example: "10.1145/3065386" }),
  createDoiPathRule({ platform: "SIAM", host: "epubs.siam.org", prefixes: ["10.1137"], example: "10.1137/S0036144598347011" }),
  createDoiPathRule({ platform: "Taylor & Francis", host: "www.tandfonline.com", prefixes: ["10.1080"], example: "10.1080/01621459.1958.10501452" }),
  createDoiPathRule({ platform: "SAGE", host: "journals.sagepub.com", prefixes: ["10.1177", "10.1089"], example: "10.1177/0956797611417632" }),
  createDoiPathRule({ platform: "PNAS", host: "www.pnas.org", hosts: /(^|\.)pnas\.org$/i, prefixes: ["10.1073"], example: "10.1073/pnas.79.8.2554" }),
  createDoiPathRule({ platform: "Science", host: "www.science.org", prefixes: ["10.1126"], example: "10.1126/science.aac4716" }),
  createDoiPathRule({ platform: "ACS", host: "pubs.acs.org", prefixes: ["10.1021"], example: "10.1021/ja809598r" }),
  createDoiPathRule({ platform: "Annual Reviews", host: "www.annualreviews.org", prefixes: ["10.1146"], example: "10.1146/annurev.neuro.24.1.167" }),
  createDoiPathRule({ platform: "INFORMS", host: "pubsonline.informs.org", prefixes: ["10.1287"], example: "10.1287/mnsc.35.8.982" }),
  createDoiPathRule({ platform: "NEJM", host: "www.nejm.org", prefixes: ["10.1056"], example: "10.1056/NEJMoa2034577" }),
  createDoiPathRule({ platform: "AIAA", host: "arc.aiaa.org", prefixes: ["10.2514"], example: "10.2514/3.20031" }),
  createDoiPathRule({ platform: "ASCE", host: "ascelibrary.org", prefixes: ["10.1061"], example: "10.1061/(ASCE)0733-9445(2008)134:1(1)" }),
  createDoiPathRule({ platform: "ASM", host: "journals.asm.org", prefixes: ["10.1128"], example: "10.1128/mr.59.1.143-169.1995", query: "?download=true" }),
  createDoiPathRule({ platform: "World Scientific", host: "www.worldscientific.com", prefixes: ["10.1142"], example: "10.1142/S0129054101000540", query: "?download=true" }),
  createDoiPathRule({ platform: "AHA Journals", host: "www.ahajournals.org", prefixes: ["10.1161"], example: "10.1161/CIR.0000000000000485" }),
  // The physiology.org apex and www redirect to journals.physiology.org.
  createDoiPathRule({
    platform: "American Physiological Society",
    host: "journals.physiology.org",
    hosts: /(^|\.)physiology\.org$/i,
    prefixes: ["10.1152"],
    example: "10.1152/jn.00001.2020",
  }),
  createDoiPathRule({ platform: "Psychiatry Online", host: "psychiatryonline.org", prefixes: ["10.1176"], example: "10.1176/ajp.156.1.1" }),
  createDoiPathRule({ platform: "ASHA", host: "pubs.asha.org", prefixes: ["10.1044"], example: "10.1044/jshr.2504.628" }),
  createDoiPathRule({
    platform: "University of Chicago Press",
    host: "www.journals.uchicago.edu",
    hosts: /(^|\.)journals\.uchicago\.edu$/i,
    prefixes: ["10.1086"],
    example: "10.1086/723495",
  }),
  createDoiPathRule({ platform: "ASCO", host: "ascopubs.org", prefixes: ["10.1200"], example: "10.1200/JCO.1986.4.6.906" }),
  createDoiPathRule({ platform: "Canadian Science Publishing", host: "cdnsciencepub.com", prefixes: ["10.1139"], example: "10.1139/v82-208" }),
  createDoiPathRule({ platform: "Hogrefe", host: "econtent.hogrefe.com", prefixes: ["10.1027"], example: "10.1027/1015-5759.12.3.175" }),
];
