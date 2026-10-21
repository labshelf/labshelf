/** Builds a SpaceStore over an in-memory library with a recording logger, for the Space store tests. */
import { SpaceStore } from "../../../src/spaces/store/index";
import { posixPathOps } from "../../../src/library/mutations/index";
import type { ILogger } from "../../../src/ports/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

export const ROOT = "/lib";
export const NOW = "2026-10-20T10:00:00Z";

export interface LogLine { level: string; message: string; context?: Record<string, unknown> | undefined }

export function makeFixture(seed: Record<string, unknown> = {}) {
  const fs = new MemoryLibraryFs();
  const logs: LogLine[] = [];
  const logger: ILogger = {
    log: async (level, _module, message, context) => { logs.push({ level, message, context }); },
    error: async (_module, error) => { logs.push({ level: "ERROR", message: String(error) }); },
  };
  const store = new SpaceStore({ root: ROOT, fs, paths: posixPathOps, logger, now: () => NOW });
  const fixture = {
    fs, logs, store,
    async put(id: string, doc: unknown): Promise<void> { await fs.writeText(`${ROOT}/spaces/${id}/space.json`, JSON.stringify(doc)); },
    async putGlossary(id: string, doc: unknown): Promise<void> { await fs.writeText(`${ROOT}/spaces/${id}/glossary.json`, JSON.stringify(doc)); },
    async json(id: string, file = "space.json"): Promise<Record<string, any>> {
      return JSON.parse(await fs.readText(`${ROOT}/spaces/${id}/${file}`));
    },
  };
  return { fixture, seeded: Promise.all(Object.entries(seed).map(([id, doc]) => fixture.put(id, doc))) };
}

export async function seededFixture(seed: Record<string, unknown>) {
  const { fixture, seeded } = makeFixture(seed);
  await seeded;
  return fixture;
}
