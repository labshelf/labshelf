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

export interface RepoReference {
  owner: string;
  repo: string;
}

export interface PublishTemplateInput {
  fetch: typeof globalThis.fetch;
  token: string;
  upstream: RepoReference;
  templateId: string;
  files: TemplateFile[];
  title: string;
  body: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface PublishTemplateResult {
  url: string;
  branch: string;
}
