// Moves the real mouse and a drawn cursor together, because the screencast leaves out the system cursor.
const ARROW = "M3 2v16l4.2-4 2.9 6.4 2.6-1.2-2.9-6.2H16L3 2z";

/** Draws the cursor in the workbench, above the webviews, and returns the pointer that drives it. */
export async function installPointer(page, start = { x: 720, y: 450 }) {
  await page.evaluate(({ arrow, x, y }) => {
    document.getElementById("rec-pointer")?.remove();
    const cursor = document.createElement("div");
    cursor.id = "rec-pointer";
    // PLATFORM: the workbench enforces Trusted Types, so the arrow is built node by node instead of from markup.
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const path = document.createElementNS(ns, "path");
    for (const [name, value] of [["width", "22"], ["height", "22"], ["viewBox", "0 0 22 22"]]) svg.setAttribute(name, value);
    for (const [name, value] of [["d", arrow], ["fill", "#fff"], ["stroke", "#111"], ["stroke-width", "1.3"], ["stroke-linejoin", "round"]]) path.setAttribute(name, value);
    svg.append(path);
    cursor.append(svg);
    cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform-origin:3px 2px;transition:scale 90ms;";
    cursor.style.translate = `${x - 3}px ${y - 2}px`;
    document.body.append(cursor);
  }, { arrow: ARROW, ...start });
  let at = { ...start };
  await page.mouse.move(at.x, at.y);

  const draw = (x, y, scale = 1) => page.evaluate(({ x, y, scale }) => {
    const cursor = document.getElementById("rec-pointer");
    cursor.style.translate = `${x - 3}px ${y - 2}px`;
    cursor.style.scale = String(scale);
  }, { x, y, scale });

  const moveTo = async (x, y, ms = 550) => {
    const steps = Math.max(2, Math.round(ms / 22));
    const from = at;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const px = from.x + (x - from.x) * ease;
      const py = from.y + (y - from.y) * ease;
      await Promise.all([page.mouse.move(px, py), draw(px, py)]);
    }
    at = { x, y };
  };

  // `fromLeft` aims that many pixels into the element instead of its centre, e.g. at a row's title, not its tags.
  const center = async (locator, fromLeft) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`pointer: ${locator} has no box`);
    return { x: fromLeft === undefined ? box.x + box.width / 2 : box.x + fromLeft, y: box.y + box.height / 2 };
  };

  return {
    moveTo,
    async click(x, y, ms) {
      await moveTo(x, y, ms);
      await draw(x, y, 0.82);
      await page.mouse.down();
      await page.mouse.up();
      await draw(x, y, 1);
    },
    async drag(from, to, ms = 900) {
      await moveTo(from.x, from.y);
      await page.mouse.down();
      await moveTo(to.x, to.y, ms);
      await page.mouse.up();
    },
    async hover(locator, ms) {
      const point = await center(locator);
      await moveTo(point.x, point.y, ms);
    },
    async clickOn(locator, ms, fromLeft) {
      const point = await center(locator, fromLeft);
      await this.click(point.x, point.y, ms);
    },
    /** Parks the cursor on a spot with no content, so hover effects end. */
    park: (ms) => moveTo(700, 830, ms),
    remove: () => page.evaluate(() => document.getElementById("rec-pointer")?.remove()),
  };
}
