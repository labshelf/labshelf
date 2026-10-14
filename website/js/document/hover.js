// Hover previews with the reader's timing: a citation shows its reference, a figure or section link shows a crop of its destination, each with Copy and Jump.

import { byId, h, viewer, toast, copyText, pageOf, pageNumber } from "../dom.js";
import { icon } from "../icons.js";
import { jumpTo } from "./navigation.js";

const OPEN_DELAY_MS = 250;
const CLOSE_GRACE_MS = 150;
const CROP_W = 540;
const popup = byId("hover-popup");
let openTimer = 0;
let closeTimer = 0;
let anchor = null;

function reference(n) {
  const entry = document.querySelector(`#ref-${n} span:last-child`);
  return {
    title: "Reference",
    target: byId(`ref-${n}`),
    copy: entry.textContent.trim(),
    body: h("div", { class: "rd-hover-text" }, h("p", { html: entry.innerHTML })),
  };
}

/** A scaled copy of `nodes` on a blank page, cropped to the popup. */
function crop(nodes) {
  const sheet = h("div", { class: "page" });
  for (const node of nodes) {
    const clone = node.cloneNode(true);
    clone.removeAttribute("id");
    for (const el of clone.querySelectorAll("[id]")) el.removeAttribute("id");
    for (const video of clone.querySelectorAll("video")) {
      video.replaceWith(h("img", { src: video.getAttribute("poster"), class: video.className, alt: "" }));
    }
    sheet.append(clone);
  }
  sheet.style.transform = `scale(${CROP_W / 816})`;
  return h("div", { class: "rd-hover-crop" }, sheet);
}

function figure(id) {
  const fig = byId(id);
  return { title: `${fig.dataset.caption} · Page ${pageNumber(fig)}`, target: fig, body: crop([fig]) };
}

function section(id) {
  const heading = byId(id);
  const nodes = [heading];
  let next = heading.nextElementSibling;
  while (next && nodes.length < 3 && !next.matches("h2, h3, figure, .folio")) {
    nodes.push(next);
    next = next.nextElementSibling;
  }
  return { title: `Section · Page ${pageNumber(heading)}`, target: heading, body: crop(nodes) };
}

function place(rect) {
  popup.hidden = false;
  const cropEl = popup.querySelector(".rd-hover-crop");
  if (cropEl) cropEl.style.height = `${Math.min(380, cropEl.firstElementChild.offsetHeight * CROP_W / 816)}px`;
  const w = popup.offsetWidth;
  const hgt = popup.offsetHeight;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = rect.bottom + 8;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, rect.top - hgt - 8);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function open(el) {
  const content = el.dataset.ref ? reference(el.dataset.ref) : el.dataset.fig ? figure(el.dataset.fig) : section(el.dataset.sec);
  const actions = h("span", { class: "rd-hover-actions" });
  if (content.copy) {
    actions.append(h("button", { class: "rd-btn rd-btn-sm", type: "button", title: "Copy reference", html: icon("copy"),
      onclick: async () => toast((await copyText(content.copy)) ? "Reference copied" : "Copy failed") }));
  }
  actions.append(h("button", { class: "rd-btn rd-btn-sm", type: "button", title: "Jump to destination", html: icon("arrow-right"),
    onclick: () => { close(); jumpTo(content.target, Boolean(content.copy)); } }));
  popup.replaceChildren(h("div", { class: "rd-hover-header" }, h("span", {}, content.title), actions), content.body);
  place(el.getBoundingClientRect());
}

export function closeHover() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  popup.hidden = true;
  anchor = null;
}

export function initHover() {
  if (window.matchMedia("(hover: none)").matches) return;
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("#viewer [data-ref], #viewer [data-fig], #viewer [data-sec]");
    if (!el) return;
    clearTimeout(closeTimer);
    if (el === anchor && !popup.hidden) return;
    clearTimeout(openTimer);
    anchor = el;
    openTimer = setTimeout(() => { if (anchor === el) open(el); }, OPEN_DELAY_MS);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest?.("#viewer [data-ref], #viewer [data-fig], #viewer [data-sec]");
    if (!el || el.contains(e.relatedTarget)) return;
    clearTimeout(openTimer);
    closeTimer = setTimeout(closeHover, CLOSE_GRACE_MS);
  });
  popup.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  popup.addEventListener("mouseleave", () => { closeTimer = setTimeout(closeHover, CLOSE_GRACE_MS); });
  viewer.addEventListener("scroll", closeHover, { passive: true });
  document.addEventListener("mousedown", (e) => { if (!popup.contains(e.target)) closeHover(); });
}
