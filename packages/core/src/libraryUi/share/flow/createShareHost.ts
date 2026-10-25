// Builds the sharing host both apps hand the common sharing dialogs, from the halves of sharing the app runs and its clipboard.
import type { ILogger } from "../../../ports/index.js";
import type { ShareHost } from "../shareHost.js";
import { createFolderShareLinkOps, type FolderShareLinkDeps, type FolderShareLinkOps } from "./shareLinkOps.js";
import { createProjectShareOps, type ProjectShareDeps, type ProjectShareOps } from "./projectShareOps.js";

export interface ShareHostDeps {
  /** Where the app keeps its list of links, in the user's words: "this device" or "this browser". */
  place: string;
  logger: ILogger;
  /** Absent where the app does not share projects; the dialogs then offer no project control. */
  projects?: ProjectShareDeps;
  /** Absent where the app does not share folders as links. */
  links?: FolderShareLinkDeps;
  clipboard: { write(text: string): Promise<void> };
  openLink(url: string): Promise<void>;
}

const LOG_MODULE = "library-ui.sharing";

function refuse(what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`This app does not share ${what}.`));
}

const NO_PROJECTS: ProjectShareOps = {
  projects: refuse("projects"), projectStatus: refuse("projects"), shareProject: refuse("projects"), inviteLink: refuse("projects"),
  joinProject: refuse("projects"), leaveProject: refuse("projects"), openProject: refuse("projects"),
};

const NO_LINKS: FolderShareLinkOps = {
  shareableFolder: refuse("folders as links"), shareFolder: refuse("folders as links"), sharedLinks: refuse("folders as links"),
  revokeLink: refuse("folders as links"), importLink: refuse("folders as links"), openFolder: refuse("folders as links"),
};

export function createShareHost(deps: ShareHostDeps): ShareHost {
  const { logger } = deps;
  const offers = { projects: deps.projects !== undefined, links: deps.links !== undefined };
  return {
    place: deps.place,
    offers: () => offers,
    // The halves an app runs are fixed when it builds the host.
    onOffersChange: () => () => undefined,
    ...(deps.projects ? createProjectShareOps(deps.projects, logger) : NO_PROJECTS),
    ...(deps.links ? createFolderShareLinkOps(deps.links, logger) : NO_LINKS),
    async copyText(text) {
      try {
        await deps.clipboard.write(text);
        return true;
      } catch (error) {
        await logger.log("WARN", LOG_MODULE, "The clipboard refused a copy", { error: String(error) });
        return false;
      }
    },
    async openLink(url) {
      const protocol = URL.canParse(url) ? new URL(url).protocol : "";
      if (protocol !== "https:" && protocol !== "http:") throw new Error("LabShelf opens only web links.");
      await deps.openLink(url);
    },
  };
}
