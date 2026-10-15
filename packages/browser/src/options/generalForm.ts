/** Builds the Sync section: auto-sync interval and the contact email the registries ask for. */
import { DEFAULT_CONTACT_EMAIL } from "@labshelf/core";
import { inlineCode, numberField, settingRow, settingsSection, textField } from "@labshelf/core/dom";
import type { LabShelfSettings } from "../platform";

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
  return {
    sections: [sync],
    controls: [interval.control, email.control],
    read: () => ({
      autoSyncMinutes: Math.min(240, Math.max(0, Number(interval.control.value) || 0)),
      contactEmail: email.control.value.trim() || DEFAULT_CONTACT_EMAIL,
    }),
    fill(settings) {
      interval.control.value = String(settings.autoSyncMinutes);
      email.control.value = settings.contactEmail;
    },
  };
}
