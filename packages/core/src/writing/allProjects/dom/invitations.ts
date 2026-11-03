/**
 * Mounts the Invitations block above the All projects list: the "Receive invitations by email" toggle and, while it is on, the inbox's
 * invitations with Accept and Decline. Hidden while the host offers no project sharing; both apps get it through mountAllProjects.
 */
import type { InvitationView, ShareHost } from "../../../share/index.js";
import { reportFailure, showNoticeDialog } from "../../../share/dom/index.js";
import { renderCheckboxField, renderElement, showToast } from "../../../ui/dom/index.js";

export interface InvitationsBlock {
  root: HTMLElement;
  /** Stops following the host's offers and invitations and removes the block. */
  dispose(): void;
}

const TOGGLE_LABEL = "Receive invitations by email";
let blockCount = 0;

/** The sender as the row names them: name, else email, else the card's fingerprint. */
const senderOf = (invitation: InvitationView): string => invitation.from.name ?? invitation.from.email ?? invitation.from.fingerprint;

type Checkbox = ReturnType<typeof renderCheckboxField>;

async function acceptOne(sharing: ShareHost, invitation: InvitationView): Promise<void> {
  const result = await sharing.acceptInvitation(invitation.id, new AbortController().signal);
  if (result.kind === "refused") { await showNoticeDialog(`Could not accept the invitation to "${invitation.title}"`, result.problem, "warning"); return; }
  if (result.kind === "active") { showToast(`"${invitation.title}" is already connected here.`, "info"); return; }
  showToast(`Joined "${result.name}".`, "ok");
}

/** Wraps an accept or decline so the row's buttons stay disabled while it runs and a second click is ignored. */
function guardedAction(busy: Set<string>, id: string, buttons: HTMLButtonElement[], action: string, task: () => Promise<void>): () => Promise<void> {
  const setDisabled = (disabled: boolean): void => { for (const button of buttons) button.disabled = disabled; };
  return async () => {
    if (busy.has(id)) return;
    busy.add(id);
    setDisabled(true);
    try {
      await reportFailure(action, task);
    } finally {
      busy.delete(id);
      setDisabled(false);
    }
  };
}

function renderRow(sharing: ShareHost, busy: Set<string>, invitation: InvitationView): HTMLElement {
  const accept = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Accept" });
  const decline = renderElement("button", { class: "ls-btn", type: "button", text: "Decline" });
  accept.disabled = decline.disabled = busy.has(invitation.id);
  const guard = (action: string, task: () => Promise<void>) => guardedAction(busy, invitation.id, [accept, decline], action, task);
  accept.addEventListener("click", () => void guard("accept the invitation", () => acceptOne(sharing, invitation))());
  decline.addEventListener("click", () => void guard("decline the invitation", () => sharing.declineInvitation(invitation.id))());
  return renderElement("div", { class: "ls-invitation-row", role: "listitem", "data-id": invitation.id },
    renderElement("span", { class: "ls-invitation-title", text: invitation.title }),
    renderElement("span", { class: "ls-invitation-from", text: senderOf(invitation) }),
    renderElement("span", { class: "ls-invitation-actions" }, accept, decline));
}

/** Sends the box's new state to the host, then re-reads the setting and the list; the box stays disabled meanwhile. */
function wireToggle(toggle: Checkbox, sharing: ShareHost, refresh: () => Promise<void>): void {
  toggle.control.addEventListener("change", () => {
    const on = toggle.control.checked;
    toggle.control.disabled = true;
    void (async () => {
      try {
        // The host's refusal (no relay, directory unavailable) reaches the user through reportFailure; the re-read puts the box back.
        await reportFailure(`turn invitations by email ${on ? "on" : "off"}`, () => sharing.setInvitationsEnabled(on));
        await refresh();
      } finally {
        toggle.control.disabled = false;
      }
    })();
  });
}

export function mountInvitations(sharing: ShareHost): InvitationsBlock {
  const toggle = renderCheckboxField({ id: `ls-invitations-toggle-${++blockCount}`, label: TOGGLE_LABEL });
  const list = renderElement("div", { class: "ls-invitations-list", role: "list", "aria-label": "Invitations" });
  const root = renderElement("section", { class: "ls-invitations", "aria-label": "Invitations" },
    renderElement("div", { class: "ls-invitations-toggle" }, toggle.element), list);
  let enabled = false;
  let invitations: InvitationView[] = [];
  // Ids with an accept or decline in flight, so a re-render during the call keeps their buttons disabled.
  const busy = new Set<string>();
  let loaded = false;

  const renderList = (): void => {
    list.replaceChildren(...(enabled ? invitations.map((invitation) => renderRow(sharing, busy, invitation)) : []));
    list.hidden = list.childElementCount === 0;
  };
  const readEnabled = (): Promise<void> => reportFailure("read the invitations setting", async () => {
    enabled = await sharing.invitationsEnabled();
    toggle.control.checked = enabled;
    renderList();
  });
  const readInvitations = (): Promise<void> => reportFailure("read the invitations", async () => {
    invitations = await sharing.invitations();
    renderList();
  });
  const refresh = async (): Promise<void> => { await readEnabled(); await readInvitations(); };

  wireToggle(toggle, sharing, refresh);

  const follow = (): void => {
    const offered = sharing.offers().projects;
    root.hidden = !offered;
    if (offered && !loaded) { loaded = true; void refresh(); }
  };
  const stopOffers = sharing.onOffersChange(follow);
  const stopInvitations = sharing.onInvitationsChange((next) => { invitations = next; renderList(); });
  renderList();
  follow();
  return { root, dispose() { stopOffers(); stopInvitations(); root.remove(); } };
}
