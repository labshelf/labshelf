// Routes clicks on data-act elements to the handlers each view registers, and lets Enter and Space activate focusable rows. Mockup only.
const ACTIONS = {
  toast: (el) => CoreUI.toast(el.dataset.msg),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.act]?.(el, e);
});

// Tree rows and cards are divs with role and tabindex; buttons get Enter and Space from the browser.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.tagName === "BUTTON" || el.tagName === "INPUT" || !el.matches("[data-act][tabindex]")) return;
  e.preventDefault();
  el.click();
});
