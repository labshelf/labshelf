// Types the hero command once, then prints its listing line by line.
// The final state is in the HTML, so the page is complete without this script.

import { $, escapeHtml, reducedMotion } from "../dom.js";

const COMMAND = " labshelf search status:reading";
const PROMPT = '<span class="prompt">&gt;</span>';
const CURSOR = '<span class="cur"></span>';

export function initHeroTyping() {
  if (reducedMotion) return;
  const [commandLine, ...output] = $("#hero-term").children;
  const finalHtml = commandLine.innerHTML;
  for (const line of output) line.style.visibility = "hidden";
  let typed = 0;
  const step = () => {
    typed++;
    commandLine.innerHTML = PROMPT + escapeHtml(COMMAND.slice(0, typed)) + CURSOR;
    if (typed < COMMAND.length) {
      setTimeout(step, 28);
      return;
    }
    commandLine.innerHTML = finalHtml;
    output.forEach((line, k) => setTimeout(() => (line.style.visibility = ""), 140 + k * 110));
  };
  commandLine.innerHTML = PROMPT + CURSOR;
  setTimeout(step, 350);
}
