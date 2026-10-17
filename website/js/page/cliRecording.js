// Plays a CLI session in a loop, typing each command before its output; under reduced motion it shows the end state.

import { $, escapeHtml, reducedMotion } from "../dom.js";

// Output entries are trusted markup; command entries are plain text.
const SESSION = [
  ["cmd", "labshelf add 2205.14135"],
  ["out", '<span class="c">arXiv</span> FlashAttention: fast and memory-efficient exact attention'],
  ["out", '<span class="st-done">✓</span> saved as <b>dao2022</b> → Systems/   PDF 2.1 MB'],
  ["gap"],
  ["cmd", "labshelf ls status:unread in:Systems"],
  ["out", '<span class="st-un">unread</span>   dao2022        FlashAttention                 2022'],
  ["out", '<span class="st-un">unread</span>   tay2022        Efficient transformers: a survey 2022'],
  ["gap"],
  ["cmd", "labshelf check thesis.tex"],
  ["out", '<span class="st-miss">error</span>  intro.tex:57  undefined citation vaswani2018'],
  ["out", '       <span class="n">did you mean vaswani2017? (on your shelf)</span>'],
  ["out", '<span class="n">warn</span>   refs.bib      dosovitskiy2020 is now ICLR 2021'],
  ["out", '<span class="c">1 error, 1 warning · exit 1</span>'],
];
const CURSOR = '<span class="cur"></span>';
const line = (html) => `<span class="ln">${html}</span>`;
const promptLine = (html) => line(`<span class="prompt">&gt;</span> ${html}`);

function render(count) {
  return SESSION.slice(0, count)
    .map(([kind, text]) => (kind === "cmd" ? promptLine(escapeHtml(text)) : kind === "gap" ? line(" ") : line(text)))
    .join("");
}

export function initCliRecording() {
  const el = $("#rec");
  const finished = () => render(SESSION.length) + promptLine(CURSOR);
  if (reducedMotion) {
    el.innerHTML = finished();
    return;
  }
  let entry = 0;
  let typed = 0;
  const tick = () => {
    if (entry === SESSION.length) {
      el.innerHTML = finished();
      entry = 0;
      setTimeout(tick, 3200);
      return;
    }
    const [kind, text] = SESSION[entry];
    if (kind === "cmd") {
      typed++;
      el.innerHTML = render(entry) + promptLine(escapeHtml(text.slice(0, typed)) + CURSOR);
      if (typed < text.length) {
        setTimeout(tick, 45);
        return;
      }
      entry++;
      typed = 0;
      setTimeout(tick, 420);
      return;
    }
    entry++;
    el.innerHTML = render(entry) + line(CURSOR);
    setTimeout(tick, kind === "gap" ? 250 : 300);
  };
  el.innerHTML = render(SESSION.length);
  setTimeout(tick, 1200);
}
