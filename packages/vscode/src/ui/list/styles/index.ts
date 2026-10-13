/**
 * The list webview stylesheet: its area files in cascade order.
 */
import { BASE_CSS } from "./baseStyles.js";
import { HEADER_CSS } from "./headerStyles.js";
import { TABLE_CSS } from "./tableStyles.js";
import { DETAIL_HEAD_CSS } from "./detailHeadStyles.js";
import { DETAIL_SECTION_CSS } from "./detailSectionStyles.js";
import { ANNOTATION_CSS } from "./annotationStyles.js";
import { TEXT_LAYER_CSS } from "./textLayerStyles.js";
import { MENU_CSS } from "./menuStyles.js";

export function listPanelCss(): string {
  return [BASE_CSS, HEADER_CSS, TABLE_CSS, DETAIL_HEAD_CSS, DETAIL_SECTION_CSS, ANNOTATION_CSS, TEXT_LAYER_CSS, MENU_CSS].join("");
}
