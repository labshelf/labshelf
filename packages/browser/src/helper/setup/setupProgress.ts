// Builds the install progress bar: an accessible progressbar with the helper's message under it.
import { el } from "@labshelf/core/dom";
import type { HelperProgress } from "@labshelf/core/helper";

export interface SetupProgress {
  element: HTMLElement;
  update(progress: HelperProgress): void;
}

export function createSetupProgress(label: string): SetupProgress {
  const bar = el("div", { class: "helper-progress-bar indeterminate" });
  const track = el("div", { class: "helper-progress-track", role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100 }, bar);
  const message = el("div", { class: "helper-progress-message" });
  return {
    element: el("div", { class: "helper-progress" }, track, message),
    update({ fraction, message: text }) {
      message.textContent = text;
      // An absent fraction is an indeterminate wait, so the bar carries no aria-valuenow.
      const percent = fraction === undefined ? undefined : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      bar.classList.toggle("indeterminate", percent === undefined);
      bar.style.width = percent === undefined ? "" : `${percent}%`;
      if (percent === undefined) { track.removeAttribute("aria-valuenow"); } else { track.setAttribute("aria-valuenow", String(percent)); }
    },
  };
}
