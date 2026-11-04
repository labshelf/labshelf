// Runs the project-sharing dialogs: share a project, show its invite, invite by email, join from an invite and stop sharing.
import {
  askInputBox, mountFormDialog, openProgressDialog, pickQuickEntry, renderElement, showDialog, showToast,
} from "../../ui/dom/index.js";
import { mountCombobox, type ComboboxSuggestion } from "./combobox.js";
import type { ContactView, InviteByEmailResult, JoinProjectResult, ShareHost, ShareProject, ShareProjectResult } from "../../share/index.js";
import { reportFailure, showNoticeDialog } from "../../share/dom/index.js";

/** `onlyShared` lists just the projects this device shares. Undefined when nothing was chosen. */
async function pickProject(host: ShareHost, projectId: string | undefined, onlyShared: boolean, title: string): Promise<ShareProject | undefined> {
  const all = await host.projects();
  if (projectId !== undefined) {
    const found = all.find((p) => p.id === projectId);
    if (!found) showToast("That project is not available here.", "info");
    return found;
  }
  const candidates = onlyShared ? all.filter((p) => p.shared) : all;
  if (candidates.length === 0) {
    showToast(onlyShared ? "No project is shared on this device." : "There are no projects to share.", "info");
    return undefined;
  }
  return pickQuickEntry(
    candidates.map((p) => ({ label: p.name, ...(p.shared ? { description: "shared" } : {}), icon: "link" as const, value: p })),
    { title, placeholder: "Pick a project" },
  );
}

const COPY_REFUSED_TEXT = "The clipboard refused the copy; select the link and copy it.";

/** Copies the invite for a project and tells the user how it went; true when the clipboard took it. */
export async function copyInvite(host: ShareHost, name: string, invite: string): Promise<boolean> {
  const copied = await host.copyText(invite);
  showToast(copied ? `Copied the invite link for "${name}".` : COPY_REFUSED_TEXT, copied ? "ok" : "error");
  return copied;
}

/** Keeps the dialog (and so the text) on screen until the copy works or the user moves on; it leads with what keeps the edits from this device. */
export function showInviteDialog(host: ShareHost, projectId: string, name: string, invite: string): Promise<void> {
  return reportFailure("show the invite link", async () => {
    const status = await host.projectStatus(projectId);
    const problem = status.kind === "shared" ? status.problem : undefined;
    for (;;) {
      const choice = await showDialog({
        title: `Invite link for "${name}"`,
        message: `${problem === undefined ? "" : `${problem}\n\n`}${invite}\n\nAnyone with it can read and edit the project.`,
        severity: problem === undefined ? "info" : "warning",
        buttons: [
          { id: "leave", label: "Stop Sharing on This Device…", danger: true },
          { id: "email", label: "Invite by Email…" },
          { id: "copy", label: "Copy Invite Link", primary: true },
        ],
      });
      if (choice === "leave") { await runLeaveProjectDialog(host, projectId); return; }
      if (choice === "email") { await runInviteByEmailDialog(host, projectId); return; }
      if (choice !== "copy" || await copyInvite(host, name, invite)) return;
    }
  });
}

/** Contacts without an email cannot be invited this way, so they are not suggested. */
const contactSuggestions = (contacts: ContactView[]): ComboboxSuggestion[] =>
  contacts.flatMap((c) => (c.email === undefined ? [] : [{ label: c.name, detail: c.email, value: c.email }]));

/** Asks for the address to invite, suggesting the library's contacts; undefined when dismissed. A failing contacts read gives no suggestions. */
async function askInviteEmail(host: ShareHost, name: string): Promise<string | undefined> {
  const contacts = await host.contacts().catch((): ContactView[] => []);
  return new Promise((resolve) => {
    const combobox = mountCombobox({
      label: "Email address", type: "email", name: "email", placeholder: "name@example.org", suggestions: contactSuggestions(contacts),
    });
    const error = renderElement("p", { class: "ls-dialog-error", role: "alert" });
    const form = renderElement("form", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Invite by Email" },
      renderElement("h2", { text: `Invite someone to "${name}" by email` }),
      renderElement("p", { text: "They receive the invitation in LabShelf; collaborators you already share with are suggested as you type." }),
      combobox.root, error);
    let settled = false;
    const settle = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      combobox.dispose();
      resolve(value);
    };
    const close = mountFormDialog(form, { submitLabel: "Send Invitation", unsubscribe: () => settle(undefined) });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = combobox.input.value.trim();
      if (email === "") { error.textContent = "Enter an email address"; return; }
      settle(email);
      close();
    });
    combobox.input.focus();
  });
}

/** The invitation did not go out; the host says why, and the invite link stands in. */
async function showInviteFallback(host: ShareHost, name: string, result: Extract<InviteByEmailResult, { fallback: "link" }>): Promise<void> {
  for (;;) {
    const choice = await showDialog({
      title: `The invitation to "${name}" was not sent`,
      message: result.message,
      severity: "warning",
      buttons: [{ id: "copy", label: "Copy Invite Link", primary: true }],
    });
    if (choice !== "copy" || await copyInvite(host, name, result.link)) return;
  }
}

/** Invites someone to a shared project by email: asks for the address with the contacts as suggestions, sends, and reports how it went. */
export function runInviteByEmailDialog(host: ShareHost, projectId: string): Promise<void> {
  return reportFailure("invite by email", async () => {
    const project = await pickProject(host, projectId, true, "Invite by Email");
    if (!project) return;
    const email = await askInviteEmail(host, project.name);
    if (email === undefined) return;
    const result = await host.inviteByEmail(project.id, email);
    if ("fallback" in result) { await showInviteFallback(host, project.name, result); return; }
    showToast(result.sent === "direct" ? `Sent the invitation to ${email}.` : `Sent the invitation to ${email} through the directory.`, "ok");
  });
}

export function runJoinProjectDialog(host: ShareHost, invite?: string): Promise<void> {
  return reportFailure("join the shared project", async () => {
    const text = invite ?? await askInputBox({
      title: "Join Shared Project",
      prompt: "Paste the invite link a collaborator sent you",
      placeholder: "labshelf://join#…",
      validate: (v) => (v.trim() === "" ? "Paste an invite link" : null),
    });
    if (!text) return;
    const progress = openProgressDialog({
      title: "Join Shared Project",
      message: "Joining the shared project: waiting for a member to answer",
      cancellable: true,
    });
    let result: JoinProjectResult;
    try {
      result = await host.joinProject(text, progress.signal);
    } catch (error) {
      if (progress.signal.aborted) return;
      throw error;
    } finally {
      progress.close();
    }
    if (progress.signal.aborted) return;
    if (result.kind === "refused") { await showNoticeDialog("Could not join the project", result.problem, "warning"); return; }
    if (result.kind === "active") { showToast("This shared project is already connected on this device.", "info"); return; }
    const joined = result;
    if (joined.place === "space") {
      await showNoticeDialog(`Joined the Space "${joined.name}".`, "It is in Spaces, with its notes, threads and projects.", "info");
      return;
    }
    const choice = await showDialog({
      title: `Joined "${joined.name}".`,
      severity: "info",
      buttons: [{ id: "open", label: "Open Project", primary: true }],
    });
    if (choice === "open") await host.openProject(joined.id);
  });
}

export function runLeaveProjectDialog(host: ShareHost, projectId?: string): Promise<void> {
  return reportFailure("stop sharing the project", async () => {
    const project = await pickProject(host, projectId, true, "Stop Sharing on This Device");
    if (!project) return;
    const choice = await showDialog({
      title: `Stop sharing "${project.name}" on this device?`,
      message: "The files stay, and the others keep editing their copies. To come back, paste the invite again, which joins it as a new project.",
      severity: "danger",
      buttons: [{ id: "leave", label: "Stop Sharing", primary: true, danger: true }],
    });
    if (choice !== "leave") return;
    await host.leaveProject(project.id);
    showToast(`"${project.name}" is no longer shared on this device. Its files stay.`, "ok");
  });
}

const SHARE_NOTICE = "Anyone with the invite link can read and edit this project and pass the link on. There are no roles, so send it only to collaborators. Edits travel through your Cloudflare relay, end-to-end encrypted.";

export function runShareProjectDialog(host: ShareHost, projectId?: string): Promise<void> {
  return reportFailure("share the project", async () => {
    const project = await pickProject(host, projectId, false, "Share Project");
    if (!project) return;
    const status = await host.projectStatus(project.id);
    if (status.kind === "ineligible") { await showNoticeDialog(`"${project.name}" cannot be shared`, status.reason, "warning"); return; }
    if (status.kind === "shared") { await showInviteDialog(host, project.id, project.name, await host.inviteLink(project.id)); return; }
    const choice = await showDialog({
      title: `Share "${project.name}"?`,
      message: SHARE_NOTICE,
      buttons: [{ id: "share", label: "Share", primary: true }],
    });
    if (choice !== "share") return;
    const progress = openProgressDialog({ title: `Sharing "${project.name}"`, message: `Sharing "${project.name}"…`, cancellable: true });
    let result: ShareProjectResult;
    try {
      result = await host.shareProject(project.id, progress.signal);
    } catch (error) {
      if (progress.signal.aborted) return;
      throw error;
    } finally {
      progress.close();
    }
    if (progress.signal.aborted) return;
    await showResult(host, project, result);
  });
}

async function showResult(host: ShareHost, project: { id: string; name: string }, result: ShareProjectResult): Promise<void> {
  if (result.kind === "shared") { await showInviteDialog(host, project.id, project.name, result.invite); return; }
  if (result.kind === "noRelay") {
    await showNoticeDialog("Connect Cloudflare to share", "Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
    return;
  }
  const choice = await showDialog({
    title: `"${project.name}" is shared, but its invite is not on this device. Paste it with Join Shared Project to reconnect.`,
    severity: "warning",
    buttons: [{ id: "join", label: "Join Shared Project…", primary: true }],
  });
  if (choice === "join") await runJoinProjectDialog(host);
}
