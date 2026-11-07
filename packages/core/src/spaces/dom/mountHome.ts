// Mounts the Home page over the Spaces transport: the personal desk on top, Needs you and Recent on the left, Up next with its calendar on the right.
import { renderElement, renderIcon, renderEmptyNotice, type IconName } from "../../ui/dom/index.js";
import type { SpacesTransport } from "../spacesProtocol.js";
import { isDeskFull, notYet, renderDeskStrip, showAddMenu, type HomeContext } from "./homeDesk.js";
import { renderNeedsYou, renderRecent, renderUpNext } from "./homeAgenda.js";

function headButton(label: string, onClick: (button: HTMLButtonElement) => void, glyph: IconName, disabled = false): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn hm-head-btn", text: label, disabled });
  button.prepend(renderElement("span", { "aria-hidden": "true", html: renderIcon(glyph) }));
  button.addEventListener("click", () => onClick(button));
  return button;
}

let nextId = 0;
interface SectionHead { readonly title: string; readonly tag?: string; readonly subtitle?: string; readonly actions?: HTMLElement[] }
function section(kind: string, head: SectionHead, body: HTMLElement): HTMLElement {
  const id = `hm-section-${kind}-${++nextId}`;
  return renderElement("section", { class: `hm-section hm-section-${kind}`, "aria-labelledby": id },
    renderElement("div", { class: "hm-section-head" },
      renderElement("div", { class: "hm-section-titles" },
        renderElement("div", { class: "hm-section-title" }, renderElement("h2", { id, text: head.title }), head.tag ? renderElement("span", { class: "hm-tag", text: head.tag }) : ""),
        head.subtitle ? renderElement("p", { class: "hm-section-sub", text: head.subtitle }) : ""),
      head.actions?.length ? renderElement("div", { class: "hm-section-actions" }, ...head.actions) : ""), body);
}

function render(ctx: HomeContext): HTMLElement {
  const view = ctx.view;
  const add = (anchor: HTMLElement): void => showAddMenu(ctx, anchor);
  const pin = headButton("Pin item", add, "plus", view.readOnlyReason !== undefined || isDeskFull(ctx));
  pin.title = isDeskFull(ctx) ? `The desk holds at most ${view.deskLimit} items. Unpin one to add another.` : `${view.desk.length} of ${view.deskLimit} items`;
  const desk = section("desk", { title: "On your desk", tag: "Your personal desk", subtitle: "What you want to keep at hand.", actions: [pin] }, renderDeskStrip(ctx, add));
  const needs = section("needs", { title: "Needs you" }, renderNeedsYou(ctx));
  const seeSpaces = renderElement("button", { type: "button", class: "hm-accent", text: "See Spaces ↗" });
  seeSpaces.addEventListener("click", () => ctx.end.post({ type: "openCatalog" }));
  const recent = section("recent", { title: "Recent in your Spaces", actions: [seeSpaces] }, renderRecent(ctx));
  const next = section("next", { title: "Up next", subtitle: "All of LabShelf", actions: [headButton("Connect calendar", notYet, "calendar")] }, renderUpNext(ctx));
  return renderElement("div", { class: "hm-body" },
    view.readOnlyReason ? renderElement("p", { class: "hm-notice", role: "status", text: `Home is read-only: ${view.readOnlyReason}` }) : "",
    desk, renderElement("div", { class: "hm-columns" }, renderElement("div", { class: "hm-col" }, needs, recent), renderElement("div", { class: "hm-col" }, next)));
}

/** Mounts Home and asks the host for its view; returns the dispose. */
export function mountHome(root: HTMLElement, end: SpacesTransport): () => void {
  const lifecycle = new AbortController();
  const body = renderElement("div", { class: "hm-body" }, renderEmptyNotice({ inline: true, text: "Loading Home…" }));
  const error = renderElement("p", { class: "hm-error", role: "alert", hidden: true });
  const page = renderElement("div", { class: "hm" },
    renderElement("header", { class: "hm-head" }, renderElement("h1", { text: "Home" }), renderElement("p", { text: "Your work and what needs you." })), error, body);
  root.replaceChildren(page);
  let ctx: HomeContext | undefined;
  const unsubscribe = end.subscribe((message) => {
    if (message.type === "home") {
      error.hidden = true;
      ctx = { end, view: message.home, signal: lifecycle.signal, calendar: ctx?.calendar ?? {} };
      const scroll = page.querySelector(".hm-strip")?.scrollLeft ?? 0;
      const next = render(ctx);
      page.querySelector(".hm-body")?.replaceWith(next);
      const strip = next.querySelector(".hm-strip");
      if (strip) strip.scrollLeft = scroll;
    } else if (message.type === "error") {
      error.hidden = false; error.textContent = message.message;
    }
  });
  end.post({ type: "ready", view: "home" });
  return () => { unsubscribe(); lifecycle.abort(); page.remove(); };
}
