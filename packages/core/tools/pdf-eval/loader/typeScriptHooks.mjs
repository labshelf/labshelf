// Resolves core's ".js" import specifiers to their ".ts" files and transpiles those files with the TypeScript package core's tests use.
// PLATFORM: Node 26 strips types but no longer transforms them, so parameter properties in core's classes need this transpile step.
import { readFile } from "node:fs/promises";
import ts from "typescript-js";

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith(".") || !specifier.endsWith(".js")) return nextResolve(specifier, context);
  try {
    return await nextResolve(specifier.replace(/\.js$/, ".ts"), context);
  } catch {
    return nextResolve(specifier, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts") || url.includes("/node_modules/")) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: url,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
