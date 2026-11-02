/** Shared by the 7.1 presenter and 7.2 poster preview tests: the no-style= check, made on what the code writes rather than on the live DOM. */
/**
 * Records every write of style markup into the host document: a style attribute set through setAttribute or setAttributeNS, or an
 * HTML string carrying a style= attribute set through innerHTML, outerHTML or insertAdjacentHTML. Writes through CSSOM (el.style.x,
 * style.setProperty, cssText, stylesheet rules) do not count, and neither do iframe srcdoc values, whose deck blocks carry style=.
 * Install it before opening the view and call restore() in a finally block.
 */
export function watchStyleMarkup(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const restores: (() => void)[] = [];
  const STYLE_MARKUP = /<[^>]*\sstyle\s*=/i;
  const SRCDOC = /\ssrcdoc\s*=\s*("[^"]*"|'[^']*')/gi;
  const inHost = (node: Node) => node.ownerDocument === document;
  const checkHtml = (node: Node, how: string, html: unknown) => {
    const text = String(html);
    if (inHost(node) && STYLE_MARKUP.test(text.replace(SRCDOC, ""))) writes.push(`${how}: ${text.slice(0, 160)}`);
  };
  const patchMethod = (proto: object, name: string, make: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown) => {
    const target = proto as Record<string, (...args: unknown[]) => unknown>;
    const original = target[name] as (...args: unknown[]) => unknown;
    target[name] = make(original);
    restores.push(() => void (target[name] = original));
  };
  const patchSetter = (proto: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor?.set) return;
    const set = descriptor.set;
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(this: Node, value: unknown) {
        checkHtml(this, name, value);
        set.call(this, value);
      },
    });
    restores.push(() => Object.defineProperty(proto, name, descriptor));
  };
  patchMethod(Element.prototype, "setAttribute", (original) =>
    function (this: Element, ...args: unknown[]) {
      if (inHost(this) && String(args[0]).toLowerCase() === "style") writes.push(`setAttribute: ${String(args[1])}`);
      return original.apply(this, args);
    },
  );
  patchMethod(Element.prototype, "setAttributeNS", (original) =>
    function (this: Element, ...args: unknown[]) {
      const local = String(args[1]).split(":").pop() ?? "";
      if (inHost(this) && local.toLowerCase() === "style") writes.push(`setAttributeNS: ${String(args[2])}`);
      return original.apply(this, args);
    },
  );
  patchMethod(Element.prototype, "insertAdjacentHTML", (original) =>
    function (this: Element, ...args: unknown[]) {
      checkHtml(this, "insertAdjacentHTML", args[1]);
      return original.apply(this, args);
    },
  );
  patchSetter(Element.prototype, "innerHTML");
  patchSetter(Element.prototype, "outerHTML");
  if (typeof ShadowRoot !== "undefined") patchSetter(ShadowRoot.prototype, "innerHTML");
  return { writes, restore: () => restores.reverse().forEach((undo) => undo()) };
}
