// Generates member avatars with the Boring Avatars library and core palette.
const CHARACTER_STYLES = ["beam", "pixel", "bauhaus"];
const characterSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const createCharacter = (variant = "beam") => ({ seed: characterSeed(), variant });
const CHARACTERS = Object.fromEntries(Object.keys(PEOPLE).map((who) => [who, createCharacter()]));

function characterSvg({ seed, variant }) {
  const colors = Object.values(CoreUI.MARK_TOKENS).map(({ value }) => {
    const channels = [1, 3, 5].map((start) => {
      const pigment = parseInt(value.slice(start, start + 2), 16);
      const paper = parseInt(CoreUI.COLOR_TOKENS.bg.light.slice(start, start + 2), 16);
      return Math.round(pigment * 0.8 + paper * 0.2).toString(16).padStart(2, "0");
    });
    return `#${channels.join("")}`;
  });
  return CoreUI.boring({ name: String(seed), variant, colors, square: false, size: "100%", title: false })
    .replace('role="img"', 'aria-hidden="true" focusable="false"');
}
