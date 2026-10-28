// `plan stubs <session> <id>`: writes a throwing stub for every seam of a spec whose symbol is missing; never touches an existing symbol.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findSpec } from "./planFiles.mjs";

const SEAM = /^export\s+(?:default\s+)?(async\s+)?(function|class|type|interface)\s*\*?\s*([A-Za-z_$][\w$]*)/;

/** Parses a seam signature into `{ kind, name }` (`kind`: function, class, type, interface); throws on any other form. */
export function parseSeam(seam) {
  const match = seam.signature.match(SEAM);
  if (!match) throw new Error(`seam ${seam.path}: unsupported signature "${seam.signature}" (expected export [async] function, class, type or interface)`);
  return { kind: match[2], name: match[3] };
}

const mentions = (source, name) => {
  const escaped = name.replace(/[$]/g, "\\$&");
  return new RegExp(`\\b(?:function|class|const|let|var|type|interface|enum)\\s*\\*?\\s*${escaped}\\b|export\\s*\\{[^}]*\\b${escaped}\\b`).test(source);
};

/** Source of the stub for one seam of spec `specId`: functions throw `not implemented: <id>`, a class throws in its constructor, types are declared as given. */
export function stubSource(seam, specId) {
  const { kind } = parseSeam(seam);
  const signature = seam.signature.trim().replace(/;$/, "");
  const fail = `throw new Error("not implemented: ${specId}");`;
  if (kind === "function") return `${signature} { ${fail} }`;
  if (kind === "class") return `${signature} {\n  constructor() { ${fail} }\n}`;
  return /[};]$/.test(signature) ? signature : `${signature};`;
}

/** Repo-relative paths of the files the seams of a spec live in (no duplicates). */
export const seamPaths = (spec) => [...new Set((spec.seams ?? []).map((seam) => seam.path))];

/** Writes the stubs of `spec` under `root`; returns `{ created, appended }` (repo-relative paths). */
export function writeStubs(root, spec) {
  const created = [];
  const appended = [];
  for (const seam of spec.seams ?? []) {
    const { name } = parseSeam(seam);
    const file = join(root, seam.path);
    const exists = existsSync(file);
    const source = exists ? readFileSync(file, "utf8") : "";
    if (exists && mentions(source, name)) continue;
    const stub = stubSource(seam, spec.id);
    if (!exists) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${stub}\n`);
      created.push(seam.path);
      continue;
    }
    writeFileSync(file, `${source}${source === "" || source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n"}${stub}\n`);
    if (!created.includes(seam.path) && !appended.includes(seam.path)) appended.push(seam.path);
  }
  return { created, appended };
}

export function planStubs(root, { planDir, sessionId, specId }) {
  return writeStubs(root, findSpec(planDir, sessionId, specId));
}
