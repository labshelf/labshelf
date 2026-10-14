/**
 * The options page: builds the settings page from the core components, loads the stored settings into the forms and
 * autosaves every change (debounced, with a "Saved" flag), as the VS Code settings editor does. The reader
 * preferences are the browser twin of VS Code's labshelf.reader.* settings.
 */
import { $, settingsPage } from "@labshelf/core/dom";
import { BrowserLogger, getSettings, updateSettings } from "../platform";
import { loadReaderPrefs, saveReaderPrefs } from "../reader/readerPrefsStore";
import { applyTheme } from "../ui";
import { createAppearanceSection } from "./appearanceSection";
import { createDriveConnection } from "./driveConnection";
import { createGeneralForm } from "./generalForm";
import { createLogSection } from "./logSection";
import { createReaderForm } from "./readerForm";
import { createSavedFlag } from "./savedFlag";

const logger = new BrowserLogger("options");
const SAVE_DEBOUNCE_MS = 400;

/** Runs `save` once the user has paused editing any of `controls`. */
function autosave(controls: HTMLElement[], save: () => Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  for (const control of controls) {
    control.addEventListener("input", schedule);
    control.addEventListener("change", schedule);
  }
}

async function init(): Promise<void> {
  applyTheme();
  const saved = createSavedFlag();
  const general = createGeneralForm();
  const reader = createReaderForm();
  const log = createLogSection(logger);
  const drive = createDriveConnection(logger, () => log.refresh());

  $("root").replaceChildren(settingsPage(
    { title: "LabShelf Settings", aside: saved.element },
    drive.section.element,
    ...general.sections,
    reader.section,
    createAppearanceSection(saved.flash),
    log.element,
  ));

  general.fill(await getSettings());
  reader.fill(await loadReaderPrefs());
  autosave(general.controls, async () => {
    const patch = general.read();
    await updateSettings(patch);
    await logger.info("settings saved", patch as Record<string, unknown>);
    saved.flash();
  });
  autosave(reader.controls, async () => {
    // Normalized on save: an out-of-range delay is clamped, and the form shows what was stored.
    const stored = await saveReaderPrefs(reader.read());
    reader.fill(stored, true);
    await logger.info("reader preferences saved", stored as unknown as Record<string, unknown>);
    saved.flash();
  });
  await drive.refresh();
  await log.refresh();
}

void init();
