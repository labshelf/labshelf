// The reader webview's consult: the source editor's consult client and file opener over the reader channel, wrapped as {command:"consult"}, offered only when the host's first init says it answers consult.
import type { ConsultSetup } from "@labshelf/core/consult";
import { isConsultInbound, type ConsultOutbound } from "@labshelf/core";
import { createWebviewConsult } from "../../writing/sourceEditor/webview/consultPorts.js";

/** The pdf.js assets the paper view reads (core's PdfDeckAssets, which core does not export). */
type PdfDeckAssets = ReturnType<ConsultSetup["pdfSource"]>["assets"];

export function createReaderWebviewConsult(transport: { post(message: unknown): void }, assets: PdfDeckAssets): { setup(): Promise<ConsultSetup | undefined>; receive(message: unknown): void } {
  const webview = createWebviewConsult((message: ConsultOutbound) => { transport.post({ command: "consult", message }); });
  const found: ConsultSetup = {
    client: webview.client,
    openFile: webview.openFile,
    pdfSource: (bytes) => ({ assets, readBytes: async () => bytes.slice(0) }),
  };
  /** Set by the first init: whether the host offers consult. */
  let offered: boolean | undefined;
  const waiting: Array<(setup: ConsultSetup | undefined) => void> = [];

  return {
    setup() {
      if (offered !== undefined) { return Promise.resolve(offered ? found : undefined); }
      return new Promise((resolve) => { waiting.push(resolve); });
    },
    receive(message) {
      if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "init" && offered === undefined) {
        offered = (message as { hasConsult?: unknown }).hasConsult === true;
        for (const resolve of waiting.splice(0)) { resolve(offered ? found : undefined); }
        return;
      }
      if (isConsultInbound(message)) { webview.receive(message); }
    },
  };
}
