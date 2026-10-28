// Normalized token streams of a function or a pasted snippet for clone matching: T1/T2 hashes of the whole unit and of
// its body alone, and 4-shingles of the stream with every local flattened to `$` (after the analysis clone scripts).
import { createHash } from "node:crypto";
import { ts } from "../codemods/shared.mjs";
import { shingleSet } from "./lib.mjs";

function collectBindingNames(name, out) {
  if (ts.isIdentifier(name)) out.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
    for (const element of name.elements) if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, out);
}

/** Names declared inside `nodes` (parameters, variables, inner functions and classes, catch bindings), `self` excluded. */
function declaredNames(nodes, self) {
  const out = new Set();
  const visit = (node) => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) collectBindingNames(node.name, out);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && node !== self) out.add(node.name.text);
    else if (ts.isCatchClause(node) && node.variableDeclaration) collectBindingNames(node.variableDeclaration.name, out);
    ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return out;
}

function isPropertyNamePosition(id) {
  const parent = id.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true;
  const named = [ts.isPropertyAssignment, ts.isMethodDeclaration, ts.isPropertyDeclaration, ts.isPropertySignature, ts.isGetAccessorDeclaration, ts.isSetAccessorDeclaration, ts.isMethodSignature, ts.isEnumMember];
  if (named.some((is) => is(parent)) && parent.name === id) return true;
  // Shorthand `{ x }` names a property too, so renaming it would hide a different key.
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return true;
  return ts.isQualifiedName(parent) && parent.right === id;
}

const isLiteral = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isNumericLiteral(node) ||
  ts.isRegularExpressionLiteral(node) ||
  ts.isBigIntLiteral(node) ||
  node.kind === ts.SyntaxKind.TemplateHead ||
  node.kind === ts.SyntaxKind.TemplateMiddle ||
  node.kind === ts.SyntaxKind.TemplateTail;

/**
 * Token stream without comments, whitespace, parentheses, types or decorators. `rename` true numbers locals $0, $1…
 * (T2); "flat" makes them all `$`. `uses`, when given, counts per identifier how often it is local and how often free.
 */
export function tokenStream(nodes, locals, rename, uses) {
  const toks = [];
  const numbers = new Map();
  let count = 0;
  const visit = (node) => {
    if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node) || node.kind === ts.SyntaxKind.Decorator) return;
    if (node.kind !== ts.SyntaxKind.ParenthesizedExpression) {
      count++;
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        const local = locals.has(node.text) && !isPropertyNamePosition(node);
        if (uses && !isPropertyNamePosition(node)) {
          const entry = uses.get(node.text) ?? [0, 0];
          entry[local ? 0 : 1]++;
          uses.set(node.text, entry);
        }
        if (rename && local) {
          if (!numbers.has(node.text)) numbers.set(node.text, `$${numbers.size}`);
          toks.push(rename === "flat" ? "$" : numbers.get(node.text));
        } else toks.push(`#${node.text}`);
      } else if (isLiteral(node)) toks.push(`'${node.text}`);
      else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) toks.push(`${node.kind}:${node.operator}`);
      else toks.push(String(node.kind));
    }
    ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return { toks, count };
}

const sha = (toks) => createHash("sha1").update(toks.join(" ")).digest("hex").slice(0, 16);

function fingerprintOf(parts, bodyParts, locals, uses) {
  const t1 = tokenStream(parts, locals, false);
  return {
    nodes: t1.count,
    t1: sha(t1.toks),
    t2: sha(tokenStream(parts, locals, true).toks),
    bodyT1: sha(tokenStream(bodyParts, locals, false).toks),
    bodyT2: sha(tokenStream(bodyParts, locals, true).toks),
    shingles: shingleSet(tokenStream(parts, locals, "flat", uses).toks),
  };
}

const bodyOf = (unit) => (!unit.body ? [] : ts.isBlock(unit.body) ? [...unit.body.statements] : [unit.body]);

/** Fingerprints of a function node with a body: node count, T1/T2 of parameters and body, of the body alone, flat shingles. */
export const unitFingerprint = (unit, uses) => {
  const parts = [...unit.parameters, unit.body];
  return fingerprintOf(parts, bodyOf(unit), declaredNames(parts, unit), uses);
};

/**
 * Fingerprints of pasted code. A lone function is taken as a unit; otherwise its statements are a body, and a name it
 * uses without declaring counts as local when `isLocalName(name)` says so (callers ask how the codebase uses the name).
 */
export function snippetFingerprint(text, isLocalName) {
  const sf = ts.createSourceFile("snippet.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const only = sf.statements.length === 1 ? sf.statements[0] : undefined;
  let unit = only && ts.isFunctionDeclaration(only) ? only : undefined;
  if (only && ts.isVariableStatement(only)) {
    let init = only.declarationList.declarations[0]?.initializer;
    while (init && ts.isParenthesizedExpression(init)) init = init.expression;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) unit = init;
  }
  if (unit?.body) return unitFingerprint(unit);
  const statements = [...sf.statements];
  const locals = declaredNames(statements);
  const visit = (node) => {
    if (ts.isIdentifier(node) && !isPropertyNamePosition(node) && !locals.has(node.text) && isLocalName(node.text)) locals.add(node.text);
    ts.forEachChild(node, visit);
  };
  statements.forEach(visit);
  return fingerprintOf(statements, statements, locals);
}
