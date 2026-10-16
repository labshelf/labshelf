// Renders the Publish screen's result: the submitted heading, the pull request link and the way back to the form.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";

export interface PublishDone {
  element: HTMLElement;
  /** Sets the pull request link; anything but an https URL leaves the link out. */
  setUrl(url: string): void;
  /** Moves focus to the heading so a screen reader announces the result. */
  focus(): void;
}

export function createPublishDone(onStartOver: () => void): PublishDone {
  const heading = el("h2", { class: "ls-tpl-detail-title", tabindex: -1, text: "Submitted for review" });
  const link = el("a", { class: "ls-btn ls-btn-primary", html: icon("external") }, el("span", { text: "View pull request" }));
  const startOver = el("button", { class: "ls-btn", type: "button", text: "Start over" });
  startOver.addEventListener("click", onStartOver);
  const element = el("div", { class: "ls-tpl-publish-done" },
    heading,
    el("p", { text: "A reviewer checks it on GitHub. It shows up in everyone’s gallery once merged; until then it is in My templates." }),
    el("div", { class: "ls-tpl-publish-actions" }, link, startOver));

  return {
    element,
    setUrl(url) {
      const valid = url.startsWith("https://");
      link.hidden = !valid;
      if (valid) link.setAttribute("href", url);
      else link.removeAttribute("href");
    },
    focus: () => heading.focus(),
  };
}
