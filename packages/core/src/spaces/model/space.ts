// Declares the in-memory shape of a Space and its glossary, as read from space.json and glossary.json.
// CONTRACT: documents/contracts/spaces.md#layout

/** The only file version this code writes; a file with a higher version is read-only. */
export const SPACE_FORMAT_VERSION = 1;

export const SPACE_DATE_KINDS = ["task", "read", "project", "deadline"] as const;
export type SpaceDateKind = (typeof SPACE_DATE_KINDS)[number];

/** Keys this version does not know, kept so a write puts them back after the known keys. */
export type UnknownFields = Readonly<Record<string, unknown>>;

export interface SpaceFolder {
  readonly id: string;
  readonly name: string;
  /** Absent for a folder at the Space root. */
  readonly parent?: string;
  readonly extra: UnknownFields;
}

export interface SpaceReference {
  readonly id: string;
  /** Absent for a paper at the Space root. */
  readonly folder?: string;
  readonly addedAt?: string;
  /** Pinned to the Space overview; only true is written. */
  readonly focus: boolean;
  readonly extra: UnknownFields;
}

interface SpaceDateBase {
  readonly id: string;
  readonly title: string;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly extra: UnknownFields;
}

export interface SpaceTaskDate extends SpaceDateBase { readonly kind: "task"; readonly done: boolean }
export interface SpaceReadDate extends SpaceDateBase { readonly kind: "read"; readonly paperIds?: readonly string[] }
export interface SpaceProjectDate extends SpaceDateBase { readonly kind: "project"; readonly projectId?: string }
export type SpaceDate = SpaceTaskDate | SpaceReadDate | SpaceProjectDate | (SpaceDateBase & { readonly kind: "deadline" });

export interface Space {
  /** The folder name under spaces/; it never changes. */
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly createdAt?: string;
  readonly folders: readonly SpaceFolder[];
  readonly papers: readonly SpaceReference[];
  readonly projects: readonly string[];
  readonly dates: readonly SpaceDate[];
  /** Entries this version cannot read, kept unchanged so a write puts them back after the valid entries. */
  readonly invalid: SpaceInvalidEntries;
  readonly extra: UnknownFields;
}

export interface SpaceInvalidEntries {
  readonly folders: readonly unknown[];
  readonly papers: readonly unknown[];
  readonly projects: readonly unknown[];
  readonly dates: readonly unknown[];
}

/** What reading one space.json gives; P is the host's path type. */
export type SpaceReadResult<P = string> =
  | {
    readonly state: "ready";
    readonly path: P;
    readonly space: Space;
    /** One line per dropped or repaired entry, for the caller to log once per read. */
    readonly warnings: readonly string[];
    /** Set when the file must not be written, with the reason the apps show. */
    readonly readOnlyReason?: string;
  }
  | { readonly state: "unreadable"; readonly id: string; readonly path: P; readonly reason: string };

export interface GlossarySource {
  readonly paperId: string;
  readonly page?: number;
  readonly extra: UnknownFields;
}

export interface GlossaryTerm {
  readonly id: string;
  readonly term: string;
  readonly symbol?: string;
  readonly definition: string;
  readonly source?: GlossarySource;
  readonly extra: UnknownFields;
}

export interface Glossary {
  readonly terms: readonly GlossaryTerm[];
  /** Terms this version cannot read, kept unchanged so a write puts them back after the valid terms. */
  readonly invalidTerms: readonly unknown[];
  readonly extra: UnknownFields;
}

export interface GlossaryReadResult {
  readonly glossary: Glossary;
  readonly warnings: readonly string[];
  /** Set when the file must not be written: a higher version, or content that could not be parsed. */
  readonly readOnlyReason?: string;
}
