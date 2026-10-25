// Measures the core row height token, in pixels, as the element's styles resolve it.

/**
 * With layout, a hidden probe styled `height: var(--ls-row-h)` gives the resolved height, because an unregistered custom
 * property computes to its token text (`calc(22px + 12px)`), not a length. Without layout (jsdom) the token must be a px value.
 */
export function readRowHeight(el: Element): number {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--ls-row-h)";
  el.append(probe);
  const measured = probe.offsetHeight;
  probe.remove();
  if (measured > 0) return measured;
  const raw = getComputedStyle(el).getPropertyValue("--ls-row-h").trim();
  const px = Number.parseFloat(raw);
  if (!raw.endsWith("px") || !(px > 0)) throw new Error(`--ls-row-h must resolve to a positive px length on ${el.tagName.toLowerCase()}.${el.className}, got "${raw}"`);
  return px;
}
