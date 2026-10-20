// Previews character choices on the mockup's members without saving profile data.
const IDENTITY = { who: "you", variant: "beam", options: [] };
const generateCharacters = () => { IDENTITY.options = Array.from({ length: 8 }, () => createCharacter(IDENTITY.variant)); };
generateCharacters();

function renderIdentityPicker() {
  const who = IDENTITY.who;
  return `<section class="identity" aria-labelledby="identity-heading">
    <header class="identity-heading"><div><h2 id="identity-heading">A little more you</h2>
      <p>Boring Avatars. Three styles, a shared palette, your own combination.</p></div>
      <label class="identity-person">Preview for <select id="identity-person" aria-label="Preview character for">${Object.entries(PEOPLE).map(([id, p]) =>
        `<option value="${id}" ${id === who ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></header>
    <div class="identity-workbench"><div class="identity-current"><span class="identity-portrait" role="img" aria-label="Current character for ${esc(PEOPLE[who].name)}">${characterSvg(CHARACTERS[who])}</span>
      <span>${esc(PEOPLE[who].name)}</span><span class="muted">Current character</span></div>
      <div class="identity-choices"><div class="identity-options" role="group" aria-label="Character options">${IDENTITY.options.map((seed, i) =>
        `<button id="character-option-${i}" class="identity-option" data-act="character-select" data-index="${i}" aria-label="Use character ${i + 1}" aria-pressed="${seed === CHARACTERS[who]}" title="Use character ${i + 1}">${characterSvg(seed)}</button>`).join("")}</div>
        <div class="identity-controls"><label class="identity-person">Style <select id="identity-style" aria-label="Avatar style">${CHARACTER_STYLES.map((style) => `<option value="${style}" ${style === IDENTITY.variant ? "selected" : ""}>${style[0].toUpperCase() + style.slice(1)}</option>`).join("")}</select></label><button id="character-generate" class="ls-btn ls-btn-ghost" data-act="character-generate">${icon("refresh")}Generate options</button>
          <span class="muted">Choose one to see it across your Spaces.</span></div></div></div>
    <div class="identity-scale"><span>In your Space</span><div>${Object.keys(PEOPLE).map(avatar).join("")}</div>
      <span class="muted">Changes last until you reload this mockup.</span></div>
    <span class="identity-announcement" role="status" id="identity-status"></span></section>`;
}

ACTIONS["character-generate"] = () => {
  generateCharacters();
  render();
  document.getElementById("identity-status").textContent = "Eight character options generated.";
};
ACTIONS["character-select"] = (el) => {
  CHARACTERS[IDENTITY.who] = IDENTITY.options[Number(el.dataset.index)];
  render();
  document.getElementById("identity-status").textContent = `Character updated for ${PEOPLE[IDENTITY.who].name}.`;
};
document.addEventListener("change", (e) => {
  if (e.target.id === "identity-person") { IDENTITY.who = e.target.value; render(); }
  if (e.target.id === "identity-style" && CHARACTER_STYLES.includes(e.target.value)) {
    IDENTITY.variant = e.target.value;
    generateCharacters();
    render();
  }
});
