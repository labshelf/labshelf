// Builds the options page from core components and autosaves every change, debounced, with a "Saved" flag.
// Reader preferences mirror VS Code's labshelf.reader.* settings.
import { $, settingsPage } from "@labshelf/core/dom";
import { createBrowserLatexHelper, createHelperSetupSection } from "../helper";
import { StorageRingLogSink, bx, createBrowserLogger, getSettings, updateSettings } from "../platform";
import { loadReaderPrefs, saveReaderPrefs } from "../reader/access";
import { applyTheme } from "../ui";
import { createAppearanceSection } from "./appearanceSection";
import { createResolverSection } from "./customResolvers";
import type { EditableListSection } from "./editableList";
import { createGeneralForm, type GeneralForm } from "./generalForm";
import { createLogSection } from "./logSection";
import { createProxySection } from "./proxy";
import { createReaderForm, type ReaderForm } from "./readerForm";
import { createSavedFlag } from "./savedFlag";

const ring = new StorageRingLogSink();
const logger = createBrowserLogger(ring);
const SAVE_DEBOUNCE_MS = 400;

/** Runs `save` once the user has paused editing any of `controls`; the returned function requests a save for controls the caller manages itself. */
function autosave(controls: HTMLElement[], save: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  for (const control of controls) {
    control.addEventListener("input", schedule);
    control.addEventListener("change", schedule);
  }
  return schedule;
}

type Saved = ReturnType<typeof createSavedFlag>;

/** Persists a proxy or resolver list as one settings key and logs how many entries were stored. */
function autosaveList(section: EditableListSection, key: "proxies" | "customResolvers", message: string, saved: Saved): () => void {
  return autosave([], async () => {
    const list = section.read();
    await updateSettings({ [key]: list });
    await logger.log("INFO", "options", message, { count: list.length });
    saved.flash();
  });
}

function autosaveForms(general: GeneralForm, reader: ReaderForm, saved: Saved): void {
  autosave(general.controls, async () => {
    const patch = general.read();
    await updateSettings(patch);
    await logger.log("INFO", "options", "settings saved", patch as Record<string, unknown>);
    saved.flash();
  });
  autosave(reader.controls, async () => {
    // Normalized on save: an out-of-range delay is clamped, and the form shows what was stored.
    const stored = await saveReaderPrefs(reader.read());
    reader.fill(stored, true);
    await logger.log("INFO", "options", "reader preferences saved", stored as unknown as Record<string, unknown>);
    saved.flash();
  });
}

async function init(): Promise<void> {
  applyTheme();
  const saved = createSavedFlag();
  const general = createGeneralForm();
  const reader = createReaderForm();
  let scheduleProxySave = (): void => undefined;
  const proxies = createProxySection(() => scheduleProxySave());
  let scheduleResolverSave = (): void => undefined;
  const resolvers = createResolverSection(() => scheduleResolverSave());
  const log = createLogSection(ring);

  $("root").replaceChildren(settingsPage(
    { title: "LabShelf Settings", aside: saved.element },
    ...general.sections,
    proxies.element,
    resolvers.element,
    reader.section,
    createHelperSetupSection(createBrowserLatexHelper(logger), {
      logger,
      getPlatformInfo: () => bx.runtime.getPlatformInfo(),
      openUrl: (url) => void bx.tabs.create({ url }),
    }),
    createAppearanceSection(saved.flash),
    log.element,
  ));

  const settings = await getSettings();
  general.fill(settings);
  reader.fill(await loadReaderPrefs());
  proxies.fill(settings.proxies);
  resolvers.fill(settings.customResolvers);
  autosaveForms(general, reader, saved);
  scheduleProxySave = autosaveList(proxies, "proxies", "library proxies saved", saved);
  scheduleResolverSave = autosaveList(resolvers, "customResolvers", "custom resolvers saved", saved);
  await log.refresh();
}

void init();
