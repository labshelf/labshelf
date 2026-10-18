// Builds a project mirror over a temp folder and helpers that speak its protocol messages.
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chunkBytes, type HelperChunk, type ToHelperMessage, type ToPageMessage } from "../../../../../src/writing/helper/index.js";
import type { ILogger } from "../../../../../src/ports/index.js";

import { createProjectMirror, type ProjectMirror } from "../../../../../src/writing/helper/node/mirror/index";

export interface Harness {
  root: string;
  projectsRoot: string;
  outside: string;
  mirror: ProjectMirror;
  logger: { log: jest.Mock; error: jest.Mock };
  replies: ToPageMessage[];
  cleanup(): Promise<void>;
  call(handler: "sync" | "file" | "delete", message: Record<string, unknown>): Promise<ToPageMessage[]>;
}

export async function createHarness(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "labshelf-mirror-")));
  const projectsRoot = join(root, "projects");
  const outside = join(root, "outside");
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const mirror = createProjectMirror({ projectsRoot, logger: logger as unknown as ILogger });
  const replies: ToPageMessage[] = [];
  return {
    root, projectsRoot, outside, mirror, logger, replies,
    cleanup: () => rm(root, { recursive: true, force: true }),
    async call(handler, message) {
      const sent: ToPageMessage[] = [];
      await mirror[handler]({ v: 1, id: "1", type: handler, ...message } as ToHelperMessage, (reply) => sent.push(reply));
      replies.push(...sent);
      return sent;
    },
  };
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function entry(path: string, content: string): { path: string; sha256: string; size: number } {
  return { path, sha256: sha256(content), size: Buffer.byteLength(content) };
}

export function chunksOf(content: string | Uint8Array): HelperChunk[] {
  return chunkBytes(typeof content === "string" ? Buffer.from(content) : content);
}

export async function upload(h: Harness, projectId: string, files: Record<string, string>): Promise<ToPageMessage[]> {
  const sync = await h.call("sync", { projectId, files: Object.entries(files).map(([p, c]) => entry(p, c)) });
  for (const [path, content] of Object.entries(files)) {
    for (const chunk of chunksOf(content)) { await h.call("file", { projectId, path, chunk }); }
  }
  return sync;
}

export function errorCode(replies: ToPageMessage[]): string | undefined {
  const reply = replies.find((r) => r.type === "error");
  return reply?.type === "error" ? reply.code : undefined;
}

export function needPaths(replies: ToPageMessage[]): string[] | undefined {
  const reply = replies.find((r) => r.type === "need");
  return reply?.type === "need" ? reply.paths : undefined;
}
