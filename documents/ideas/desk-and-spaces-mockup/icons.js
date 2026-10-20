// Adapts the core icon set to the mockup markup.
const GLYPHS = { compass: "search", "book-a": "book", "square-plus": "plus", enter: "arrow-right",
  share: "external", users: "message", calendar: "history", inbox: "library", clock: "history",
  bell: "info", play: "arrow-right", eye: "search", ban: "warning", "git-branch": "git-compare", flag: "tag" };
const icon = (name) => CoreUI.icon(GLYPHS[name] ?? name);
const arc = (progress) => `<span class="arc">${CoreUI.arcMark("accent", progress)}</span>`;
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-i]:not([data-done])").forEach((el) => {
    el.innerHTML = icon(el.dataset.i);
    el.dataset.done = "1";
  });
}
