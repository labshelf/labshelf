// Tabbed figures: one frame that switches between the apps' screenshots, with the caption following the tab.

function select(figure, index, focus = false) {
  const tabs = [...figure.querySelectorAll('[role="tab"]')];
  const shots = [...figure.querySelector(".shots").children];
  const i = (index + tabs.length) % tabs.length;
  tabs.forEach((tab, n) => {
    tab.setAttribute("aria-selected", String(n === i));
    tab.tabIndex = n === i ? 0 : -1;
  });
  shots.forEach((shot, n) => { shot.hidden = n !== i; });
  figure.querySelector(".shot-caption").textContent = shots[i].dataset.caption;
  if (focus) tabs[i].focus();
}

export function initFigureTabs() {
  for (const figure of document.querySelectorAll("#viewer figure.tabbed")) {
    const tabs = [...figure.querySelectorAll('[role="tab"]')];
    select(figure, 0);
    tabs.forEach((tab, n) => tab.addEventListener("click", () => select(figure, n)));
    figure.querySelector('[role="tablist"]').addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      e.stopPropagation();
      const current = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
      select(figure, current + (e.key === "ArrowRight" ? 1 : -1), true);
    });
  }
}
