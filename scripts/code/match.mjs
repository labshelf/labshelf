// Clone matching shared by `facts similar` and the dup-guard hook: the function-like units of one source text with their
// fingerprints (parsed alone, no program) and the units of the code-facts database that match a fingerprint.
import { ts } from "../codemods/shared.mjs";
import { jaccard } from "./lib.mjs";
import { unitFingerprint } from "./tokens.mjs";

/** Units with fewer nodes are too small for a clone to mean anything. */
export const MIN_NODES = 10;

const parentOf = (node) => {
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) parent = parent.parent;
  return parent;
};
const propName = (node) =>
  node && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined;
const isUnitNode = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);

// Same naming as the extractor: a class member is `Owner.name`, an object member belongs to the variable holding the object.
function ownerOfMember(node) {
  const parent = node.parent;
  if (parent && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) return parent.name?.text ?? "<class>";
  if (parent && ts.isObjectLiteralExpression(parent)) {
    const holder = parentOf(parent);
    if (holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) return holder.name.text;
    if (holder && ts.isPropertyAssignment(holder)) return propName(holder.name) ?? "<object>";
    return "<object>";
  }
  return "";
}

function nameOf(node) {
  if (ts.isFunctionDeclaration(node)) return { name: node.name?.text ?? "default", owner: "" };
  if (ts.isConstructorDeclaration(node)) return { name: "constructor", owner: ownerOfMember(node) };
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const name = propName(node.name);
    return name ? { name, owner: ownerOfMember(node) } : undefined;
  }
  if (ts.isFunctionExpression(node) && node.name) return { name: node.name.text, owner: "" };
  const parent = parentOf(node);
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return { name: parent.name.text, owner: "" };
  if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
    const name = propName(parent.name);
    return name ? { name, owner: ownerOfMember(parent) } : undefined;
  }
  return undefined;
}

export const labelOf = (unit) => (unit.owner ? `${unit.owner}.${unit.name}` : unit.name);

/**
 * Function-like units of `text` (functions, named arrows, methods as `Owner.method`) with their 1-based line range and
 * fingerprint: `{name, owner, label, startLine, endLine, print}`. Units without a body are left out.
 */
export function unitsOfSource(path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const units = [];
  const visit = (node) => {
    if (isUnitNode(node) && node.body) {
      const named = nameOf(node);
      if (named) units.push({ ...named, label: labelOf(named), startLine: lineOf(node.getStart(sf)), endLine: lineOf(node.end), print: unitFingerprint(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
}

export const shinglesOf = (blob) => (blob ? new Uint32Array(new Uint8Array(blob).buffer) : new Uint32Array());

/** Every unit joined with its fingerprints, `where` being an SQL condition on `u` or `uf`. */
export const unitFactRows = (db, where = "") =>
  db
    .prepare(`SELECT u.*, uf.nodes, uf.t1, uf.t2, uf.body_t1, uf.body_t2, uf.shingles, uf.params, uf.returns, uf.calls FROM units u JOIN unit_facts uf ON uf.id = u.id ${where}`)
    .all();

/**
 * Indexed units of at least `MIN_NODES` nodes that match `print` (`{t1, t2, bodyT1, bodyT2, shingles}`), exact T1/T2 hits first,
 * then by 4-shingle Jaccard: `{unit, exact: "T1"|"T2"|"", similarity, sameName}`. `excludeFile` skips a whole file, `excludeId` one
 * unit; `name` (a unit label) marks the hits carrying it.
 */
export function matchPrint(db, print, { excludeFile, excludeId, name } = {}) {
  const hits = [];
  const where = `WHERE uf.nodes >= ${MIN_NODES}${excludeFile ? " AND u.file <> ?" : ""}`;
  const rows = db.prepare(`SELECT u.*, uf.nodes, uf.t1, uf.t2, uf.body_t1, uf.body_t2, uf.shingles FROM units u JOIN unit_facts uf ON uf.id = u.id ${where}`).all(...(excludeFile ? [excludeFile] : []));
  for (const unit of rows) {
    if (unit.id === excludeId) continue;
    const exact = unit.t1 === print.t1 || unit.body_t1 === print.bodyT1 ? "T1" : unit.t2 === print.t2 || unit.body_t2 === print.bodyT2 ? "T2" : "";
    const similarity = jaccard(print.shingles, shinglesOf(unit.shingles));
    if (exact || similarity > 0) hits.push({ unit, exact, similarity, sameName: Boolean(name) && labelOf(unit) === name });
  }
  hits.sort((a, b) => Number(Boolean(b.exact)) - Number(Boolean(a.exact)) || b.similarity - a.similarity);
  return hits;
}
