// The Outline tab: nested entries built from the headings, twisties to collapse a section, and the entry in view marked active.

import { byId, h, pageNumber } from "../dom.js";
import { icon } from "../icons.js";
import { jumpTo, onPageChange, currentSection } from "./navigation.js";
import { setSidebarOpen } from "../chrome/sidebar.js";

function entry(heading, depth, twisty) {
  const page = pageNumber(heading);
  const item = h("a", { class: "rd-outline-item", href: `#${heading.id}`, "data-depth": depth, "data-target": heading.id },
    twisty,
    h("span", { class: "rd-outline-title" }, heading.dataset.outline),
    h("span", { class: "rd-outline-page" }, String(page)),
  );
  item.addEventListener("click", (e) => {
    if (e.target.closest(".rd-twisty")) return;
    e.preventDefault();
    jumpTo(heading);
    if (window.innerWidth < 760) setSidebarOpen(false);
  });
  return item;
}

function leaf() {
  return h("span", { class: "rd-twisty rd-twisty-leaf", html: icon("twisty-right") });
}

function build(nav) {
  const headings = [...document.querySelectorAll("#viewer [data-outline]")];
  let group = null;
  for (const heading of headings) {
    const depth = heading.tagName === "H3" ? 1 : 0;
    if (depth === 0) {
      const children = h("div", { class: "rd-outline-children" });
      group = h("div", { class: "rd-outline-group", "data-collapsed": "false" });
      const twisty = h("button", { class: "rd-twisty rd-twisty-leaf", type: "button", "aria-label": "Collapse", html: icon("twisty-down") });
      twisty.addEventListener("click", (e) => {
        e.preventDefault();
        const collapsed = group.dataset.collapsed !== "true";
        group.dataset.collapsed = String(collapsed);
        twisty.innerHTML = icon(collapsed ? "twisty-right" : "twisty-down");
        twisty.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
      });
      group.append(entry(heading, 0, twisty), children);
      nav.append(group);
    } else if (group) {
      group.querySelector(".rd-outline-children").append(entry(heading, 1, leaf()));
      group.querySelector(".rd-twisty").classList.remove("rd-twisty-leaf");
    }
  }
}

function markActive() {
  const section = currentSection();
  for (const item of document.querySelectorAll(".rd-outline-item")) {
    item.classList.toggle("rd-active", Boolean(section) && item.dataset.target === section.id);
  }
}

export function initOutline() {
  build(byId("outline"));
  onPageChange(markActive);
  byId("viewerContainer").addEventListener("scroll", markActive, { passive: true });
  markActive();
}
