// Adds the core reader styles to the page, scoped to the demo so the host page keeps its own look.
import tokens from "@labshelf/core/styles/tokens.css";
import toastStyles from "@labshelf/core/styles/toast.css";
import readerStyles from "@labshelf/core/styles/reader.css";
// TRAP: reader.css @imports this sheet by a relative URL, which a text import cannot follow.
import citationCard from "@labshelf/core/styles/citation-card.css";

const SCOPE = '[data-demo="reader"], .rd-popover';

export function installReaderStyles(): void {
  const reader = readerStyles.replace(/@import[^;]+;/g, "");
  const style = document.createElement("style");
  // Tokens and toasts stay global: they are custom properties and .ls-toast* classes only.
  style.textContent = `${tokens}\n${toastStyles}\n@scope (${SCOPE}) {\n${citationCard}\n${reader}\n}`;
  document.head.append(style);
}
