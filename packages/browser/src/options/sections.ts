// Builds the options page sections: Appearance, registry contact and author-request form, Library location, Sidebar, Recent log, and the "Saved" flag shown after a setting is stored.
import { renderIcon, type IconName, DEFAULT_CONTACT_EMAIL, REQUEST_LANGUAGES, REQUEST_LANGUAGE_NAME, isRequestLanguage, formatError, type ILogger, createDebouncer } from "@labshelf/core";
import { renderElement, renderSettingRow, renderSettingsSection, type ThemePref, renderPickField, renderTextField, renderActionButton, renderInlineCode, createToneLine, renderCheckboxField } from "@labshelf/core/dom";
import { readThemePref, onThemeChange, setThemePref, type ExtensionSettings, type StorageRingLogSink, withSidebarSection, type SidebarSections } from "../platform";
import { canPickFolder, renderFolderPathForm, pickLibraryFolder, refreshLibraryLocation, describeSourceReason } from "../storage/library";
import { readLibraryLocation, type LibraryLocation } from "../storage";

const THEME_OPTIONS: Array<[ThemePref, string, IconName]> = [["auto", "System", "globe"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];

/** `onPicked` runs after the user picks a theme, e.g. to flash the "Saved" flag. */
export function createAppearanceSection(onPicked: () => void): HTMLElement {
  const seg = renderElement("div", { class: "settings-seg", role: "radiogroup", "aria-label": "Theme" });
  const render = (current: ThemePref): void => {
    seg.replaceChildren(...THEME_OPTIONS.map(([pref, label, glyph]) => {
      const button = renderElement("button", {
        class: current === pref ? "on" : "", type: "button", role: "radio", "aria-checked": String(current === pref), html: renderIcon(glyph),
      });
      button.append(renderElement("span", { text: label }));
      button.addEventListener("click", () => { setThemePref(pref); onPicked(); });
      return button;
    }));
  };
  onThemeChange((_theme, pref) => render(pref));
  render(readThemePref());
  return renderSettingsSection(
    { title: "Appearance" },
    renderSettingRow({ label: "Theme", description: "The library, popup and this page follow the system by default." }, seg),
  );
}

export interface GeneralForm {
  sections: HTMLElement[];
  /** Every control, for listening to edits. */
  controls: HTMLElement[];
  read(): Partial<ExtensionSettings>;
  fill(settings: ExtensionSettings): void;
}

export function createGeneralForm(): GeneralForm {
  const email = renderTextField({ id: "contact-email", type: "email", placeholder: "you@example.com" });

  const name = renderTextField({ id: "requester-name", type: "text", placeholder: "Ada Lovelace" });
  const affiliation = renderTextField({ id: "requester-affiliation", type: "text", placeholder: "University of London" });
  const language = renderPickField({
    id: "request-language",
    width: "md",
    options: REQUEST_LANGUAGES.map((value) => ({ value, label: REQUEST_LANGUAGE_NAME[value] })),
  });

  const registry = renderSettingsSection(
    { title: "Registry contact" },
    renderSettingRow({
      label: "Contact email",
      labelFor: "contact-email",
      description: "Sent to Unpaywall and in the CrossRef User-Agent, as both services ask.",
    }, email.element),
  );
  const requesting = renderSettingsSection(
    { title: "Requesting PDFs from authors", description: "When no PDF can be found, LabShelf can open an email to the author in your mail client. It never sends anything itself." },
    renderSettingRow({ label: "Your name", labelFor: "requester-name", description: "Signs the email. Left empty, the email carries no name." }, name.element),
    renderSettingRow({ label: "Your affiliation", labelFor: "requester-affiliation", description: "Written under your name." }, affiliation.element),
    renderSettingRow({ label: "Email language", labelFor: "request-language" }, language.element),
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

function sourceRow(source: LibraryLocation): HTMLElement {
  if (source.kind === "folder") return renderSettingRow({ label: "Stored in" }, renderElement("span", {}, "Folder: ", renderInlineCode(source.root)));
  return renderSettingRow({ label: "Stored in", description: describeSourceReason(source) }, renderElement("span", { text: "This browser" }));
}

export function createLibraryLocationSection(logger: ILogger): HTMLElement {
  const status = createToneLine();
  const row = renderElement("div");
  const show = (source: LibraryLocation): void => {
    row.replaceChildren(sourceRow(source));
    if (source.kind === "browser" && source.reason === "no-library") row.append(renderFolderPathForm(logger, show));
    // A bridge folder belongs to the desktop apps, which change it themselves.
    if (canPickFolder() && (source.kind === "browser" || source.via === "picked")) row.append(renderSettingRow({}, pick(source)));
  };
  const pick = (source: LibraryLocation): HTMLElement => renderActionButton({
    label: source.kind === "folder" ? "Choose another folder" : "Choose a folder on this computer", icon: "folder",
    onClick: async () => {
      try {
        const next = await pickLibraryFolder(logger);
        if (next) show(next);
      } catch (err) {
        await logger.error("options", err, { action: "pick library folder" });
        status.set("Could not use this folder", "error", formatError(err));
      }
    },
  });
  const check = renderActionButton({
    label: "Check again", icon: "refresh",
    onClick: async () => {
      status.set("Checking…", "idle");
      try {
        show(await refreshLibraryLocation(logger));
        status.set("", "idle");
      } catch (err) {
        await logger.error("options", err);
        status.set("Could not check", "error", formatError(err));
      }
    },
  });
  status.set("Checking…", "idle");
  readLibraryLocation().then(
    (source) => { show(source); status.set("", "idle"); },
    (err: unknown) => { void logger.error("options", err); status.set("Could not check", "error", formatError(err)); },
  );
  return renderSettingsSection({ title: "Library" }, row, renderSettingRow({}, check), status.element);
}

export interface LogSection {
  element: HTMLElement;
  refresh(): Promise<void>;
}

export function createLogSection(ring: StorageRingLogSink): LogSection {
  const log = renderElement("pre", { class: "settings-log", text: "Loading…" });
  return {
    element: renderSettingsSection({ title: "Recent log", description: "The last background events, for troubleshooting." }, log),
    async refresh() {
      const entries = await ring.recent();
      log.textContent = entries.length === 0
        ? "No log entries yet."
        : entries.map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.module}) ${e.message}`).join("\n");
    },
  };
}

const VISIBLE_MS = 2000;

export interface SavedNotice {
  element: HTMLElement;
  flash(): void;
}

export function createSavedNotice(): SavedNotice {
  const element = renderElement("span", { class: "settings-saved", "aria-live": "polite", html: `${renderIcon("check")}<span>Saved</span>` });
  const hide = createDebouncer(() => element.classList.remove("show"), VISIBLE_MS);
  return {
    element,
    flash() {
      element.classList.add("show");
      hide.call();
    },
  };
}

export interface SidebarSectionsForm {
  section: HTMLElement;
  fill(sections: SidebarSections): void;
}

/** `onChange` stores the sections whenever the user changes them. */
export function createSidebarSectionsForm(onChange: (sections: SidebarSections) => void): SidebarSectionsForm {
  const fields = {
    library: renderCheckboxField({ id: "sidebar-library", label: "Library" }),
    projects: renderCheckboxField({ id: "sidebar-projects", label: "Projects" }),
  };
  let current: SidebarSections = { library: true, projects: true };
  const fill = (sections: SidebarSections): void => {
    current = sections;
    fields.library.control.checked = sections.library;
    fields.projects.control.checked = sections.projects;
  };
  for (const key of ["library", "projects"] as const) {
    fields[key].control.addEventListener("change", () => {
      const next = withSidebarSection(current, key, fields[key].control.checked);
      const changed = next !== current;
      // A refused change puts the box back.
      fill(next);
      if (changed) onChange(next);
    });
  }
  return {
    section: renderSettingsSection(
      { title: "Sidebar", description: "The sections the library page sidebar shows. A hidden section loads nothing. One section always stays on; reload the library page to apply a change." },
      renderSettingRow({}, fields.library.element),
      renderSettingRow({}, fields.projects.element),
    ),
    fill,
  };
}
