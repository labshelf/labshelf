// Shows a progress notification on the first report and closes it on request.
import * as vscode from "vscode";

export interface LazyProgress {
  report(message: string): void;
  close(): void;
}

/** A relay step that never reports shows nothing, so a cancelled choice leaves no notification behind. */
export function lazyProgress(title: string): LazyProgress {
  let sink: vscode.Progress<{ message?: string }> | undefined;
  let latest = "";
  let release = (): void => undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
  return {
    report(message) {
      latest = message;
      if (sink) { sink.report({ message }); return; }
      void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async (progress) => {
        sink = progress;
        progress.report({ message: latest });
        await closed;
      });
    },
    close: () => release(),
  };
}
