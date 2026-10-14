// Starts the site's reader: document features first, then the chrome around them, then the keyboard.

import { hydrateIcons } from "./icons.js";
import { isMac } from "./dom.js";
import { initMedia } from "./page/media.js";
import { initFigureTabs } from "./page/figureTabs.js";
import { initCopyButtons } from "./page/copyButtons.js";
import { initReadingList } from "./page/readingList.js";
import { initQueryDemo } from "./page/queryDemo.js";
import { initTheme } from "./chrome/themePopover.js";
import { initNavigation } from "./document/navigation.js";
import { initZoom } from "./document/zoom.js";
import { initSidebar } from "./chrome/sidebar.js";
import { initOutline } from "./document/outline.js";
import { initThumbnails } from "./document/thumbnails.js";
import { initHighlights } from "./document/highlights.js";
import { initSelection } from "./document/selection.js";
import { initHover } from "./document/hover.js";
import { initFind } from "./chrome/findBar.js";
import { initStatusPill } from "./chrome/statusPill.js";
import { initToolbar } from "./chrome/toolbar.js";
import { initKeys } from "./keyboard/keys.js";

/** Key labels in the text follow the platform, as the apps' tooltips do. */
function localizeKeys() {
  if (!isMac) return;
  for (const kbd of document.querySelectorAll("kbd[data-mod]")) kbd.textContent = "Cmd";
  for (const kbd of document.querySelectorAll("kbd[data-alt]")) kbd.textContent = "Option";
}

hydrateIcons();
localizeKeys();
initTheme();
initMedia();
initFigureTabs();
initQueryDemo();
initCopyButtons();
initHighlights();
initZoom();
initThumbnails();
initOutline();
initSidebar();
initSelection();
initHover();
initFind();
initStatusPill();
initToolbar();
initKeys();
initReadingList();
initNavigation();
