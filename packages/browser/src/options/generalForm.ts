/** Builds the registry contact section (email) and the section for asking authors for a PDF (name, affiliation, email language). */
import { DEFAULT_CONTACT_EMAIL, REQUEST_LANGUAGES, REQUEST_LANGUAGE_NAME, isRequestLanguage } from "@labshelf/core";
import { selectField, settingRow, settingsSection, textField } from "@labshelf/core/dom";
import type { LabShelfSettings } from "../platform";

export interface GeneralForm {
  sections: HTMLElement[];
  /** Every control, for listening to edits. */
  controls: HTMLElement[];
  read(): Partial<LabShelfSettings>;
  fill(settings: LabShelfSettings): void;
}

export function createGeneralForm(): GeneralForm {
  const email = textField({ id: "contact-email", type: "email", placeholder: "you@example.com" });

  const name = textField({ id: "requester-name", type: "text", placeholder: "Ada Lovelace" });
  const affiliation = textField({ id: "requester-affiliation", type: "text", placeholder: "University of London" });
  const language = selectField({
    id: "request-language",
    width: "md",
    options: REQUEST_LANGUAGES.map((value) => ({ value, label: REQUEST_LANGUAGE_NAME[value] })),
  });

  const registry = settingsSection(
    { title: "Registry contact" },
    settingRow({
      label: "Contact email",
      labelFor: "contact-email",
      description: "Sent to Unpaywall and in the CrossRef User-Agent, as both services ask.",
    }, email.element),
  );
  const requesting = settingsSection(
    { title: "Requesting PDFs from authors", description: "When no PDF can be found, LabShelf can open an email to the author in your mail client. It never sends anything itself." },
    settingRow({ label: "Your name", labelFor: "requester-name", description: "Signs the email. Left empty, the email carries no name." }, name.element),
    settingRow({ label: "Your affiliation", labelFor: "requester-affiliation", description: "Written under your name." }, affiliation.element),
    settingRow({ label: "Email language", labelFor: "request-language" }, language.element),
  );
  return {
    sections: [registry, requesting],
    controls: [email.control, name.control, affiliation.control, language.control],
    read: () => ({
      contactEmail: email.control.value.trim() || DEFAULT_CONTACT_EMAIL,
      requesterName: name.control.value.trim(),
      requesterAffiliation: affiliation.control.value.trim(),
      ...(isRequestLanguage(language.control.value) ? { requestLanguage: language.control.value } : {}),
    }),
    fill(settings) {
      email.control.value = settings.contactEmail;
      name.control.value = settings.requesterName;
      affiliation.control.value = settings.requesterAffiliation;
      language.control.value = settings.requestLanguage;
    },
  };
}
