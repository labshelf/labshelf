// Declares the inputs, result and step names of the template pull request flow.
import type { TemplateFile } from "../index.js";

export type GitHubStep =
  | "fork"
  | "wait"
  | "sync"
  | "base"
  | "blob"
  | "tree"
  | "commit"
  | "branch"
  | "pull";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface SubmitTemplateInput {
  fetch: typeof globalThis.fetch;
  token: string;
  upstream: RepoRef;
  templateId: string;
  files: TemplateFile[];
  title: string;
  body: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface SubmitTemplateResult {
  url: string;
  branch: string;
}
