// Copies a command from its copy button, or selects it for a manual copy when the clipboard refuses.

import { $, $$ } from "./dom.js";
import { toast } from "./toast.js";

function selectContents(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  toast("selected · press Ctrl+C");
}

async function copyFrom(el, button) {
  try {
    await navigator.clipboard.writeText(el.innerText);
    button.textContent = "copied";
    setTimeout(() => (button.textContent = "copy"), 1200);
  } catch {
    selectContents(el);
  }
}

export function initCopyButtons() {
  for (const button of $$(".cp")) {
    const source = () => (button.dataset.copy ? $(button.dataset.copy) : button.parentElement.querySelector("pre"));
    button.addEventListener("click", () => copyFrom(source(), button));
  }
}
