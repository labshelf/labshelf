// Builds the options page from core components and autosaves every change, debounced, with a "Saved" flag.
// Reader preferences mirror VS Code's labshelf.reader.* settings.
import { $, settingsPage } from "@labshelf/core/dom";
import { StorageRingLogSink, createBrowserLogger, getSettings, updateSettings } from "../platform";
import { loadReaderPrefs, saveReaderPrefs } from "../reader/access";
import { applyTheme } from "../ui";
import { createAppearanceSection } from "./appearanceSection";
import { createResolverSection } from "./customResolvers";
import { createDriveConnection } from "./driveConnection";
import { createGeneralForm } from "./generalForm";
import { createLogSection } from "./logSection";
import { createProxySection } from "./proxySection";
import { createReaderForm } from "./readerForm";
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
  const drive = createDriveConnection(logger, () => log.refresh());

  $("root").replaceChildren(settingsPage(
    { title: "LabShelf Settings", aside: saved.element },
    drive.section.element,
    ...general.sections,
    proxies.element,
    resolvers.element,
    reader.section,
    createAppearanceSection(saved.flash),
    log.element,
  ));

  const settings = await getSettings();
  general.fill(settings);
  reader.fill(await loadReaderPrefs());
  proxies.fill(settings.proxies);
  resolvers.fill(settings.customResolvers);
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
  scheduleProxySave = autosave([], async () => {
    const list = proxies.read();
    await updateSettings({ proxies: list });
    await logger.log("INFO", "options", "library proxies saved", { count: list.length });
    saved.flash();
  });
  scheduleResolverSave = autosave([], async () => {
    const list = resolvers.read();
    await updateSettings({ customResolvers: list });
    await logger.log("INFO", "options", "custom resolvers saved", { count: list.length });
    saved.flash();
  });
  await drive.refresh();
  await log.refresh();
}

void init();
