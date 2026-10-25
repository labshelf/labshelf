// Registers Publish Project as Template: opens the template gallery on the Publish screen for the chosen project.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { executeSafely } from "../../../command/index.js";
import type { WritingHost } from "../../session/index.js";

const PUBLISH_TEMPLATE_COMMAND = "labshelf.templates.publish";

interface PublishCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  /** Opens the gallery on the Publish screen; without an id the host asks which project. */
  openPublish: (projectId?: string) => Promise<void>;
}

export function registerPublishCommand({ context, host, openPublish }: PublishCommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(PUBLISH_TEMPLATE_COMMAND, async (entry?: ProjectEntry) => {
      const session = await host.require();
      if (!session) { return; }
      await executeSafely(session.logger, PUBLISH_TEMPLATE_COMMAND, () => openPublish(entry?.kind === "ready" ? entry.settings.id : undefined));
    }),
  );
}
