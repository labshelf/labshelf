/** Builds the Sync and PDF resolution sections: auto-sync interval, contact email and the Sci-Hub fallback. */
import { DEFAULT_CONTACT_EMAIL } from "@labshelf/core";
import {
  checkboxField, inlineCode, numberField, setRowDisabled, settingRow, settingsSection, textField,
} from "@labshelf/core/dom";
import { DEFAULT_SCI_HUB_MIRROR, type LabShelfSettings } from "../platform";

export interface GeneralForm {
  sections: HTMLElement[];
  /** Every control, for listening to edits. */
  controls: HTMLElement[];
  read(): Partial<LabShelfSettings>;
  fill(settings: LabShelfSettings): void;
}

export function createGeneralForm(): GeneralForm {
  const interval = numberField({ id: "sync-interval", min: 0, max: 240, step: 1, width: "sm" });
  const email = textField({ id: "contact-email", type: "email", placeholder: "you@example.com" });
  const sciHub = checkboxField({ id: "enable-scihub", label: "Enable the Sci-Hub fallback" });
  const mirror = textField({ id: "scihub-mirror", type: "url", placeholder: DEFAULT_SCI_HUB_MIRROR });
  const mirrorRow = settingRow({ label: "Sci-Hub mirror", labelFor: "scihub-mirror" }, mirror.element);
  const dimMirror = (): void => setRowDisabled(mirrorRow, !sciHub.control.checked);
  sciHub.control.addEventListener("change", dimMirror);

  const sync = settingsSection(
    { title: "Sync" },
    settingRow({
      label: "Auto-sync interval",
      labelFor: "sync-interval",
      description: ["Minutes between background syncs. ", inlineCode("0"), " disables the timer; syncing on idle and after edits still runs."],
    }, interval.element),
    settingRow({
      label: "Contact email",
      labelFor: "contact-email",
      description: "Sent to Unpaywall and in the CrossRef User-Agent, as both services ask.",
    }, email.element),
  );
  const resolution = settingsSection(
    {
      title: "PDF resolution",
      description: "LabShelf tries page hints → arXiv → CrossRef → Unpaywall, in order. When everything fails, an optional Sci-Hub fallback can run.",
    },
    settingRow({}, sciHub.element),
    mirrorRow,
  );

  return {
    sections: [sync, resolution],
    controls: [interval.control, email.control, sciHub.control, mirror.control],
    read: () => ({
      autoSyncMinutes: Math.min(240, Math.max(0, Number(interval.control.value) || 0)),
      contactEmail: email.control.value.trim() || DEFAULT_CONTACT_EMAIL,
      enableSciHub: sciHub.control.checked,
      sciHubMirror: (mirror.control.value.trim() || DEFAULT_SCI_HUB_MIRROR).replace(/\/+$/, ""),
    }),
    fill(settings) {
      interval.control.value = String(settings.autoSyncMinutes);
      email.control.value = settings.contactEmail;
      sciHub.control.checked = settings.enableSciHub;
      mirror.control.value = settings.sciHubMirror;
      dimMirror();
    },
  };
}
