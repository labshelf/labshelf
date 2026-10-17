// Starts the site: the overlays and links shared by every section, the page demos, then the manual in its reader.

import { initAnchorScroll } from "./anchorScroll.js";
import { initCopyButtons } from "./copyButtons.js";
import { initPopover } from "./popover.js";
import { initCitationDemo, initClips, initHeroTyping } from "./page/index.js";
import {
  initHighlightsList,
  initOutline,
  initSearch,
  initSectionPreviews,
  initSelectionBar,
  initSidePanelTabs,
} from "./manual/index.js";

initPopover();
initAnchorScroll();
initCopyButtons();

initHeroTyping();
initClips();
initCitationDemo();

initOutline();
initSidePanelTabs();
initHighlightsList();
initSelectionBar();
initSectionPreviews();
initSearch();
