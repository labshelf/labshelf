// Builds the web build's logger, which writes to the LabShelf output channel because the web host has no log file.
import * as vscode from "vscode";

import { Logger, type ILogger, type LogEntry } from "@labshelf/core";

function line(entry: LogEntry): string {
  const context = Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : "";
  return `${entry.module}: ${entry.message}${context}${entry.stack ? `\n${entry.stack}` : ""}`;
}

export function createOutputChannelLogger(context: vscode.ExtensionContext): ILogger {
  const output = vscode.window.createOutputChannel("LabShelf", { log: true });
  context.subscriptions.push(output);
  const write = { ERROR: output.error, WARN: output.warn, INFO: output.info } as const;
  return new Logger([{ append: async (entry) => { write[entry.level].call(output, line(entry)); } }]);
}
