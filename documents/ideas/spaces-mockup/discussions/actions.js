// Handles topic replies and explicit promotion of messages into decisions or tasks.
const activeDiscussionSpace = () => spaceById(activeTab().id);
const activeDiscussion = () => selectedDiscussion(activeDiscussionSpace());

function openDiscussion(topic, message) {
  const s = activeDiscussionSpace();
  DISCUSS.selected[s.id] = topic;
  Object.assign(DISCUSS, { view: "topics", filter: "all", query: "", creating: false, editing: false, taskMessage: null });
  render();
  const target = document.getElementById(`message-${message}`);
  if (target) { target.tabIndex = -1; target.focus(); target.scrollIntoView({ block: "nearest" }); }
}

ACTIONS["ds-open-from-overview"] = (el) => {
  APP.view[activeDiscussionSpace().id] = "discussions";
  openDiscussion(el.dataset.topic);
};
ACTIONS["ds-topic"] = (el) => openDiscussion(el.dataset.id);
ACTIONS["ds-origin"] = (el) => openDiscussion(el.dataset.topic, el.dataset.message);
ACTIONS["ds-view"] = (el) => { DISCUSS.view = el.dataset.view; DISCUSS.creating = false; render(); };
ACTIONS["ds-filter"] = () => { DISCUSS.filter = DISCUSS.filter === "open" ? "all" : "open"; render(); };
ACTIONS["ds-create"] = () => { DISCUSS.creating = true; render(); document.getElementById("ds-title").focus(); };
ACTIONS["ds-cancel"] = () => { DISCUSS.creating = false; render(); };
ACTIONS["ds-edit-summary"] = () => { DISCUSS.editing = !DISCUSS.editing; render(); if (DISCUSS.editing) document.getElementById("ds-summary").focus(); };
ACTIONS["ds-resolve"] = () => { activeDiscussion().resolved = !activeDiscussion().resolved; render(); };
ACTIONS["ds-cancel-task"] = () => { DISCUSS.taskMessage = null; render(); };
ACTIONS["ds-task-form"] = (el) => { DISCUSS.taskMessage = el.dataset.message; render(); document.getElementById("ds-task-title").focus(); };
ACTIONS["ds-decision"] = (el) => {
  const t = activeDiscussion();
  if (!t.decisions.includes(el.dataset.message)) t.decisions.push(el.dataset.message);
  render();
  CoreUI.toast("Decision kept with its source message. Find it in Decisions.", "ok");
};
ACTIONS["ds-source"] = (el) => {
  const [kind, id] = el.dataset.source.split(":");
  const s = activeDiscussionSpace();
  if (kind === "project") return openProject(id);
  if (kind === "note") { NOTE_STATE.open[s.id] = id; return openSpace(s.id, "notes"); }
  LIBRARY_TREE.setSelected(id);
  openSpace(s.id, "papers");
  CoreUI.toast(`Selected ${paperShort(id)} in the Library. The reader is outside this mockup.`);
};

function submitDiscussionReply(data) {
  const t = activeDiscussion();
  const text = data.get("reply").trim();
  if (!text) return;
  const id = crypto.randomUUID();
  t.messages.push({ id, who: "you", when: "Just now", text });
  DISCUSS.drafts[t.id] = "";
  render();
  document.getElementById(`message-${id}`).scrollIntoView({ block: "nearest" });
  document.getElementById("ds-reply").focus({ preventScroll: true });
}

function submitDiscussionTopic(data) {
  const title = data.get("title").trim();
  const text = data.get("body").trim();
  if (!title || !text) return;
  const id = crypto.randomUUID();
  DISCUSSION_TOPICS.push({ id, space: activeDiscussionSpace().id, title, source: data.get("source"), resolved: false,
    summary: "No working summary yet. Participants can edit it as the conversation develops.",
    messages: [{ id: crypto.randomUUID(), who: "you", when: "Just now", text }], decisions: [] });
  openDiscussion(id);
}

function submitDiscussionTask(data) {
  const s = activeDiscussionSpace();
  const title = data.get("title").trim();
  const assignee = data.get("assignee");
  if (!title || !s.members.some(([who]) => who === assignee)) return;
  s.dates.push({ id: crypto.randomUUID(), kind: "item", text: title, day: data.get("due"), done: false,
    topic: activeDiscussion().id, message: DISCUSS.taskMessage, assignee });
  DISCUSS.taskMessage = null;
  render();
  CoreUI.toast("Task added with an owner and a due date. Find it in Tasks and Overview.", "ok");
}

document.addEventListener("input", (e) => {
  if (e.target.form?.id.startsWith("ds-") && e.target.required) e.target.setCustomValidity("");
  if (e.target.id === "ds-search") { DISCUSS.query = e.target.value; render(); }
  if (e.target.id === "ds-reply") DISCUSS.drafts[activeDiscussion().id] = e.target.value;
});
document.addEventListener("submit", (e) => {
  if (!["ds-reply-form", "ds-create-form", "ds-summary-form", "ds-task-form"].includes(e.target.id)) return;
  e.preventDefault();
  for (const field of e.target.querySelectorAll("[required]")) {
    field.setCustomValidity(field.value.trim() ? "" : "Enter some text before submitting.");
    if (!field.reportValidity()) return;
  }
  const data = new FormData(e.target);
  if (e.target.id === "ds-reply-form") submitDiscussionReply(data);
  if (e.target.id === "ds-create-form") submitDiscussionTopic(data);
  if (e.target.id === "ds-task-form") submitDiscussionTask(data);
  if (e.target.id === "ds-summary-form") {
    const summary = data.get("summary").trim();
    if (!summary) return;
    activeDiscussion().summary = summary;
    DISCUSS.editing = false;
    render();
  }
});
