// Sets <html data-theme> before first paint from a classic <script> in <head>; keep it dependency-free.
// PLATFORM: MV3 forbids inline scripts, hence a separate entry.
(() => {
  let pref: string | null = null;
  try { pref = localStorage.getItem("labshelf.theme"); } catch { /* ignore */ }
  const light = pref === "light" || (pref !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);
  const root = document.documentElement;
  root.dataset["theme"] = light ? "light" : "dark";
  // The reader page paints its chrome from data-pdf-theme; start it on the "auto" theme until the paper's own arrives.
  if (root.dataset["pdfTheme"] !== undefined) root.dataset["pdfTheme"] = light ? "light" : "dark";
})();
