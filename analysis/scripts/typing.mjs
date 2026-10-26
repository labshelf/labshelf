// Classifies every row of `values` into a fine domain concept (table value_concepts) for analysis/typing.md.
// The classification is a judgement: names decide where they name a concept (paperId), the domain folder decides for
// bare names (id, path, file, key, root, url). `basis` records which: 'name' or 'domain'.
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./lib.mjs";

const db = new DatabaseSync(DB_PATH);
db.exec(`DROP TABLE IF EXISTS value_concepts;
CREATE TABLE value_concepts (value_id INTEGER PRIMARY KEY, fine TEXT, basis TEXT, collection INTEGER);`);

const dom = (file) => file.split("/src/")[1].split("/")[0];

// Ordered: first match wins. Patterns run on the lower-cased name without leading underscores.
const BY_NAME = [
  [/^(paper|excludepaper|openedpaper|selectedpaper)ids?$|^paperidatpath$|^paperids$/, "paperId"],
  [/^(cite|cited)keys?$/, "citeKey"],
  [/^projectids?$/, "projectId"],
  [/^spaceids?$/, "spaceId"],
  [/^shareids?$|^sharedid$/, "shareId"],
  [/^(sharekey|contentkey|awarenesskey|armoredkeys|shelfkeys)$|^linkkey$/, "cryptoKey"],
  [/^(tab|pagetab|sendertab)id$/, "tabId"],
  [/^threadid$/, "threadId"],
  [/^libraryid$/, "libraryId"],
  [/^(docid|bydocid)$/, "docId"],
  [/^_?dockey$/, "docKey"],
  [/^workid$/, "workId"],
  [/^arxiv(id)?$/, "arxivId"],
  [/^doi$/, "doi"],
  [/^folderid$/, "folderId"],
  [/^(dateid|termid)$/, "spaceItemId"],
  [/^templateid$/, "templateId"],
  [/^(client|account|device|host|member|group|request|annotation|heading|model|embeddingmodel|kvnamespace|offer|source|new|next|existing|parent|picked|opened|selected|to|local|joined|taken|open|memberid)id$|^(takenids|ids|fontids|externalids|requesti?d|rowbyid|byid)$/, "otherId"],
  [/(token|refreshtoken|accesstoken)$/, "token"],
  [/hash$|^sha$|^etag$/, "hash"],
  [/^(contact)?email$/, "email"],
  [/^isbn$/, "isbn"],
  [/^slug$/, "slug"],
  [/^(relayurls?)$/, "relayUrl"],
  [/webview(url|uri)$|^(extensionuri|styleuri|scripturi|scripturl)$|uri$/, "webviewUri"],
  [/^datauri$/, "dataUri"],
  [/(wasm|cmap|icc|standardfont|pdfjs|viewer|viewercss|worker|handler)url$|^stdfonturl$|^styleurl$/, "assetUrl"],
  [/url$|urls$/, "webUrl"],
  [/^(relativepath|relpath|relfolder)$/, "relativePath"],
  [/^(libraryroot|papersroot|_papersroot|getpapersroot|templatesroot|logsroot|realroot|rootpath|shownroot|texroot|chooseroot|projectroot|isroot)$/, "rootDir"],
  [/(buildroot|root)$/, "rootDir"],
  [/dirs?$|dirname$|^dirpath$|^_dirpath$/, "dirPath"],
  [/folder$|folders$|^relfolder$|folderpath$/, "folderPath"],
  [/path$|paths$|file$|files$/, "filePath"],
  [/name$/, "displayName"],
  [/key$|keys$/, "otherKey"],
  [/id$|ids$/, "otherId"],
];

// Bare names: the domain folder decides.
function bare(name, file, pkg, type) {
  const d = dom(file);
  if (name === "id" || name === "ids") {
    if (["libraryUi", "library", "reader", "import", "model", "qmd", "ai", "bridge"].includes(d)) return "paperId?";
    if (d === "spaces") return "spaceId/itemId?";
    if (d === "writing" || d === "templates") return "projectId?";
    if (d === "collab" || d === "relay" || d === "share") return "shareId/peerId?";
    return "id(unspecified)";
  }
  if (name === "key" || name === "keys") {
    if (["writing", "collab", "storage", "helper"].includes(d)) return "storageKey?";
    if (d === "libraryUi" || d === "library" || d === "reader" || d === "qmd") return "citeKey/mapKey?";
    return "key(unspecified)";
  }
  if (name === "url") return type.includes("Uri") ? "webviewUri" : "webUrl";
  if (name === "path" || name === "paths" || name === "file" || name === "files") {
    if (/\bFile\b|Blob|FileSystemFileHandle|TFile/.test(type)) return "fileObject";
    if (pkg === "vscode") return "filePath(abs?)";
    if (d === "libraryUi" || d === "library") return "libraryRelPath?";
    if (d === "writing" || d === "collab" || d === "latex" || d === "typst") return "projectRelPath?";
    return "filePath(unspecified)";
  }
  if (name === "root") return /string/.test(type) ? "rootDir" : "domRoot";
  if (name === "dir") return "dirPath";
  return null;
}

const rows = db.prepare(`SELECT id, name, concept, file, package, type, is_primitive FROM "values"`).all();
const ins = db.prepare(`INSERT INTO value_concepts VALUES (?,?,?,?)`);
db.exec("BEGIN");
for (const r of rows) {
  const n = r.name.toLowerCase().replace(/^_+/, "");
  const collection = /\[\]|Set<|Map<|Array<|Record<|readonly /.test(r.type) ? 1 : 0;
  let fine = null, basis = "name";
  const b = bare(n, r.file, r.package, r.type);
  if (b) { fine = b; basis = "domain"; }
  else for (const [re, f] of BY_NAME) if (re.test(n)) { fine = f; break; }
  ins.run(r.id, fine ?? `other:${r.concept}`, basis, collection);
}
db.exec("COMMIT");
console.log(db.prepare("SELECT fine, COUNT(*) c FROM value_concepts GROUP BY 1 ORDER BY 2 DESC").all().map((x) => `${x.fine}:${x.c}`).join(" "));
