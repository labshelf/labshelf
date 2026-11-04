// Adds the core reader styles to the page, scoped to the demo so the host page keeps its own look.
import codeThemes from "@labshelf/core/styles/code-themes.css";
import tokens from "@labshelf/core/styles/tokens.css";
import toastStyles from "@labshelf/core/styles/toast.css";
import readerStyles from "@labshelf/core/styles/reader.css";

const SCOPE = '[data-demo="reader"], .rd-popover';

export function installReaderStyles(): void {
  const style = document.createElement("style");
  // Tokens and toasts stay global: they are custom properties and .ls-toast* classes only.
  style.textContent = `${tokens}\n${codeThemes}\n${toastStyles}\n@scope (${SCOPE}) {\n${readerStyles}\n}`;
  document.head.append(style);
}
