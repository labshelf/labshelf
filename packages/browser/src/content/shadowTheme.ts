// Injects the design kit (tokens.css + base.css) into a shadow root, with `:root` rewritten to `:host`.
// The theme follows the host page, not the OS, so a button never looks dark on a white page.
import tokensCss from "@labshelf/core/styles/tokens.css";
import baseCss from "@labshelf/core/styles/base.css";

// base.css styles <body>; in a shadow root the root's children play that part
// (the host itself is reset inline, which outranks any :host rule).
const KIT_CSS = `${tokensCss
  .replace(/:root\[data-theme="light"\]/g, ':host([data-theme="light"])')
  .replace(/:root/g, ":host")}\n${baseCss}
:host > * { font-family: var(--ls-font); font-size: var(--ls-font-size); line-height: 1.4; color: var(--ls-fg); -webkit-font-smoothing: antialiased; }`;

/**
 * Attaches a shadow root to `host` carrying the kit plus `extraCss`. The
 * host's own box (`hostStyle`) is set inline: page selectors such as
 * ".gs_ggsd div { margin }" reach the host element, and inline styles beat them.
 */
export function kitShadow(host: HTMLElement, extraCss: string, hostStyle: string): ShadowRoot {
  host.style.cssText = `all: initial; ${hostStyle}`;
  host.dataset["theme"] = pageTheme();
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${KIT_CSS}\n${extraCss}`;
  root.append(style);
  return root;
}

// Light unless the page paints a dark background.
function pageTheme(): "light" | "dark" {
  for (const el of [document.body, document.documentElement]) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
    if (!m || m[4] === "0") continue;
    const luminance = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    return luminance < 0.4 ? "dark" : "light";
  }
  return "light";
}
