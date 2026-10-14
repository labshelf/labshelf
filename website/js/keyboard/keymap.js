// The reader's keyboard bindings as data: a conventional table that is always active and a vim layer, resolved per keydown and listed in the shortcuts sheet.

export const CHORD_TIMEOUT_MS = 800;

const CONVENTIONAL = [
  { key: "ArrowDown", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "ArrowUp", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "ArrowRight", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "ArrowLeft", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "PageDown", action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: " ", shift: false, action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: "PageUp", action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: " ", shift: true, action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: "Home", action: "firstPage", label: "First page", group: "Navigate" },
  { key: "End", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: "g", mod: true, alt: true, action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "ArrowLeft", alt: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "ArrowRight", alt: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "[", mod: true, macOnly: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "]", mod: true, macOnly: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "f", mod: true, action: "find", label: "Find in document", group: "Search" },
  { key: "g", mod: true, shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "g", mod: true, shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "F3", shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "F3", shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "=", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "+", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", mod: true, action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "0", mod: true, action: "zoomReset", label: "Reset zoom to default", group: "Zoom" },
  { key: "F4", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
  { key: "c", mod: true, shift: true, action: "copyWithCitation", label: "Copy selection with citation", group: "View" },
  { key: "?", action: "cheatsheet", label: "Keyboard shortcuts", group: "View" },
  { key: "Escape", action: "escape", label: "Close find / popups", group: "View" },
];

const VIM = [
  { key: "j", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "k", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "h", action: "scrollLeft", label: "Scroll left", group: "Navigate" },
  { key: "l", action: "scrollRight", label: "Scroll right", group: "Navigate" },
  { key: "d", action: "halfPageDown", label: "Half screen down", group: "Navigate" },
  { key: "u", action: "halfPageUp", label: "Half screen up", group: "Navigate" },
  { key: "J", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "K", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "G", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: ":", action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "H", action: "historyBack", label: "Back", group: "Navigate" },
  { key: "L", action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "/", action: "find", label: "Find in document", group: "Search" },
  { key: "n", action: "findNext", label: "Next match", group: "Search" },
  { key: "N", action: "findPrev", label: "Previous match", group: "Search" },
  { key: "+", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "=", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "w", action: "fitWidth", label: "Fit width", group: "Zoom" },
  { key: "e", action: "fitPage", label: "Fit page", group: "Zoom" },
  { key: "t", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
];

function primaryMod(input, isMac) {
  return isMac ? input.meta && !input.ctrl : input.ctrl && !input.meta;
}

function matches(b, input, isMac) {
  if (b.macOnly && !isMac) return false;
  const wantMod = b.mod === true;
  if (wantMod !== primaryMod(input, isMac)) return false;
  if (!wantMod && (input.ctrl || input.meta)) return false;
  if ((b.alt === true) !== input.alt) return false;
  if (b.shift !== undefined && b.shift !== input.shift) return false;
  // macOS rewrites `key` for Option+letter, so Alt letter chords match on the physical key.
  if (b.alt && b.key.length === 1 && input.code) return input.code === `Key${b.key.toUpperCase()}`;
  return wantMod ? b.key.toLowerCase() === input.key.toLowerCase() : b.key === input.key;
}

/** Resolve one keydown into `{ action, pendingPrefix }`; the prefix carries a half-typed `gg` into the next keydown. */
export function resolveKey(input, ctx) {
  const none = { action: null, pendingPrefix: null };
  const bare = !input.ctrl && !input.meta && !input.alt;
  if (ctx.inTextInput && bare && input.key !== "Escape" && !/^F\d{1,2}$/.test(input.key)) return none;
  if (ctx.vimKeys && !ctx.inTextInput && bare) {
    if (input.key === "g") {
      return ctx.pendingPrefix === "g" ? { action: "firstPage", pendingPrefix: null } : { action: null, pendingPrefix: "g" };
    }
    const vim = VIM.find((b) => matches(b, input, ctx.isMac));
    if (vim) return { action: vim.action, pendingPrefix: null };
  }
  const conv = CONVENTIONAL.find((b) => matches(b, input, ctx.isMac));
  if (!conv || (ctx.inTextInput && ["historyBack", "historyForward"].includes(conv.action))) return none;
  return { action: conv.action, pendingPrefix: null };
}

function displayKey(b, isMac) {
  const names = { " ": "Space", ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", PageDown: "PgDn", PageUp: "PgUp", Escape: "Esc" };
  const parts = [];
  if (b.mod) parts.push(isMac ? "Cmd" : "Ctrl");
  if (b.alt) parts.push(isMac ? "Option" : "Alt");
  if (b.shift) parts.push("Shift");
  const base = names[b.key] ?? b.key;
  parts.push(b.mod && base.length === 1 ? base.toUpperCase() : base);
  return parts.join("+");
}

/** Rows for the `?` sheet: one per action with every key that triggers it, vim keys only when the layer is on. */
export function cheatsheetRows(ctx) {
  const rows = new Map();
  const add = (b) => {
    if (b.macOnly && !ctx.isMac) return;
    const row = rows.get(b.action) ?? { group: b.group, label: b.label, keys: [] };
    const k = displayKey(b, ctx.isMac);
    if (!row.keys.includes(k)) row.keys.push(k);
    rows.set(b.action, row);
  };
  CONVENTIONAL.forEach(add);
  if (ctx.vimKeys) {
    VIM.forEach(add);
    rows.get("firstPage")?.keys.push("gg");
  }
  const order = ["Navigate", "Search", "Zoom", "View"];
  return [...rows.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}
