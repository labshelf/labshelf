// Runs the sharing dialog a library UI request asks for.
import { showToast } from "../../ui/dom/index.js";
import type { ShareDialogRequest, ShareHost } from "../share/index.js";
import { runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog } from "../../collab/dom/index.js";
import { runImportShareLinkDialog, runManageShareLinksDialog, runShareFolderDialog } from "../../share/dom/index.js";

export async function runShareDialog(host: ShareHost, request: ShareDialogRequest): Promise<void> {
  switch (request.kind) {
    case "shareProject": return runShareProjectDialog(host, request.projectId);
    case "leaveProject": return runLeaveProjectDialog(host, request.projectId);
    case "joinProject": return runJoinProjectDialog(host, request.invite);
    case "shareFolder":
      if (request.path === undefined) { showToast("Open a folder of the library to share it.", "info"); return; }
      return runShareFolderDialog(host, request.path);
    case "manageLinks": return runManageShareLinksDialog(host);
    case "importLink": return runImportShareLinkDialog(host, request.link);
  }
}
