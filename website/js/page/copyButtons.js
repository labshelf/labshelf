// A copy button on every code block, so commands and the BibTeX entry go to the clipboard without the prompt.

import { h, copyText, toast } from "../dom.js";
import { icon } from "../icons.js";

export function initCopyButtons() {
  for (const pre of document.querySelectorAll("#viewer pre")) {
    const button = h("button", { class: "copy", type: "button", title: "Copy", html: icon("copy") });
    button.addEventListener("click", async () => {
      const text = [...pre.childNodes].filter((n) => n !== button).map((n) => n.textContent).join("").replace(/^\$ /gm, "").trimEnd();
      toast((await copyText(text)) ? "Copied" : "Copy failed: select the text instead");
    });
    pre.append(button);
  }
}
