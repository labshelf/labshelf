// Moves focus between the tabs of a tablist on Left, Right, Home and End, wrapping at the ends.
/** Returns true when the key was a focus move (and prevents its default). */
export function moveTabFocus(list: HTMLElement, current: HTMLElement, e: KeyboardEvent): boolean {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return false;
  e.preventDefault();
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.indexOf(current);
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  return true;
}
