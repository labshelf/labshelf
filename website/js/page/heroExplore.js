// Runs the hero's note: it lists the quotes added from the reader, and changing `scale` marks the plot out of date until Run reruns the cell and redraws it.

import { $, $$, reducedMotion } from "../dom.js";
import { PAGE_REF, onOpen, projectNotes, setGuide, story } from "./heroStory.js";

// The plot's points in the chart's own units: the flat scaled series, and the unscaled one that grows with the dimension.
const XS = [44, 104, 164, 224, 284];
const SCALED_Y = 128;
const UNSCALED_YS = [66.6, 56.4, 46.1, 35.9, 25.7];
const RERUN_MS = 450;
const NEXT = { tab: 2, label: "Discuss it" };

/** Lists the reader's notes at the top of the note; one that arrived since the last visit is marked as new. */
function initQuotes() {
  const host = $("#qmdQuotes");
  const seen = new Set(["cue"]);
  onOpen(1, () => {
    host.replaceChildren(...projectNotes().map((note) => {
      const block = document.createElement("div");
      block.className = seen.has(note.id) ? "qq" : "qq new";
      seen.add(note.id);
      block.innerHTML = `<blockquote>${note.quote}</blockquote><p class="from"><button type="button" class="qlink" data-open-tab="0" data-note="${note.id}"><svg class="ic"><use href="#i-link"/></svg>${PAGE_REF}</button><span>added from the reader</span></p><p class="th"></p>`;
      block.lastChild.textContent = note.text;
      block.lastChild.hidden = !note.text;
      return block;
    }));
  });
}

function initCell() {
  const token = $("#qmdScale");
  const run = $("#qmdRun");
  const stale = $("#qmdStale");
  const time = $("#qmdTime");
  const out = stale.closest(".qout");
  const line = $("#scaleLine");
  const dots = $$("#scaleDots circle");
  let coded = true;
  let shown = true;
  let running = false;
  // 0 draws the scaled series, 1 the unscaled one.
  let position = 0;
  let frame;

  function draw() {
    const ys = UNSCALED_YS.map((y) => SCALED_Y + (y - SCALED_Y) * position);
    line.setAttribute("points", XS.map((x, i) => `${x},${ys[i].toFixed(1)}`).join(" "));
    dots.forEach((dot, i) => dot.setAttribute("cy", ys[i].toFixed(1)));
  }

  function moveTo(target) {
    cancelAnimationFrame(frame);
    const from = position;
    const start = performance.now();
    const step = (now) => {
      const progress = reducedMotion ? 1 : Math.min(1, (now - start) / RERUN_MS);
      position = from + (target - from) * (1 - (1 - progress) ** 3);
      draw();
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    step(start);
  }

  function showState() {
    const outdated = coded !== shown;
    stale.hidden = !outdated;
    out.classList.toggle("stale", outdated);
    run.classList.toggle("due", outdated);
    if (outdated) setGuide(1, "Out of date: <b>Run</b> the cell.");
  }

  token.addEventListener("click", () => {
    coded = !coded;
    token.textContent = coded ? "True" : "False";
    token.classList.remove("hint");
    token.classList.add("new");
    requestAnimationFrame(() => requestAnimationFrame(() => token.classList.remove("new")));
    showState();
  });

  function rerun() {
    if (running) return;
    running = true;
    time.textContent = "Running 1 of 1";
    setTimeout(() => {
      story.scaled = shown = coded;
      $("#scaleOut").textContent = shown ? "1.0" : "1024";
      moveTo(shown ? 0 : 1);
      time.textContent = "0.4 s";
      running = false;
      showState();
      setGuide(1, shown ? "The variance stays at 1." : "The variance grows with <i>d</i><sub><i>k</i></sub>.", NEXT);
    }, reducedMotion ? 0 : RERUN_MS);
  }
  run.addEventListener("click", rerun);
  $("#qmdRunAll").addEventListener("click", rerun);
}

export function initExplore() {
  initQuotes();
  initCell();
}
