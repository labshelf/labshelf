// Syntactic helpers shared by the analysis scripts: the TypeScript loader, what counts as a unit, and the normalized
// token stream that the T1/T2 hashes and the near-clone shingles are computed from.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DB_PATH = join(ROOT, "analysis", "labshelf.db");

// TypeScript 7 (tsgo) has no JS compiler API, so the scripts load the 5.x/6.x copy pnpm keeps for typescript-eslint.
export function loadTypeScript() {
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  const dir = readdirSync(pnpm).filter((d) => /^typescript@[56]\./.test(d)).sort().pop();
  if (!dir) throw new Error("typescript 5/6 with the JS compiler API not found in node_modules/.pnpm");
  return createRequire(import.meta.url)(join(pnpm, dir, "node_modules", "typescript"));
}
const ts = loadTypeScript();

export const isUnitNode = (n) =>
  (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n)) && n.body !== undefined;

function collectBindingNames(name, out) {
  if (ts.isIdentifier(name)) out.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
    for (const el of name.elements) if (!ts.isOmittedExpression(el)) collectBindingNames(el.name, out);
}

// Names a unit declares itself (parameters, variables, inner functions and classes, catch bindings).
export function localNames(unit) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) collectBindingNames(n.name, out);
    else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name && n !== unit) out.add(n.name.text);
    else if (ts.isCatchClause(n) && n.variableDeclaration) collectBindingNames(n.variableDeclaration.name, out);
    ts.forEachChild(n, visit);
  };
  for (const p of unit.parameters) visit(p);
  if (unit.body) visit(unit.body);
  return out;
}

export function isPropertyNamePosition(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) ||
    ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === id) return true;
  // Shorthand `{ x }` names a property too, so renaming it would hide a different key.
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if (ts.isQualifiedName(p) && p.right === id) return true;
  return false;
}

const isLiteral = (n) =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) ||
  ts.isRegularExpressionLiteral(n) || ts.isBigIntLiteral(n) || n.kind === ts.SyntaxKind.TemplateHead ||
  n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail;

// Normalized token stream: no comments, whitespace, parentheses, type annotations or decorators.
// With `rename`, identifiers in `locals` become $0, $1… by first appearance (T2); with rename "flat" they all become $,
// so one extra parameter does not shift every later placeholder (the near-clone shingles use this). Literals stay.
export function tokenStream(nodes, locals, rename) {
  const toks = [];
  const map = new Map();
  let count = 0;
  const visit = (n) => {
    if (ts.isTypeNode(n) || ts.isTypeParameterDeclaration(n) || n.kind === ts.SyntaxKind.Decorator) return;
    if (n.kind !== ts.SyntaxKind.ParenthesizedExpression) {
      count++;
      if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
        if (rename && locals.has(n.text) && !isPropertyNamePosition(n)) {
          if (!map.has(n.text)) map.set(n.text, `$${map.size}`);
          toks.push(rename === "flat" ? "$" : map.get(n.text));
        } else toks.push(`#${n.text}`);
      } else if (isLiteral(n)) toks.push(`'${n.text}`);
      else if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) toks.push(`${n.kind}:${n.operator}`);
      else toks.push(String(n.kind));
    }
    ts.forEachChild(n, visit);
  };
  for (const n of nodes) visit(n);
  return { toks, count };
}
