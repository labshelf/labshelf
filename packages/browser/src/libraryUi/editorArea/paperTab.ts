// Shows a paper's PDF as a tab of the library page: the reader page in a frame, so it keeps its own pdf.js, host and keys.
import { renderElement } from "@labshelf/core/dom";
import { createReaderUrl } from "../reader";
import type { TabModule } from "./tabKinds";

export const mountTab: TabModule["mountTab"] = (host, params) => {
  const frame = renderElement("iframe", { class: "ls-workspace-fill ls-paper-frame", src: createReaderUrl(params["paperId"] ?? ""), title: "PDF reader" });
  host.append(frame);
  return { dispose: () => frame.remove() };
};
