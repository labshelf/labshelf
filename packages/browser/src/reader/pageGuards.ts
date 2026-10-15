// Blocks browser chords and drops that would pull the reader tab away from its paper.
export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

/** Chords VS Code's webview frame swallows (print, save) and drops that would navigate the tab away from the paper. */
export function installPageGuards(): void {
  const mac = isMacPlatform();
  document.addEventListener("keydown", (e) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === "p" || key === "s")) { e.preventDefault(); return; }
    // Firefox opens Quick Find on these when nothing handles them; the reader has its own find bar.
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (!typing && !mod && !e.altKey && (e.key === "/" || e.key === "'") && !e.defaultPrevented) e.preventDefault();
  });
  for (const type of ["dragover", "drop"] as const) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
}

