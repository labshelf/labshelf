/** Fixtures and DOM helpers of the Poster Settings tests in the HTML deck shell. */
import { deckCanvasPx, listDeckSizePresets } from "../../../../../src/decks/deckSizes";
import { readPosterLayout, readPosterSettings, type PosterLayout } from "../../../../../src/decks/posterSections";
import { reflowPoster } from "../../../../../src/decks/posterSectionEdits";
import { THEME, buttonIn, host, openWs, toolbarOf } from "./shellHarness";

// --- fixtures ----------------------------------------------------------------------------------------------------------------------

const PLACE = "left: 0px; top: 0px; width: 100px; height: 100px;";
const section = (id: string, column: number, title: string, body: string): string =>
  `<div data-block="${id}" data-poster="section" data-column="${column}" style="${PLACE}"><h2>${title}</h2><p>${body}</p></div>`;
export const sectionedHtml = (size = "841x1189mm", logoId = "logo"): string => [
  "<!doctype html>",
  `<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="${size}">`,
  '<head>\n<meta charset="utf-8">\n<title>Poster</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  "<section data-slide>",
  `<div data-block="head" data-poster="header" style="${PLACE}"><h1>Poster</h1><p>Authors</p></div>`,
  section("s1", 0, "Introduction", "One"),
  section("s2", 1, "Methods", "Two"),
  section("s3", 2, "Results", "Three"),
  section("s4", 0, "Discussion", "Four"),
  `<div data-block="${logoId}" style="left: 50px; top: 50px; width: 100px; height: 100px;"><p>Logo</p></div>`,
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

export function reflowed(html: string, theme: string): { html: string; theme: string } {
  const result = reflowPoster(html, theme);
  if (!result.ok) throw new Error(result.error);
  return { html: result.html, theme: result.theme };
}

export const SECTIONED = reflowed(sectionedHtml(), THEME);
export const sizeOf = (html: string) => /data-deck-size="([^"]+)"/.exec(html)![1]!;
const canvasOf = (html: string) => {
  const [w, h, unit] = /^([\d.]+)x([\d.]+)(mm|in)$/.exec(sizeOf(html))!.slice(1);
  return deckCanvasPx({ w: Number(w), h: Number(h), unit: unit as "mm" | "in" });
};
export const layoutOf = (change: { html: string; theme: string }): PosterLayout => {
  const layout = readPosterLayout(change.html, change.theme);
  if (!layout) throw new Error("not a sectioned poster");
  return layout;
};
export const boxesOf = (layout: PosterLayout) => [...(layout.header ? [layout.header] : []), ...layout.columns.flat()];
export const settingsOf = (change: { html: string; theme: string }) => {
  const { width, height } = canvasOf(change.html);
  return readPosterSettings(change.theme, width, height);
};
export const sectionIds = (html: string): string[] =>
  Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-poster='section']")).map((el) => el.getAttribute("data-block")!);
export const sectionEl = (html: string, id: string): Element =>
  new DOMParser().parseFromString(html, "text/html").querySelector(`[data-block='${id}']`)!;

// --- DOM helpers -------------------------------------------------------------------------------------------------------------------

export const props = (): HTMLElement => host.querySelector<HTMLElement>("aside[aria-label='Properties']")!;
export const stylePanel = (): HTMLElement | null => host.querySelector<HTMLElement>(".dsh-style");
export const insertButton = (label: string): HTMLButtonElement | null => buttonIn(toolbarOf("Insert"), label);
/** The Poster Settings panel: the sibling of the properties column (not the Style panel) that holds the Orientation field. */
export const panel = (): HTMLElement | null =>
  (Array.from(props().parentElement!.children).find((c) => c !== props() && !c.classList.contains("dsh-style") && /Orientation/.test(c.textContent ?? "")) as HTMLElement | undefined) ?? null;
export const openPanel = (): HTMLElement => {
  insertButton("Poster")!.click();
  return panel()!;
};
const byName = (el: Element, name: string): boolean =>
  (el.getAttribute("aria-label") ?? "").trim().toLowerCase() === name.toLowerCase() || (el.textContent ?? "").trim().toLowerCase() === name.toLowerCase();
export const panelButton = (name: string): HTMLButtonElement | null =>
  Array.from(panel()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => byName(b, name)) ?? null;
export const anyButton = (name: string): HTMLButtonElement | null =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => byName(b, name)) ?? null;

type Control = HTMLInputElement | HTMLSelectElement;
/** The input or select of a field, found by its aria-label, its field label or its section title. */
export function control(name: string): Control | null {
  const p = panel();
  if (!p) return null;
  const lower = name.toLowerCase();
  const inner = (el: Element | null | undefined): Control | null => (!el ? null : el.matches("input, select") ? (el as Control) : el.querySelector<Control>("input, select"));
  const labelled = Array.from(p.querySelectorAll<HTMLElement>("[aria-label]")).filter((e) => e.getAttribute("aria-label")!.trim().toLowerCase() === lower && inner(e));
  if (labelled[0]) return inner(labelled[0]);
  const field = Array.from(p.querySelectorAll<HTMLElement>("label")).find((l) => (l.querySelector(".dw-field-label")?.textContent ?? l.firstElementChild?.textContent ?? "").trim().toLowerCase() === lower);
  if (field && inner(field)) return inner(field);
  const title = Array.from(p.querySelectorAll<HTMLElement>(".dsh-section-title")).find((t) => (t.textContent ?? "").trim().toLowerCase() === lower);
  return inner(title?.parentElement);
}
function fire(el: Control): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
export function setField(name: string, value: string): void {
  const el = control(name);
  if (!el) throw new Error(`no field ${name}`);
  el.value = value;
  fire(el);
}
/** Picks an option of a field, whether it is drawn as a select or as buttons. */
export function pick(name: string, option: string): void {
  const el = control(name);
  if (el instanceof HTMLSelectElement) {
    const found = Array.from(el.options).find((o) => o.text.trim() === option || o.value === option);
    if (!found) throw new Error(`no option ${option} in ${name}`);
    el.value = found.value;
    fire(el);
    return;
  }
  const button = panelButton(option);
  if (!button) throw new Error(`no option ${option} in ${name}`);
  button.click();
}
/** The select of size presets: the one with a Custom option. */
export function presetSelect(): HTMLSelectElement {
  const found = Array.from(panel()!.querySelectorAll<HTMLSelectElement>("select")).find((s) => Array.from(s.options).some((o) => /custom/i.test(o.text) || /custom/i.test(o.value)));
  if (!found) throw new Error("no preset select");
  return found;
}
export function choosePreset(id: string): void {
  const preset = listDeckSizePresets("poster").find((p) => p.id === id)!;
  const select = presetSelect();
  const option = Array.from(select.options).find((o) => o.value === id || o.text.trim() === preset.label);
  if (!option) throw new Error(`no preset ${id}`);
  select.value = option.value;
  fire(select);
}
export function chooseCustom(): void {
  const select = presetSelect();
  const option = Array.from(select.options).find((o) => /custom/i.test(o.text) || /custom/i.test(o.value))!;
  select.value = option.value;
  fire(select);
}
export function chooseOrientation(name: "Portrait" | "Landscape"): void {
  const direct = panelButton(name);
  if (direct) return direct.click();
  const select = Array.from(panel()!.querySelectorAll<HTMLSelectElement>("select")).find((s) => Array.from(s.options).some((o) => o.text.trim() === name));
  if (select) {
    select.value = Array.from(select.options).find((o) => o.text.trim() === name)!.value;
    return fire(select);
  }
  const toggle = Array.from(panel()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => /orientation/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
  if (!toggle) throw new Error("no orientation control");
  toggle.click();
}

export const openSectioned = async (extra: Parameters<typeof openWs>[1] = {}) => openWs(SECTIONED.html, { theme: SECTIONED.theme, ...extra });
export const callCount = (onChange: jest.Mock): number => onChange.mock.calls.length;
