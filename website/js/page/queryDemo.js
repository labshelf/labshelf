// The query playground on the Organize page: six papers filtered as you type, with the grammar of core's parseQuery ported line for line.

import { h } from "../dom.js";

const PAPERS = [
  { key: "vaswani2017attention", title: "Attention is all you need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017, venue: "NeurIPS", status: "done", tags: ["nlp", "classic", "to-cite"], keywords: ["attention", "transformer"], pdf: true, doi: true, note: "Read 3.2 again before the talk." },
  { key: "devlin2019bert", title: "BERT: pre-training of deep bidirectional transformers for language understanding", authors: ["Jacob Devlin", "Ming-Wei Chang"], year: 2019, venue: "NAACL", status: "reading", tags: ["nlp"], keywords: ["language model", "pre-training"], pdf: true, doi: true },
  { key: "kleppmann2019local", title: "Local-first software: you own your data, in spite of the cloud", authors: ["Martin Kleppmann", "Adam Wiggins"], year: 2019, venue: "Onward!", status: "done", tags: ["systems"], keywords: ["CRDT", "local-first"], pdf: true, doi: true, note: "The test: delete the app and keep everything." },
  { key: "he2016deep", title: "Deep residual learning for image recognition", authors: ["Kaiming He", "Xiangyu Zhang"], year: 2016, venue: "CVPR", status: "unread", tags: ["vision", "classic"], keywords: ["residual networks", "image recognition"], pdf: true, doi: true },
  { key: "ouyang2022training", title: "Training language models to follow instructions with human feedback", authors: ["Long Ouyang", "Jeff Wu"], year: 2022, venue: "NeurIPS", status: "unread", tags: ["nlp", "rlhf"], keywords: ["RLHF", "alignment"], pdf: false, doi: false },
  { key: "bommasani2021opportunities", title: "On the opportunities and risks of foundation models", authors: ["Rishi Bommasani", "Percy Liang"], year: 2021, venue: "arXiv", status: "unread", tags: ["nlp", "survey"], keywords: ["foundation models"], pdf: true, doi: false },
];
const EXAMPLES = ["#nlp", "year:2015..2020", "is:unread -survey", "author:kleppmann", "has:note", '"foundation models"'];

const TAG_KEYS = new Set(["tag", "t"]);
const STATUS_KEYS = new Set(["status", "is", "s"]);
const YEAR_KEYS = new Set(["year", "y"]);
const FIELDS = new Map([["author", "authors"], ["au", "authors"], ["a", "authors"], ["kw", "keywords"], ["keyword", "keywords"], ["venue", "venue"], ["journal", "venue"], ["note", "note"], ["key", "key"], ["abstract", "abstract"]]);
const STATUSES = new Map([["u", "unread"], ["unread", "unread"], ["new", "unread"], ["r", "reading"], ["reading", "reading"], ["d", "done"], ["done", "done"], ["read", "done"]]);
const HAS = new Map([["pdf", "pdf"], ["note", "note"], ["notes", "note"], ["doi", "doi"], ["tag", "tags"], ["tags", "tags"], ["abstract", "abstract"], ["summary", "abstract"]]);

const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A `-` or `key:` prefix stays in front of a quoted phrase, and an unterminated quote runs to the end. */
function tokenize(text) {
  const tokens = [];
  for (const m of text.matchAll(/(-?[\w:#.<>=-]*?)"([^"]*)"?|(\S+)/gu)) tokens.push(m[3] ?? (m[1] ?? "") + (m[2] ?? ""));
  return tokens.filter(Boolean);
}

function yearBounds(value) {
  const range = /^(\d{4})?\.\.(\d{4})?$/.exec(value);
  if (range) return { min: range[1] ? Number(range[1]) : undefined, max: range[2] ? Number(range[2]) : undefined };
  const cmp = /^([<>]=?)(\d{4})$/.exec(value);
  if (cmp) {
    const y = Number(cmp[2]);
    return cmp[1] === ">" ? { min: y + 1 } : cmp[1] === ">=" ? { min: y } : cmp[1] === "<" ? { max: y - 1 } : { max: y };
  }
  return /^\d{4}$/.test(value) ? { min: Number(value), max: Number(value) } : undefined;
}

/** A known key with an empty value is dropped, so a half-typed `author:` hides nothing; one with an unreadable value stays a plain term. */
function operator(token, q) {
  if (token.startsWith("#") && token.length > 1) { q.tags.push(fold(token.slice(1))); return true; }
  const colon = token.indexOf(":");
  if (colon <= 0) return false;
  const key = token.slice(0, colon).toLowerCase();
  const value = token.slice(colon + 1);
  const known = TAG_KEYS.has(key) || STATUS_KEYS.has(key) || YEAR_KEYS.has(key) || key === "has" || key === "no" || FIELDS.has(key);
  if (!known) return false;
  if (!value) return true;
  const lower = value.toLowerCase();
  if (TAG_KEYS.has(key)) { q.tags.push(fold(value)); return true; }
  if (FIELDS.has(key)) { q.fields.push([FIELDS.get(key), fold(value)]); return true; }
  if (STATUS_KEYS.has(key) && STATUSES.has(lower)) { q.statuses.push(STATUSES.get(lower)); return true; }
  if (YEAR_KEYS.has(key)) {
    const bounds = yearBounds(value);
    if (!bounds) return false;
    if (bounds.min !== undefined) q.yearMin = bounds.min;
    if (bounds.max !== undefined) q.yearMax = bounds.max;
    return true;
  }
  if ((key === "has" || key === "no") && HAS.has(lower)) { (key === "has" ? q.has : q.missing).push(HAS.get(lower)); return true; }
  return false;
}

function parse(text) {
  const q = { terms: [], excluded: [], tags: [], fields: [], statuses: [], has: [], missing: [] };
  for (const token of tokenize(text)) {
    if (operator(token, q)) continue;
    if (token.startsWith("-") && token.length > 1) q.excluded.push(fold(token.slice(1)));
    else q.terms.push(fold(token));
  }
  return q;
}

function doc(p) {
  return {
    authors: fold(p.authors.join("; ")), keywords: fold(p.keywords.join("; ")), venue: fold(p.venue), note: fold(p.note ?? ""),
    key: fold(p.key), abstract: "", tags: p.tags.map(fold),
    all: fold([p.title, ...p.authors, p.venue, p.key, p.note ?? "", String(p.year), ...p.keywords, ...p.tags].join("\n")),
  };
}

const has = (p, what) => ({ pdf: p.pdf, note: Boolean(p.note), doi: p.doi, tags: p.tags.length > 0, abstract: false })[what];

function matches(p, d, q) {
  if (q.statuses.length && !q.statuses.includes(p.status)) return false;
  if (q.yearMin !== undefined && p.year < q.yearMin) return false;
  if (q.yearMax !== undefined && p.year > q.yearMax) return false;
  if (q.tags.some((tag) => !d.tags.some((t) => t.startsWith(tag)))) return false;
  if (q.fields.some(([field, value]) => !d[field].includes(value))) return false;
  if (q.has.some((w) => !has(p, w)) || q.missing.some((w) => has(p, w))) return false;
  if (q.excluded.some((term) => d.all.includes(term))) return false;
  return q.terms.every((term) => d.all.includes(term));
}

function row(p) {
  return h("li", { class: "lib-row" },
    h("span", { class: "dot", "data-status": p.status, role: "img", "aria-label": p.status }),
    h("span", { class: "t" }, p.title, h("span", { class: "m" }, `${p.authors[0].split(" ").pop()} ${p.year}`)),
    h("span", { class: "tags" }, p.tags.map((t) => `#${t}`).join(" ")),
  );
}

export function initQueryDemo() {
  const root = document.getElementById("library-demo");
  if (!root) return;
  const docs = PAPERS.map(doc);
  const rows = PAPERS.map(row);
  const input = h("input", { class: "lib-input", type: "text", placeholder: "type a query", "aria-label": "Query", autocomplete: "off", spellcheck: "false" });
  const count = h("span", { class: "lib-count", "aria-live": "polite" });
  const empty = h("p", { class: "lib-empty", hidden: true }, "No paper matches. Clear the query, or try one below.");
  const apply = () => {
    const q = parse(input.value);
    let shown = 0;
    PAPERS.forEach((p, i) => { const hit = matches(p, docs[i], q); rows[i].hidden = !hit; if (hit) shown++; });
    count.textContent = `${shown} of ${PAPERS.length} papers`;
    empty.hidden = shown > 0;
  };
  const examples = h("p", { class: "lib-examples" }, "Try:", EXAMPLES.map((q) => h("button", { type: "button", onclick: () => { input.value = q; apply(); input.focus(); } }, q)));
  input.addEventListener("input", apply);
  root.append(h("div", { class: "lib-prompt" }, h("span", { class: "pr", "aria-hidden": "true" }, ">"), input, count), h("ul", { class: "lib-rows", "aria-label": "Papers" }, rows), empty, examples);
  apply();
}
