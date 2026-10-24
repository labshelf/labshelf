/** Implements PathOps for "/"-separated paths, for runtimes without node:path (the browser's relative store keys). */
import type { PathOps } from "./mutationDeps.js";

function join(...parts: string[]): string {
  const joined = parts.filter((part) => part !== "").join("/").replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function dirname(target: string): string {
  const trimmed = target.length > 1 ? target.replace(/\/$/, "") : target;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) { return "."; }
  return slash === 0 ? "/" : trimmed.slice(0, slash);
}

function basename(target: string, ext?: string): string {
  const name = target.replace(/\/$/, "").slice(target.replace(/\/$/, "").lastIndexOf("/") + 1);
  return ext && name !== ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

function extname(target: string): string {
  const name = basename(target);
  const dot = name.lastIndexOf(".");
  return dot <= 0 || name === ".." ? "" : name.slice(dot);
}

function isAbsolute(target: string): boolean {
  return target.startsWith("/");
}

/** The segments of a path with "." and empty segments dropped and ".." applied; a leading ".." of a relative path stays. */
function segmentsOf(target: string): string[] {
  const out: string[] = [];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") { continue; }
    if (segment !== "..") { out.push(segment); continue; }
    if (out.length > 0 && out[out.length - 1] !== "..") { out.pop(); } else if (!isAbsolute(target)) { out.push(".."); }
  }
  return out;
}

// There is no working directory to resolve against: a path that stays relative is only normalised.
function resolve(...parts: string[]): string {
  let joined = "";
  for (const part of parts) {
    if (part === "") { continue; }
    joined = isAbsolute(part) || joined === "" ? part : `${joined}/${part}`;
  }
  const segments = segmentsOf(joined).join("/");
  return isAbsolute(joined) ? `/${segments}` : segments || ".";
}

function relative(from: string, to: string): string {
  const fromSegments = segmentsOf(resolve(from));
  const toSegments = segmentsOf(resolve(to));
  let common = 0;
  while (common < fromSegments.length && common < toSegments.length && fromSegments[common] === toSegments[common]) { common += 1; }
  return [...fromSegments.slice(common).map(() => ".."), ...toSegments.slice(common)].join("/");
}

export const posixPathOps: PathOps = { sep: "/", join, dirname, basename, extname, isAbsolute, resolve, relative };
