// Opens the publish screen on the fake gallery transport and reads its controls for jsdom tests.
import type { HostToGallery } from "../../../src/templates/index";
import { mountGallery, type Gallery } from "./galleryHarness";

export const PROJECT = { id: "p1", title: "My Thesis", engineLabel: "pdfLaTeX" };
export const DRAFT = { name: "My Thesis", category: "thesis", license: "MIT", description: "A thesis template" };
export const CHECK_IDS = ["manifest", "license", "paths", "latexmkrc", "sizes", "build", "thumbnail"] as const;
export const LABELS: Record<(typeof CHECK_IDS)[number], string> = {
  manifest: "Name and description set", license: "License set", paths: "All files inside the project", latexmkrc: "No latexmkrc",
  sizes: "File sizes within limits", build: "Builds with pdfLaTeX", thumbnail: "Thumbnail compiled",
};

export function openPublish(): Gallery {
  const g = mountGallery();
  g.deliver({ type: "publish.open", project: PROJECT, draft: DRAFT });
  return g;
}

export const screen = (g: Gallery) => g.root.querySelector<HTMLElement>(".ls-tpl-publish");
const visible = (e: Element) => !e.closest("[hidden]");

/** A button inside the publish screen, found by its text; ignores buttons inside hidden ancestors. */
export const button = (g: Gallery, text: string) =>
  [...(screen(g)?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.includes(text) && visible(b)) ?? null;

export function field(g: Gallery, label: string): HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement {
  const l = [...screen(g)!.querySelectorAll("label")].find((x) => x.textContent?.trim().startsWith(label))!;
  return (l as HTMLLabelElement).control as never;
}

export function edit(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

export const row = (g: Gallery, label: string) =>
  [...screen(g)!.querySelectorAll<HTMLElement>('[role="list"] > li')].find((li) => li.textContent?.includes(label))!;

export const checks = (results: Array<{ id: string; ok?: boolean; message?: string }>, extra: Partial<Extract<HostToGallery, { type: "publish.checks" }>> = {}): HostToGallery =>
  ({ type: "publish.checks", checks: results, running: false, ...extra }) as HostToGallery;

export const allPassed = (extra = {}): HostToGallery => checks(CHECK_IDS.map((id) => ({ id, ok: true })), extra);

export const alert = (g: Gallery) => screen(g)!.querySelector<HTMLElement>('[role="alert"]');
