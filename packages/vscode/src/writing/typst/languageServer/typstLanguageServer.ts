// Starts the managed Tinymist as the Typst language server on first use and stops it with the extension.
import type { ILogger } from "@labshelf/core";

import { setLanguageServerRunning } from "../languageServerState.js";

const MODULE = "writing/typst";

/** The part of a language client the extension uses. */
export interface LanguageClientHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendRequest(method: string, params: unknown): Promise<unknown>;
}

export interface TypstLanguageServerDeps {
  tinymist: { resolve(): Promise<string | undefined>; ensure(onProgress?: (progress: { message: string }) => void): Promise<string> };
  createClient(serverPath: string): Promise<LanguageClientHandle>;
  /** Shows the install progress to the user while `task` runs. */
  withInstallProgress(task: (report: (message: string) => void) => Promise<string>): Promise<string>;
  showError(message: string): void;
  logger: ILogger;
}

export class TypstLanguageServer {
  private launching: Promise<LanguageClientHandle | undefined> | undefined;

  constructor(private readonly deps: TypstLanguageServerDeps) {}

  /** Starts the server once; a failed start is not retried until the extension reloads. */
  start(): Promise<LanguageClientHandle | undefined> {
    this.launching ??= this.launch();
    return this.launching;
  }

  async stop(): Promise<void> {
    const client = await this.launching;
    this.launching = undefined;
    if (!client) { return; }
    setLanguageServerRunning(false);
    await client.stop().catch((error: unknown) => this.deps.logger.error(MODULE, error, { action: "stop-typst-language-server" }));
  }

  private async launch(): Promise<LanguageClientHandle | undefined> {
    const { logger } = this.deps;
    try {
      const serverPath = (await this.deps.tinymist.resolve()) ?? await this.deps.withInstallProgress((report) => this.deps.tinymist.ensure((progress) => report(progress.message)));
      const client = await this.deps.createClient(serverPath);
      await client.start();
      setLanguageServerRunning(true);
      await logger.log("INFO", MODULE, "Started the Typst language server", { serverPath });
      return client;
    } catch (error) {
      await logger.error(MODULE, error, { action: "start-typst-language-server" });
      this.deps.showError(`The Typst language server could not start: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}
