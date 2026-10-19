// Declares the Typst language service: its project-file source and its completion, hover and definition results.

export interface TypstSources {
  /** Project-relative, `/`-separated paths of every project file. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

export type TypstCompletionKind =
  | "function" | "variable" | "keyword" | "label" | "citation" | "file" | "parameter" | "module" | "type" | "value";

export interface TypstCompletion {
  label: string;
  kind: TypstCompletionKind;
  detail?: string;
  /** Markdown. */
  doc?: string;
  /** Inserted text; holds `${1:name}` placeholders when `snippet` is true. */
  insert: string;
  snippet: boolean;
}

export interface TypstCompletions { from: number; to: number; options: TypstCompletion[] }

export interface TypstHover {
  from: number;
  to: number;
  /** Markdown: a ```typst fence with the signature, then the doc. */
  text: string;
}

export interface TypstDefinition { path: string; from: number; to: number; line: number }

export interface TypstLanguageService {
  complete(path: string, text: string, offset: number, explicit: boolean): Promise<TypstCompletions | null>;
  hover(path: string, text: string, offset: number): Promise<TypstHover | null>;
  definition(path: string, text: string, offset: number): Promise<TypstDefinition | null>;
}
