// Runs the citation demo: a citation opens its card, and Replace fixes the mistyped key and recompiles the sheet.

import { $ } from "../dom.js";
import { toast } from "../toast.js";
import { hidePopover, hidePopoverSoon, onPopoverClick, popoverOwner, showPopover } from "../popover.js";

const UNDEFINED_CARD = `<div class="t1">Cited key</div><h5 class="citekey">vaswani2018attention</h5><div class="ve">intro.tex:44</div>
  <div class="err">Not in your library</div><div class="acts"><button class="hi" data-fix>Replace with vaswani2017attention</button></div>`;
const PAPER_CARD = `<div class="t1">Cited paper</div><h5>Attention Is All You Need</h5><div class="ve">Vaswani et al. · 2017 · vaswani2017attention</div>
  <div class="hl">Without the scaling, large values of d_k make the dot products large and the gradients tiny.<small>your yellow highlight on p. 4</small></div>
  <div class="acts"><button data-t="opens the paper in the reader">Open paper</button><button data-t="opens intro.tex">Go to source</button></div>`;

let fixed = false;

function openCard(citation) {
  if (popoverOwner() === citation) return;
  citation.classList.add("on");
  showPopover(citation, citation.dataset.c === "undef" && !fixed ? UNDEFINED_CARD : PAPER_CARD);
}

function replaceKey() {
  fixed = true;
  hidePopover();
  const key = $("#k44");
  const status = $("#dst");
  const label = status.querySelector("span");
  key.textContent = "vaswani2017attention";
  key.classList.replace("bad", "new");
  status.classList.add("ch");
  label.textContent = "Source changed";
  setTimeout(() => (label.textContent = "Compiling…"), 700);
  setTimeout(() => {
    status.classList.remove("ch");
    label.textContent = "Compiled just now";
    const citation = $("#out .undef");
    citation.classList.remove("undef");
    citation.textContent = "[1]";
    citation.dataset.c = "ok";
    key.classList.remove("new");
    toast("fixed · 0 problems");
  }, 1500);
}

export function initCitationDemo() {
  const out = $("#out");
  const openFromEvent = (e) => {
    const citation = e.target.closest(".cit");
    if (citation) openCard(citation);
  };
  out.addEventListener("mouseover", openFromEvent);
  out.addEventListener("click", openFromEvent);
  out.addEventListener("focusin", openFromEvent);
  out.addEventListener("mouseout", (e) => {
    if (e.target.closest(".cit")) hidePopoverSoon(250);
  });
  onPopoverClick((e) => {
    const button = e.target.closest("button");
    if (button?.hasAttribute("data-fix")) replaceKey();
    else if (button?.dataset.t) {
      toast(button.dataset.t);
      hidePopover();
    }
  });
}
