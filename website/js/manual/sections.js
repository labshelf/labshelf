// Lists the manual's numbered headings and summarises a section for previews and search.

import { $$ } from "../dom.js";

const SUMMARY_LENGTH = 220;

export const HEADINGS = $$(".mdoc h2, .mdoc h3")
  .filter((el) => el.querySelector(".n"))
  .map((el) => {
    const number = el.querySelector(".n").textContent;
    return {
      id: el.id || el.closest("section").id,
      number,
      title: el.textContent.replace(number, "").trim(),
      sub: el.tagName === "H3",
      el,
    };
  });

export function sectionSummary(id) {
  const target = document.getElementById(id);
  if (!target) return null;
  const heading = target.matches("section") ? target.querySelector("h2") : target;
  const number = heading.querySelector(".n")?.textContent ?? "";
  let paragraph = heading.nextElementSibling;
  while (paragraph && !/^(P|UL)$/.test(paragraph.tagName)) paragraph = paragraph.nextElementSibling;
  const text = paragraph?.textContent.trim() ?? "";
  return {
    number,
    title: heading.textContent.replace(number, "").trim(),
    text: text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH)}…` : text,
  };
}
