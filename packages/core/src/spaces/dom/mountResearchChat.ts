// Mounts a positioned research conversation scoped to a Space or project.
import { renderElement, setPlannedNotice } from "../../ui/dom/index.js";

export interface ResearchChat {
  setContext(name: string | null): void;
  dispose(): void;
}

export function mountResearchChat(root: HTMLElement, options: { context: string | null }): ResearchChat {
  const name = renderElement("strong", { class: "chat-context-name" });
  const context = renderElement("div", { class: "chat-context" }, renderElement("span", { text: "Context" }), name,
    renderElement("span", { text: "Add papers or notes to ground your question." }), button("Add context", "ls-btn ls-btn-ghost"));
  const welcome = renderElement("div", { class: "chat-welcome" }, renderElement("h2", { text: "Think alongside your research" }),
    renderElement("p", { text: "Ask about a passage, compare methods or work through a derivation." }),
    ...["Compare the methods in this Space", "Help me work through a derivation", "What should I read next?"]
      .map(text => button(text, "chat-suggestion")));
  const panel = renderElement("section", { class: "chat-panel", "aria-label": "Research chat" },
    renderElement("header", { class: "chat-head" }, renderElement("strong", { text: "Research chat" })), context,
    renderElement("div", { class: "chat-messages", "aria-live": "polite" }, welcome), composer(),
    renderElement("p", { class: "chat-privacy", text: "No model connected" }));
  const setContext = (value: string | null): void => {
    name.textContent = value ?? "Library";
    name.title = value ?? "Library";
  };
  setContext(options.context);
  root.replaceChildren(panel);
  return { setContext, dispose: () => root.replaceChildren() };
}

function button(text: string, className: string): HTMLButtonElement {
  const control = renderElement("button", { class: className, type: "button", text });
  setPlannedNotice(control, "Needs a connected model");
  return control;
}

function composer(): HTMLElement {
  const input = renderElement("textarea", { rows: 3, placeholder: "Ask a question…", readonly: true });
  setPlannedNotice(input, "Needs a connected model");
  return renderElement("div", { class: "chat-compose" },
    renderElement("label", {}, "Ask about your research", input),
    renderElement("div", {}, renderElement("span", { text: "Your conversation will be private." }), button("Send message", "ls-btn ls-button-soft")));
}
