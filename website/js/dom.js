// Finds page elements, escapes text for HTML and reads the reduced-motion preference.

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
