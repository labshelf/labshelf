// Declares the messages between the Spaces page and its host, and the channel that carries them.
import type { MessageEnd } from "../../libraryUi/protocol/index.js";
import type { GlossaryTerm, Space } from "../model/index.js";
import type { SpaceDateInput, TermInput } from "../store/index.js";
import type { CatalogRow, PapersTree, ResolvedPaper, SpaceOverview, SpaceProjectEntry } from "../viewModel/index.js";

export const SPACE_TABS = ["overview", "papers", "notes", "discussions", "discover", "glossary"] as const;
export type SpaceTab = (typeof SPACE_TABS)[number];

/** One store mutation each; `id` is the Space id. */
export type SpaceMutation =
  | { type: "createSpace"; name: string }
  | { type: "renameSpace"; id: string; name: string }
  /** An absent `purpose` removes it. */
  | { type: "setPurpose"; id: string; purpose?: string }
  | { type: "deleteSpace"; id: string }
  | { type: "addPapers"; id: string; paperIds: string[]; folder?: string }
  | { type: "removePaper"; id: string; paperId: string }
  | { type: "setFocus"; id: string; paperId: string; focus: boolean }
  /** An absent `folder` moves the reference to the Space root. */
  | { type: "moveReference"; id: string; paperId: string; folder?: string }
  | { type: "createFolder"; id: string; name: string; parent?: string }
  | { type: "renameFolder"; id: string; folderId: string; name: string }
  | { type: "deleteFolder"; id: string; folderId: string }
  | { type: "linkProject"; id: string; projectId: string }
  | { type: "unlinkProject"; id: string; projectId: string }
  | { type: "addDate"; id: string; date: SpaceDateInput }
  | { type: "updateDate"; id: string; dateId: string; date: SpaceDateInput }
  | { type: "removeDate"; id: string; dateId: string }
  | { type: "setDone"; id: string; dateId: string; done: boolean }
  | { type: "addTerm"; id: string; term: TermInput }
  | { type: "updateTerm"; id: string; termId: string; term: TermInput }
  | { type: "removeTerm"; id: string; termId: string };

export type SpacesToHost =
  /** The page shows this view; the host posts it now and after every change. */
  | { type: "ready"; view: "catalog" }
  | { type: "ready"; view: "space"; id: string }
  | SpaceMutation
  | { type: "openPaper"; paperId: string }
  /** Shows the paper in the Details surface. */
  | { type: "selectPaper"; paperId: string }
  | { type: "openProject"; projectId: string }
  | { type: "openSpace"; id: string; tab?: SpaceTab }
  | { type: "openCatalog" }
  | { type: "exportIcs"; id: string }
  | { type: "listPapers" }
  | { type: "listProjects" };

export type PaperPickItem = Extract<ResolvedPaper, { missing: false }>;

export type HostToSpaces =
  | { type: "catalog"; rows: CatalogRow[] }
  | {
    type: "space";
    space: Space;
    /** Set when the Space must not be changed, with the reason to show. */
    readOnlyReason?: string;
    overview: SpaceOverview;
    papers: PapersTree;
    glossary: { terms: readonly GlossaryTerm[]; readOnlyReason?: string };
    /** Every project the host reports, linked or not. */
    projects: SpaceProjectEntry[];
  }
  | { type: "papers"; items: PaperPickItem[] }
  | { type: "projects"; items: SpaceProjectEntry[] }
  /** `action` is the label of the failed action. */
  | { type: "error"; action: string; message: string };

/** The page side of the channel. */
export type SpacesTransport = MessageEnd<SpacesToHost, HostToSpaces>;

/** The host side of the channel. */
export type SpacesEndpoint = MessageEnd<HostToSpaces, SpacesToHost>;
