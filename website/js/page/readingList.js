// The cover's contents as a reading list: each section shows the status its page has for this visitor, unread, reading or done, as papers do in the library.

import { load, save } from "../dom.js";
import { currentPage, onPageChange } from "../document/navigation.js";

const KEY = "labshelf.site.read";
const visited = new Set(load(KEY, []));

function render(current) {
  for (const link of document.querySelectorAll(".reading-list a[data-page]")) {
    const page = Number(link.dataset.page);
    const status = page === current ? "reading" : visited.has(page) ? "done" : "unread";
    const dot = link.querySelector(".dot");
    dot.dataset.status = status;
    dot.setAttribute("aria-label", status);
  }
}

export function initReadingList() {
  let last = currentPage();
  render(last);
  onPageChange((page) => {
    if (page !== last) {
      visited.add(last);
      save(KEY, [...visited]);
      last = page;
    }
    render(page);
  });
}
