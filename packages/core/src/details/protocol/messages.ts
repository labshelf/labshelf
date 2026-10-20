// Declares the messages between the Details surface and its host: the library and All projects protocols in a channel envelope, plus what to show.
import type { HostToUi, UiToHost } from "../../library-ui/protocol/index.js";
import type { AllProjectsToHost, HostToAllProjects } from "../../writing/allProjects/protocol/index.js";

/** What the Details surface shows: one or more papers, one project, or nothing. */
export type DetailsTarget = { kind: "paper"; ids: string[] } | { kind: "project"; id: string } | null;

export type DetailsToHost =
  | { channel: "library"; msg: UiToHost }
  | { channel: "projects"; msg: AllProjectsToHost };

export type HostToDetails =
  | { channel: "library"; msg: HostToUi }
  | { channel: "projects"; msg: HostToAllProjects }
  | { type: "details.show"; target: DetailsTarget };
