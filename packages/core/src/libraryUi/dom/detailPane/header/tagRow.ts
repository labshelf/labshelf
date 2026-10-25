/**
 * Renders the tag row: #tag chips that search their tag, an x that removes one, and an Add tag button that opens a
 * field (Enter or a comma adds, Backspace on an empty field takes back the last tag) with a menu of the library's
 * other tags.
 */
import { showMenu } from "../../../../ui/dom/index.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { countLibraryTags } from "../../../viewModel/index.js";
import { updateTags, splitTags } from "../../flows/index.js";
import type { UiContext } from "../../uiContext.js";

function chip(tag: string, readOnly: boolean): string {
  const hash = `<span class="tag-hash" aria-hidden="true">#</span>`;
  const name = `<button class="tag-name" type="button" data-action="searchTag" data-tag="${escapeHtml(tag)}" title="Show papers tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  const remove = `<button class="tag-x" type="button" data-action="removeTag" data-tag="${escapeHtml(tag)}" title="Remove tag" aria-label="Remove tag ${escapeHtml(tag)}">${renderIcon("x")}</button>`;
  return `<span class="tag-chip">${hash}${name}${readOnly ? "" : remove}</span>`;
}

/** The library's tags that not every selected paper carries yet, A to Z. */
function otherTags(ctx: UiContext): string[] {
  const { papers, selected } = ctx.store.get();
  const chosen = papers.filter((p) => selected.has(p.id));
  return countLibraryTags(papers).map(({ tag }) => tag)
    .filter((tag) => !chosen.every((p) => (p.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())));
}

function tagInput(ctx: UiContext): string {
  return `<span class="tag-field"><input class="tag-input" placeholder="tag" title="Type a tag and press Enter; commas add several" spellcheck="false" autocomplete="off" aria-label="Add tag"/>` +
    `<button class="ls-icon-btn tag-pick" type="button" tabindex="-1" data-action="pickTag" aria-haspopup="menu" aria-label="Choose an existing tag" title="Choose an existing tag"${otherTags(ctx).length ? "" : " disabled"}>${renderIcon("chevron-down")}</button></span>`;
}

// PLATFORM: the pane closes the field when focus leaves it, so the menu hands focus back on close.
/** Lists the library's other tags under `anchor`; picking one adds it to the selection and keeps the field open. */
export function openTagMenu(ctx: UiContext, anchor: HTMLElement): void {
  const ids = [...ctx.store.get().selected];
  const input = anchor.closest(".tag-field")?.querySelector<HTMLInputElement>(".tag-input");
  showMenu(anchor, otherTags(ctx).map((tag) => ({ label: `#${tag}`, onSelect: () => updateTags(ctx, ids, [tag], []) })), {
    onClose: () => { if (input?.isConnected) input.focus(); },
  });
}

/** The row of `tags`; `editing` shows the field in place of the Add tag button. */
export function renderTagRowHtml(ctx: UiContext, tags: readonly string[], editing: boolean): string {
  const add = ctx.readOnly ? "" : editing ? tagInput(ctx)
    : `<button class="ls-icon-btn tag-add" type="button" data-action="addTag" title="Add tag" aria-label="Add tag">${renderIcon("plus")}</button>`;
  return `<div class="tag-row">${tags.map((t) => chip(t, ctx.readOnly)).join("")}${add}</div>`;
}

/** Handles a key in the tag field; `ids` are the papers the row edits, `tags` the ones it shows. */
export function onTagKeydown(ctx: UiContext, e: KeyboardEvent, input: HTMLInputElement, ids: string[], tags: readonly string[]): void {
  if (e.key === "Enter") {
    const add = splitTags(input.value);
    input.value = "";
    updateTags(ctx, ids, add, []);
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    const pick = input.parentElement?.querySelector<HTMLButtonElement>(".tag-pick");
    if (pick && !pick.disabled) openTagMenu(ctx, pick);
    e.preventDefault();
  } else if (e.key === "Escape") {
    input.value = "";
    ctx.focusList();
    e.preventDefault();
  } else if (e.key === "Backspace" && !input.value && ids.length === 1 && tags.length) {
    updateTags(ctx, ids, [], [tags[tags.length - 1]!]);
    e.preventDefault();
  }
}

/** A comma typed into the field adds what came before it. */
export function onTagInput(ctx: UiContext, input: HTMLInputElement, ids: string[]): void {
  if (!input.value.includes(",")) return;
  const parts = input.value.split(",");
  input.value = parts.pop() ?? "";
  updateTags(ctx, ids, splitTags(parts.join(",")), []);
}
