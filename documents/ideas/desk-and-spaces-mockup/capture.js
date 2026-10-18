// Opens the global capture quick input (title bar button or Cmd/Ctrl+Shift+L), previews its commands and saves on Enter. Mockup only.
function openCapture() {
  const scrim = document.getElementById("scrim");
  scrim.className = "scrim cap-scrim";
  scrim.innerHTML = `<div class="ls-quick cap" role="dialog" aria-label="Capture">
    <div class="ls-quick-title">Capture · same commands as the Desk and the Notebook</div>
    <input class="ls-input cap-input" id="cap-input" spellcheck="false" placeholder="read @IQL by Fri · desk: … · todo thesis-ch3: … by 25 Oct · ? … @CQL">
    <div class="cap-preview" id="cap-preview">${capturePreview("")}</div>
    <div class="cap-foot"><span>${ONCE_HINT}</span><span class="sp"></span><kbd>Enter</kbd> save <kbd>Esc</kbd> close</div>
  </div>`;
  scrim.hidden = false;
  hydrateIcons(scrim);
  document.getElementById("cap-input").focus();
}

const capturePreview = (text) => renderPreview(parseCommands(asCommand(text)), "Plain text goes on your Desk today.");

function closeCapture() { const s = document.getElementById("scrim"); s.hidden = true; s.innerHTML = ""; }

function saveCapture() {
  const text = document.getElementById("cap-input").value.trim();
  if (!text) return closeCapture();
  const effects = parseCommands(asCommand(text));
  const warn = effects.find((e) => e.kind === "warn");
  if (warn) return toast(warn.label);
  const { summary } = applyEffects(effects);
  closeCapture();
  toast(summary);
  render();
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "cap-input") return;
  const box = document.getElementById("cap-preview");
  box.innerHTML = capturePreview(e.target.value); hydrateIcons(box);
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); return openCapture(); }
  if (e.target.id === "cap-input" && e.key === "Enter") return saveCapture();
  if (e.key === "Escape" && !document.getElementById("scrim").hidden) closeCapture();
});
document.addEventListener("mousedown", (e) => { if (e.target.id === "scrim") closeCapture(); });
