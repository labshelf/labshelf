// Lists the exported functions, classes, interfaces, type aliases and enums of a TypeScript file by syntax alone.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// PLATFORM: packages/core's `typescript` is the native v7 package without a JS API; `typescript-js` is the 6.x compiler API.
const ts = createRequire(resolve(root, "packages/core/package.json"))("typescript-js");

const isExported = (node) => ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
const isFunctionValue = (node) => node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

function declaredExports(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) return [{ name: statement.name.text, kind: "function" }];
  if (ts.isClassDeclaration(statement) && statement.name) return [{ name: statement.name.text, kind: "class" }];
  if (ts.isInterfaceDeclaration(statement)) return [{ name: statement.name.text, kind: "interface" }];
  if (ts.isTypeAliasDeclaration(statement)) return [{ name: statement.name.text, kind: "type" }];
  if (ts.isEnumDeclaration(statement)) return [{ name: statement.name.text, kind: "enum" }];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .filter((declaration) => ts.isIdentifier(declaration.name) && isFunctionValue(declaration.initializer))
      .map((declaration) => ({ name: declaration.name.text, kind: "function" }));
  }
  return [];
}

export function parseExports(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const seen = new Set();
  const exported = source.statements.filter(isExported).flatMap(declaredExports);
  return exported.filter(({ name }) => !seen.has(name) && seen.add(name));
}
