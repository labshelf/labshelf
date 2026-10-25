// Runs the sharing dialog a library UI request asks for.
import { toast } from "../../ui/dom/index.js";
import type { SharingDialogRequest, SharingHost } from "../share/index.js";
import { runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog } from "../../collab/dom/index.js";
import { runImportLinkDialog, runManageLinksDialog, runShareFolderDialog } from "../../share/dom/index.js";

export async function runSharingDialog(host: SharingHost, request: SharingDialogRequest): Promise<void> {
  switch (request.kind) {
    case "shareProject": return runShareProjectDialog(host, request.projectId);
    case "leaveProject": return runLeaveProjectDialog(host, request.projectId);
    case "joinProject": return runJoinProjectDialog(host, request.invite);
    case "shareFolder":
      if (request.path === undefined) { toast("Open a folder of the library to share it.", "info"); return; }
      return runShareFolderDialog(host, request.path);
    case "manageLinks": return runManageLinksDialog(host);
    case "importLink": return runImportLinkDialog(host, request.link);
  }
}
