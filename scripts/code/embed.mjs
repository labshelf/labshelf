// Embeds files, modules, exports and every unit (private included) with a local model into the code-facts database, reusing stored vectors by text hash, and ranks items by cosine and fused rank for search.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, FACTS_DIR, splitWords } from "./lib.mjs";

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
const MODEL_DIR = join(FACTS_DIR, "models");
const BATCH = 32;
const MAX_EXPORT_NAMES = 40;
const MAX_UNIT_CHARS = 600;

const hashOf = (text) => createHash("sha1").update(text).digest("hex");
const toBlob = (vector) => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
const fromBlob = (blob) => new Float32Array(new Uint8Array(blob).buffer);

/** Loads the model and returns `embed(texts) -> Float32Array[]`, or null after one warning when it cannot load (offline, missing cache). */
export async function loadEmbedder(warn) {
  try {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = MODEL_DIR;
    const extractor = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
    return async (texts) => {
      const result = await extractor(texts, { pooling: "mean", normalize: true });
      const dim = result.dims[1];
      return texts.map((_, i) => Float32Array.from(result.data.subarray(i * dim, (i + 1) * dim)));
    };
  } catch (error) {
    warn(`facts: embedding model ${EMBED_MODEL} could not load (${String(error?.message ?? error).split("\n")[0]}); continuing without embeddings`);
    return null;
  }
}

/** The text each item is embedded from; the same row always gives the same text, so its hash is a stable cache key. */
export function itemsOf(db) {
  const items = [];
  const headers = new Map(db.prepare("SELECT path, header FROM files").all().map((row) => [row.path, row.header ?? ""]));
  // A header says what the file is for; the documented units say what it does, which is what a question usually names.
  const unitDocs = new Map();
  for (const unit of db.prepare("SELECT file, name, doc FROM units WHERE doc <> '' ORDER BY file, start_line").all()) {
    unitDocs.set(unit.file, `${unitDocs.get(unit.file) ?? ""} ${unit.name}: ${unit.doc}`);
  }
  for (const file of db.prepare("SELECT path, header FROM files ORDER BY path").all()) {
    const docs = (unitDocs.get(file.path) ?? "").trim().slice(0, MAX_UNIT_CHARS);
    items.push({ kind: "file", ref: file.path, text: `${file.path} (${splitWords(file.path)})\n${file.header ?? ""}\n${docs}` });
  }
  const names = db.prepare("SELECT module, group_concat(name, ' ') AS names FROM (SELECT module, name FROM exports ORDER BY file, line) GROUP BY module").all();
  const namesOf = new Map(names.map((row) => [row.module, row.names.split(" ").slice(0, MAX_EXPORT_NAMES).join(" ")]));
  for (const mod of db.prepare("SELECT path, purpose FROM modules ORDER BY path").all()) {
    items.push({ kind: "module", ref: mod.path, text: `${mod.path}\n${mod.purpose ?? ""}\nexports: ${namesOf.get(mod.path) ?? ""}` });
  }
  for (const item of db.prepare("SELECT name, signature, doc, file, line FROM exports ORDER BY file, line, name").all()) {
    items.push({ kind: "export", ref: `${item.file}:${item.line}`, text: `${item.name} ${item.signature ?? ""}\n${item.doc ?? ""}\n${headers.get(item.file) ?? ""}` });
  }
  // Every unit, private helpers included, from the same text `facts fn` searches: name, types, calls, comment, strings, file header.
  for (const unit of db.prepare("SELECT u.file, u.start_line, f.embed_text FROM units u JOIN unit_facts f ON f.id = u.id ORDER BY u.file, u.start_line").all()) {
    items.push({ kind: "unit", ref: `${unit.file}:${unit.start_line}`, text: unit.embed_text });
  }
  return items.map((item) => ({ ...item, hash: hashOf(item.text) }));
}

function storedVectors(path) {
  const stored = new Map();
  if (!existsSync(path)) return stored;
  try {
    const previous = new DatabaseSync(path, { readOnly: true });
    for (const row of previous.prepare("SELECT text_hash, vector FROM embeddings WHERE model = ?").all(EMBED_MODEL)) stored.set(row.text_hash, row.vector);
    previous.close();
  } catch {
    // A database from an older schema has no embeddings table; everything is embedded again.
  }
  return stored;
}

/** Fills embed_items and embeddings in `db`; vectors already in the previous database are copied, only new texts reach the model. Returns the number embedded. */
export async function buildEmbeddings(db, { say, warn }) {
  const items = itemsOf(db);
  const stored = storedVectors(DB_PATH);
  const unique = new Map(items.map((item) => [item.hash, item.text]));
  const missing = [...unique].filter(([hash]) => !stored.has(hash));
  const vectors = new Map();
  let embedded = 0;
  if (missing.length > 0) {
    say(`facts: embedding ${missing.length} of ${items.length} items`);
    const embed = await loadEmbedder(warn);
    if (embed) {
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const result = await embed(batch.map(([, text]) => text));
        batch.forEach(([hash], index) => vectors.set(hash, result[index]));
      }
      embedded = missing.length;
    }
  }
  const insertItem = db.prepare("INSERT INTO embed_items VALUES (?,?,?)");
  const insertVector = db.prepare("INSERT OR IGNORE INTO embeddings VALUES (?,?,?)");
  db.exec("BEGIN");
  for (const hash of unique.keys()) {
    const vector = vectors.has(hash) ? toBlob(vectors.get(hash)) : stored.get(hash);
    if (vector) insertVector.run(hash, EMBED_MODEL, vector);
  }
  for (const item of items) insertItem.run(item.kind, item.ref, item.hash);
  db.exec("COMMIT");
  return { embedded, total: items.length };
}

/** The question as a unit vector, or null after one warning when the model cannot load. */
export async function embedQuery(question, warn) {
  const embed = await loadEmbedder(warn);
  return embed ? (await embed([question]))[0] : null;
}

const dot = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

/** Items closest to `query` by cosine (vectors are normalized, so a dot product), best first, one entry per kind and ref. */
export function cosineRanking(db, query, limit) {
  const rows = db
    .prepare("SELECT i.kind, i.ref, e.vector FROM embed_items i JOIN embeddings e ON e.text_hash = i.text_hash AND e.model = ?")
    .all(EMBED_MODEL);
  const best = new Map();
  for (const row of rows) {
    const score = dot(query, fromBlob(row.vector));
    const key = `${row.kind}\0${row.ref}`;
    if (!best.has(key) || best.get(key).score < score) best.set(key, { kind: row.kind, ref: row.ref, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Reciprocal-rank fusion: an item scores 1/(k + rank) in each list it appears in; lists hold { kind, ref } best first. */
export function fuse(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((item, index) => {
      const key = `${item.kind}\0${item.ref}`;
      const entry = scores.get(key) ?? { kind: item.kind, ref: item.ref, score: 0 };
      entry.score += 1 / (k + index + 1);
      scores.set(key, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
