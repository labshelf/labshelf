// Marks a control as planned but not working: explained by its title, still focusable, inert on activation.
export function positioned(control: HTMLElement, reason: string): void {
  control.setAttribute("aria-disabled", "true");
  control.title = reason;
  control.classList.add("ls-positioned");
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  control.addEventListener("click", swallow, true);
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") swallow(e);
  }, true);
}
