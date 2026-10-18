// Collects the chunks of a requested file, checks its SHA-256 and writes it into the mirror.
import * as path from "node:path";

import { ChunkAssembler, PROTOCOL_VERSION } from "@labshelf/core/helper";
import type { ToHelperMessage } from "@labshelf/core/helper";

import { createSourceDir, loadIndex, resolveInSource, saveIndex, sha256Hex, writeAtomically } from "./disk/index.js";
import type { HelperSend } from "../dispatch/index.js";
import { MIRROR_MODULE, MirrorRejection, type MirrorContext, type PendingFile } from "./mirrorTypes.js";
import { chunkCountFor, requirePath, requireProjectId } from "./mirrorValidate.js";

type FileMessage = Extract<ToHelperMessage, { type: "file" }>;

function reject(reason: string, message: FileMessage): MirrorRejection {
  return new MirrorRejection("invalid-field", reason, { projectId: message.projectId, path: message.path, index: message.chunk.index });
}

/** The bytes once the last chunk arrives; undefined while more are expected. A refused stream is dropped so the page can resend it. */
function collect(pending: PendingFile, message: FileMessage): Uint8Array | undefined {
  const { chunk } = message;
  if (chunk.count !== chunkCountFor(pending.size)) { pending.assembler = undefined; throw reject("chunk count does not match the declared size", message); }
  if (chunk.index === 0) { pending.assembler = new ChunkAssembler(); }
  if (pending.assembler === undefined) { throw reject("stream does not start at chunk 0", message); }
  const result = pending.assembler.add(chunk);
  if (result.status === "partial") { return undefined; }
  pending.assembler = undefined;
  if (result.status === "rejected") { throw reject(`chunk refused: ${result.reason}`, message); }
  if (result.bytes.length !== pending.size) { throw reject("content length differs from the declared size", message); }
  if (sha256Hex(result.bytes) !== pending.sha256) { throw reject("content SHA-256 differs from the declared one", message); }
  return result.bytes;
}

export async function handleFile(ctx: MirrorContext, message: FileMessage, send: HelperSend): Promise<void> {
  const { projectId, path: relPath } = message;
  requireProjectId(projectId);
  requirePath(relPath);
  const needed = ctx.pending.get(projectId);
  const pending = needed?.get(relPath);
  if (needed === undefined || pending === undefined) { throw reject("file was not requested by the last sync", message); }
  const bytes = collect(pending, message);
  if (bytes !== undefined) {
    const srcDir = await createSourceDir(ctx.projectsRoot, projectId);
    const projectDir = path.dirname(srcDir);
    const target = (await resolveInSource(srcDir, relPath, true)) as string;
    const disk = await writeAtomically(target, bytes, path.join(projectDir, "incoming"));
    const index = await loadIndex(projectDir, ctx.logger);
    index.set(relPath, { sha256: pending.sha256, ...disk });
    await saveIndex(projectDir, index);
    needed.delete(relPath);
    await ctx.logger.log("INFO", MIRROR_MODULE, "Mirrored a file", { projectId, path: relPath, size: bytes.length });
  }
  // CONTRACT: documents/contracts/helper.md#messages — the page posts every chunk but the last without waiting, so only completion is answered.
  if (needed.size === 0) { send({ v: PROTOCOL_VERSION, id: message.id, type: "need", paths: [] }); }
}
