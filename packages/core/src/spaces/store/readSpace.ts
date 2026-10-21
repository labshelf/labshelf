// Reads and lists Space files, logging every reader warning once per read; reading never throws.
import { parseGlossaryFile, parseSpaceFile } from "../model/index.js";
import type { GlossaryReadResult, SpaceReadResult } from "../model/index.js";
import { SPACE_STORE_MODULE, type StoreContext } from "./types.js";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function readSpaceFile(ctx: StoreContext, id: string): Promise<SpaceReadResult> {
  const path = ctx.layout.spaceFilePath(id);
  let result: SpaceReadResult;
  try {
    result = parseSpaceFile(await ctx.fs.readText(path), { id, path });
  } catch (error) {
    result = { state: "unreadable", id, path, reason: message(error) };
  }
  if (result.state === "unreadable") {
    await ctx.logger.log("WARN", SPACE_STORE_MODULE, "Space is unreadable", { path, reason: result.reason });
  } else {
    for (const warning of result.warnings) { await ctx.logger.log("WARN", SPACE_STORE_MODULE, warning, { path }); }
  }
  return result;
}

export async function readGlossaryFile(ctx: StoreContext, id: string): Promise<GlossaryReadResult> {
  const path = ctx.layout.glossaryFilePath(id);
  let result: GlossaryReadResult;
  if (!(await ctx.fs.exists(path))) {
    result = parseGlossaryFile(undefined);
  } else {
    try {
      result = parseGlossaryFile(await ctx.fs.readText(path));
    } catch (error) {
      const empty = parseGlossaryFile(undefined);
      result = { ...empty, readOnlyReason: `glossary.json could not be read: ${message(error)}` };
    }
  }
  for (const warning of result.warnings) { await ctx.logger.log("WARN", SPACE_STORE_MODULE, warning, { path }); }
  return result;
}

/** Every folder of spaces/ that holds a space.json, hidden entries skipped, sorted by id. */
export async function readAllSpaces(ctx: StoreContext): Promise<SpaceReadResult[]> {
  const names = (await ctx.fs.listDir(ctx.layout.spacesRoot())).filter((name) => !name.startsWith(".")).sort();
  const results: SpaceReadResult[] = [];
  for (const name of names) {
    const stat = await ctx.fs.stat(ctx.layout.spaceDir(name));
    if (!stat?.isDirectory || !(await ctx.fs.exists(ctx.layout.spaceFilePath(name)))) { continue; }
    results.push(await readSpaceFile(ctx, name));
  }
  return results;
}
