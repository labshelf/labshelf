/** Locates the installed pdfjs-dist package, whose data files and native canvas the Node loaders point at. */
import { dirname } from "node:path";

/**
 * `require` is the CommonJS one under Jest and the createRequire shim the bundles define at the top of their output.
 * @returns the absolute path of pdfjs-dist/package.json, or undefined when it cannot be resolved
 */
export function resolvePdfjsPackageJson(): string | undefined {
  try {
    return typeof require === "function" ? require.resolve("pdfjs-dist/package.json") : undefined;
  } catch {
    return undefined;
  }
}

export function resolvePdfjsPackageDir(): string | undefined {
  const packageJson = resolvePdfjsPackageJson();
  return packageJson ? dirname(packageJson) : undefined;
}
