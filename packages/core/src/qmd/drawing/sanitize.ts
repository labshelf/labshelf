// Allowlist sanitizer for the labshelf-svg fence (decision D5): viewing a drawing never runs the editor, so the stored SVG is
// checked here before it reaches the DOM. Anything outside the allowlist rejects the whole markup (null), never a cleaned copy.

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const TAGS: ReadonlySet<string> = new Set(["svg", "g", "defs", "path", "line", "circle", "rect", "polygon", "polyline", "use", "title"]);

/** Geometry and presentation attributes; no `style`, no `on*`, no reference attributes other than a local `href`. */
const ATTRIBUTES: ReadonlySet<string> = new Set([
  "id", "class", "role", "focusable", "transform", "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "viewBox", "preserveAspectRatio", "color", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity",
  "vector-effect",
]);

const NAMESPACE_DECLARATIONS: Readonly<Record<string, string>> = { xmlns: SVG_NS, "xmlns:xlink": XLINK_NS };

/** A paint or length value may only reference a local fragment, and never carry a script scheme. */
function safeValue(value: string): boolean {
  if (/javascript:|data:|expression\s*\(/i.test(value)) { return false; }
  const urls = value.match(/url\s*\(\s*[^)]*\)/gi) ?? [];
  return urls.every((u) => /^url\(\s*["']?#[^"')\s]*["']?\s*\)$/i.test(u));
}

function allowedAttribute(el: Element, attr: Attr): boolean {
  const name = attr.name;
  if (name === "href" || name === "xlink:href") {
    return el.localName === "use" && /^#\S*$/.test(attr.value);
  }
  if (Object.hasOwn(NAMESPACE_DECLARATIONS, name)) { return attr.value === NAMESPACE_DECLARATIONS[name]; }
  const allowed = ATTRIBUTES.has(name) || /^data-[\w.-]+$/.test(name) || /^aria-[\w-]+$/.test(name);
  return allowed && safeValue(attr.value);
}

function allowedElement(el: Element): boolean {
  if (!TAGS.has(el.localName)) { return false; }
  // Markup stored without an xmlns is HTML-embedded SVG: no namespace is fine, a foreign one is not.
  if (el.namespaceURI !== null && el.namespaceURI !== SVG_NS) { return false; }
  return Array.from(el.attributes).every((a) => allowedAttribute(el, a));
}

function allowedTree(el: Element): boolean {
  if (!allowedElement(el)) { return false; }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      if (!allowedTree(child as Element)) { return false; }
    } else if (child.nodeType === 3) {
      // Text only as whitespace between elements, or as the content of a title.
      if (el.localName !== "title" && (child.nodeValue ?? "").trim() !== "") { return false; }
    } else {
      return false;
    }
  }
  return true;
}

/** The markup of an SVG that uses only the D5 allowlist, or null when anything else is present or the markup is malformed. */
export function sanitizeDrawingSvg(markup: string): string | null {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") { return null; }
  if (markup.trim() === "") { return null; }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  } catch {
    return null;
  }
  const root = doc.documentElement as Element | null;
  if (!root || root.localName !== "svg" || doc.doctype !== null) { return null; }
  if (root.getElementsByTagName("parsererror").length > 0) { return null; }
  if (!allowedTree(root)) { return null; }
  return new XMLSerializer().serializeToString(root);
}
