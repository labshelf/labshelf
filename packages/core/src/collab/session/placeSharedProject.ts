// Finds or creates the project folder a share connection mirrors: a project being shared, one shared before, or one joined.
import type { ILogger } from "../../ports/index.js";
import type { ProjectCatalogContext } from "../../writing/project/index.js";
import { COMMENTS_PATH, importCommentsFile } from "../comments/index.js";
import { joinShare, startShare } from "../share/index.js";
import type { ShareSession } from "../sync/index.js";
import { projectIndexReady } from "./projectIndexReady.js";

/** `share` turns a project into a share, `resume` reconnects a shared one, `join` creates the project of a share in the library. */
export type ShareStart = { mode: "share" | "resume"; folder: string } | { mode: "join"; signal: AbortSignal };

/** Where projects live: the catalog that creates a joined one, and the library root it goes under. */
export interface ShareProjects {
  context: ProjectCatalogContext;
  libraryRoot: string;
}

export interface PlacedProject {
  folder: string;
  /** The id of the project a join created; undefined for share and resume, whose caller already knows it. */
  joinedId: string | undefined;
}

const isMissing = (error: unknown): boolean => (error as { code?: unknown }).code === "ENOENT";

/** Seeds the share's comments map from the project's comments.json, which the map stands for from then on. */
async function importComments({ fs, paths }: ProjectCatalogContext, folder: string, session: ShareSession, logger: ILogger): Promise<void> {
  let text: string;
  try {
    text = await fs.readText(paths.join(folder, ...COMMENTS_PATH.split("/")));
  } catch (error) {
    if (isMissing(error)) { return; }
    throw error;
  }
  const added = importCommentsFile(session.index, text);
  if (added === undefined) {
    void logger.log("WARN", "collab", "comments.json is not valid, so its threads are not shared", { folder, path: COMMENTS_PATH });
    return;
  }
  void logger.log("INFO", "collab", "Shared the project's comment threads", { folder, threads: added });
}

export async function placeSharedProject(
  { context, libraryRoot }: ShareProjects, shareId: string, session: ShareSession, start: ShareStart,
): Promise<PlacedProject> {
  if (start.mode === "join") {
    await projectIndexReady(session, start.signal);
    const joined = await joinShare(context, { libraryRoot, shareId, index: session.index });
    return { folder: joined.folder, joinedId: joined.id };
  }
  if (start.mode === "share") {
    await startShare(context, { folder: start.folder, shareId, index: session.index });
    await importComments(context, start.folder, session, context.logger);
  }
  return { folder: start.folder, joinedId: undefined };
}
