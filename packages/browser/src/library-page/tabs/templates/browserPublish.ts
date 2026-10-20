// Connects the template gallery's publication workflow to the helper and GitHub device authorization.
import type { GitHubSignIn, HostToGallery, ILogger, PublishHost, PublishToHost } from "@labshelf/core";
import type { ILatexHelper } from "@labshelf/core/helper";
import { renderTemplateThumbnail } from "./renderThumbnail";
import { signInToGitHub } from "./githubSignIn";

export interface BrowserPublishOptions {
  helper: ILatexHelper;
  logger: ILogger;
  pickProject(): Promise<string | undefined>;
  post(message: HostToGallery): void;
  signIn?: (signal: AbortSignal) => Promise<GitHubSignIn>;
}

export function createBrowserPublish(options: BrowserPublishOptions): PublishHost & { dispose(): void } {
  const lifetime = new AbortController();
  let signedIn: GitHubSignIn | undefined;
  let busy = false;
  const execute = async (message: PublishToHost, projectId?: string): Promise<void> => {
    if (message.type === "publish.start") {
      const id = projectId ?? await options.pickProject();
      if (id) await options.helper.publishTemplate(id, { action: "open" }, options.post, renderTemplateThumbnail);
    } else if (message.type === "publish.signIn") {
      signedIn = await (options.signIn ?? signInToGitHub)(lifetime.signal);
      options.post({ type: "publish.auth", login: signedIn.login });
    } else {
      if (message.type === "publish.submit" && !signedIn) throw new Error("Sign in with GitHub first.");
      const request = message.type === "publish.check" ? { action: "check" as const, draft: message.draft }
        : { action: "submit" as const, draft: message.draft, token: signedIn!.token };
      await options.helper.publishTemplate(message.project.id, request, options.post, renderTemplateThumbnail);
    }
  };
  const run = async (message: PublishToHost, id?: string): Promise<void> => {
    if (busy || lifetime.signal.aborted) return;
    busy = true;
    try {
      await execute(message, id);
    } catch (error) {
      await options.logger.error("browser.templates.publish", error, { action: message.type });
      if (lifetime.signal.aborted) return;
      const text = error instanceof Error ? error.message : String(error);
      if (message.type === "publish.signIn") options.post({ type: "publish.auth", error: text });
      else if (message.type !== "publish.start") options.post({ type: "publish.failed", error: text });
      options.post({ type: "notice", kind: "error", text });
    } finally { busy = false; }
  };
  return { open: (id) => run({ type: "publish.start" }, id), handle: run,
    dispose: () => { lifetime.abort(); signedIn = undefined; options.helper.disconnect(); } };
}
