// Declares the LibraryPath and ProjectPath brands and the one guard that narrows an untrusted value to each.
import { PAPERS_DIR } from "../library/index.js";
import { checkRelativePath } from "./relativePath.js";

declare const pathBrand: unique symbol;

/** A "/"-separated path from the library root that is "papers" or below it. */
export type LibraryPath = string & { readonly [pathBrand]: "library" };

/** A "/"-separated path below a project folder that cannot escape it on any platform. */
export type ProjectPath = string & { readonly [pathBrand]: "project" };

/** A "papers" path with no backslash and no empty, "." or ".." segment. */
export function isLibraryPath(value: unknown): value is LibraryPath {
  if (typeof value !== "string" || value.includes("\\")) { return false; }
  const [head, ...rest] = value.split("/");
  return head === PAPERS_DIR && rest.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** A relative path that passes checkRelativePath: no backslash, drive letter, leading "/", control character, or empty, "." or ".." segment. */
export function isProjectPath(value: unknown): value is ProjectPath {
  return typeof value === "string" && checkRelativePath(value) === undefined;
}
