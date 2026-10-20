// Builds the markup pieces every view shares: core icons, status marks, member initials and escaped text. Mockup only.
// Maps the mockup's names to glyphs that exist in the core icon set.
const GLYPHS = { space: "layers", share: "link", deadline: "target", goal: "target", item: "check", eye: "search", bell: "info",
  version: "git-compare", ban: "warning", compass: "search", run: "arrow-right", sun: "sun", moon: "moon" };
const icon = (name) => CoreUI.icon(GLYPHS[name] ?? name);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const statusMark = (status) => `<span class="mk-status" title="${STATUS_LABEL[status]}">${CoreUI.statusMark(status)}</span>`;
const arc = (done, total) => `<span class="mk-status">${CoreUI.arcMark(done >= total ? "ok" : "accent", done === 0 ? "none" : done >= total ? "full" : "half")}</span>`;
const avatar = (who) => `<span class="mk-avatar" title="${PEOPLE[who].name}" aria-label="${PEOPLE[who].name}">${PEOPLE[who].initials}</span>`;
const formatTag = (format) => `<span class="mk-ft ${format === "latex" ? "tex" : "typ"}">${format === "latex" ? "TEX" : "TYP"}</span>`;
const emptyState = (text, hint = "") => `<div class="mk-empty"><span>${text}</span>${hint ? `<span class="mk-empty-hint">${hint}</span>` : ""}</div>`;
