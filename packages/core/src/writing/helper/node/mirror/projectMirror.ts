// Creates the handlers that keep each project's source mirror equal to the page's, one request at a time per project.
import * as path from "node:path";

import { PROTOCOL_VERSION, isHelperProjectId } from "../../index.js";
import type { ILogger } from "../../../../ports/index.js";

import { handleDelete } from "./deleteHandler.js";
import { handleFile } from "./fileHandler.js";
import type { HelperHandler } from "../dispatch/index.js";
import { MIRROR_MODULE, MirrorRejection, type MirrorContext } from "./mirrorTypes.js";
import { handleSync } from "./syncHandler.js";

export interface ProjectMirror {
  sync: HelperHandler;
  file: HelperHandler;
  delete: HelperHandler;
  /** The folder latexmk reads for `projectId`. */
  sourceDir(projectId: string): string;
}

export function createProjectMirror(options: { projectsRoot: string; logger: ILogger }): ProjectMirror {
  const ctx: MirrorContext = { projectsRoot: options.projectsRoot, logger: options.logger, pending: new Map() };
  const queues = new Map<string, Promise<void>>();

  // INVARIANT: one request per project runs at a time, because a sync, a chunk and a delete share its index and pending files.
  function guarded(type: "sync" | "file" | "delete"): HelperHandler {
    return (message, send) => {
      if (message.type !== type) { throw new Error(`mirror ${type} handler received ${message.type}`); }
      const key = "projectId" in message && typeof message.projectId === "string" ? message.projectId : "";
      const run = async (): Promise<void> => {
        try {
          if (message.type === "sync") { await handleSync(ctx, message, send); }
          else if (message.type === "file") { await handleFile(ctx, message, send); }
          else if (message.type === "delete") { await handleDelete(ctx, message, send); }
        } catch (error) {
          await reply(error, message.id, send);
        }
      };
      const next = (queues.get(key) ?? Promise.resolve()).then(run);
      queues.set(key, next);
      return next;
    };
  }

  async function reply(error: unknown, id: string, send: Parameters<HelperHandler>[1]): Promise<void> {
    if (error instanceof MirrorRejection) {
      await ctx.logger.log("WARN", MIRROR_MODULE, `Rejected a request: ${error.message}`, { code: error.code, ...error.context });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: error.code, message: error.message });
      return;
    }
    await ctx.logger.error(MIRROR_MODULE, error);
    send({ v: PROTOCOL_VERSION, id, type: "error", code: "io", message: error instanceof Error ? error.message : String(error) });
  }

  return {
    sync: guarded("sync"),
    file: guarded("file"),
    delete: guarded("delete"),
    sourceDir(projectId) {
      if (!isHelperProjectId(projectId)) { throw new Error(`Not a project id: ${projectId}`); }
      return path.join(options.projectsRoot, projectId, "src");
    },
  };
}
