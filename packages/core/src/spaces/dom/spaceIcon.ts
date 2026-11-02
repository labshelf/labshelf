// The glyph a Space shows on its card, its sidebar row and its page header.
import { renderIcon, renderTablerIcon } from "../../ui/icons/index.js";

/** The Space's own Tabler icon, or the layers icon when it has none or the name is unknown. */
export function renderSpaceIcon(icon: string | undefined): string {
  return (icon ? renderTablerIcon(icon) : null) ?? renderIcon("layers");
}
