// Declares the sharing operations a host offers the common sharing dialogs: project invites, joins and leaves, and paper-folder links.
import type { ShareFolderStage } from "../../share/flow/index.js";

/** A writing project as the sharing dialogs list it; `id` is the project's folder, the key every host and surface uses. */
export interface SharingProject {
  id: string;
  name: string;
  /** The project carries a share id, so this device joined or shared it. */
  shared: boolean;
}

/** What this device knows of a project's share right now. */
export type ProjectShareStatus =
  | { kind: "notShared" }
  /** `connected` is false while the share waits for its relay; `problem` says why edits cannot be stored or mirrored. */
  | { kind: "shared"; connected: boolean; problem?: string }
  /** The project cannot be shared or left here, for the reason given (trashed, unreadable, outside the open library). */
  | { kind: "ineligible"; reason: string };

export type ShareProjectResult =
  | { kind: "shared"; invite: string }
  /** No Cloudflare relay is connected and the user did not connect one. */
  | { kind: "noRelay" }
  /** The project is shared, but this device lost its key: joining with the invite again reconnects it. */
  | { kind: "noKey" };

export type JoinProjectResult =
  | { kind: "refused"; problem: string }
  /** `id` is the joined project's host key, so the dialog can open it. */
  | { kind: "active" | "resumed" | "joined"; id: string; name: string };

/** A paper folder that can be shared as a link. */
export interface SharingFolder { path: string; label: string; count: number }

export type ShareFolderResult = { kind: "shared"; link: string } | { kind: "noRelay" };

/** A link this device made, newest first in the list; `relayHost` is the host part of the relay that serves it. */
export interface SharedLinkView { id: string; folder: string; link: string; createdAt: string; relayHost: string }

export type ImportLinkResult =
  /** `message` is the user-worded reason: an unreadable, revoked or unreachable link. */
  | { kind: "failed"; message: string }
  /** `folder` is the new folder's library path, absent when every paper was already in the library. */
  | { kind: "imported"; summary: string; folder?: string };

/** Which half of sharing the host runs; a control of a half it does not run is not shown. */
export interface SharingOffers { projects: boolean; links: boolean }

export type SharingProgress = { stage: ShareFolderStage } | { done: number; total: number };

/**
 * Every operation validates its arguments against the host's own state (the project exists and may be shared, the folder holds papers);
 * hiding a control in the UI is not authorization. A rejection carries a message the dialog shows after its action words.
 */
export interface SharingHost {
  /** Where the host keeps its list of links, in the user's words: "this device" or "this browser". */
  readonly place: string;
  offers(): SharingOffers;
  /** Calls `listener` whenever `offers` changes; returns the function that stops it. */
  onOffersChange(listener: () => void): () => void;
  projects(): Promise<SharingProject[]>;
  projectStatus(projectId: string): Promise<ProjectShareStatus>;
  shareProject(projectId: string, signal: AbortSignal): Promise<ShareProjectResult>;
  /** The invite to hand out, formatted from the relays the share lists now. */
  inviteLink(projectId: string): Promise<string>;
  joinProject(invite: string, signal: AbortSignal): Promise<JoinProjectResult>;
  /** Device-local: the files stay and the other members keep the share. */
  leaveProject(projectId: string): Promise<void>;
  openProject(projectId: string): Promise<void>;
  /** Undefined when the path is no folder that holds a paper below the library root. */
  shareableFolder(path: string): Promise<SharingFolder | undefined>;
  shareFolder(path: string, withAnnotations: boolean, onProgress: (progress: SharingProgress) => void): Promise<ShareFolderResult>;
  sharedLinks(): Promise<SharedLinkView[]>;
  /** False when the list holds no link with this id. */
  revokeLink(id: string): Promise<boolean>;
  importLink(text: string, onProgress: (progress: SharingProgress) => void): Promise<ImportLinkResult>;
  openFolder(path: string): Promise<void>;
  /** False when the clipboard refused the write, so the dialog keeps the text on screen to copy by hand. */
  copyText(text: string): Promise<boolean>;
  openLink(url: string): Promise<void>;
}
