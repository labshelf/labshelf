// Supplies sample participant topics with explicit decisions and linked checklist items.
const DISCUSSION_TOPICS = [
  { id: "sam-setup", space: "research", title: "Which setup makes the SAM comparison fair?", source: "paper:sam", resolved: false,
    summary: "Use CIFAR-10 and ResNet-18, with three seeds per method. Keep the training budget fixed. Confirm the SAM radius before the next run.",
    messages: [
      { id: "sam-1", who: "lima", when: "Yesterday · 10:20", text: "Let’s keep CIFAR-10 and ResNet-18 for every method, with three seeds. Otherwise the comparison mixes architecture and optimizer effects." },
      { id: "sam-2", who: "you", when: "Yesterday · 11:05", text: "Agreed: same architecture, training budget and seeds for SAM, Dropout and Batch norm. I’ll record the setup in the report." },
      { id: "sam-3", who: "lima", when: "Today · 09:15", text: "Please rerun SAM with ρ = 0.05 and include the seed-level results, not just the average." },
    ], decisions: ["sam-2"] },
  { id: "sharpness", space: "research", title: "Does sharpness explain the whole effect?", source: "note:why-sam", resolved: false,
    summary: "Check whether the apparent gain survives Batch norm. Separate the empirical observation from a causal explanation in the note.",
    messages: [
      { id: "sharp-1", who: "you", when: "19 Oct · 15:10", text: "The note ties flatness to generalization, but Batch norm changes the picture. Should we call this evidence or a hypothesis?" },
      { id: "sharp-2", who: "lima", when: "Yesterday · 16:30", text: "Keep it as a hypothesis. Compare the Batch norm baseline before making a causal claim, and explain that limitation in the report." },
    ], decisions: [] },
  { id: "report-scope", space: "research", title: "Scope of the first report", source: "project:ic-report", resolved: true,
    summary: "The first draft focuses on CIFAR-10. ImageNet is outside this report’s scope. Revisit after reviewing the baseline results.",
    messages: [{ id: "scope-1", who: "lima", when: "16 Oct · 14:00", text: "Keep the first draft focused on CIFAR-10. Do not add ImageNet experiments to this report." }], decisions: ["scope-1"] },
  { id: "weight-decay", space: "course", title: "How do we explain Adam vs AdamW?", source: "note:adam-vs", resolved: false,
    summary: "Use a shared toy problem to separate L2 regularization from decoupled weight decay. Include the derivation in our comparison note.",
    messages: [
      { id: "decay-1", who: "ana", when: "Today · 10:00", text: "Let’s show both updates on the same toy problem and keep the learning rate fixed." },
      { id: "decay-2", who: "bruno", when: "Today · 10:12", text: "Use identical initialization and a fixed learning rate for both methods, then compare the parameter trajectories." },
      { id: "decay-3", who: "you", when: "Today · 10:18", text: "I’ll run the comparison and bring the plot for the report." },
    ], decisions: ["decay-2"] },
  { id: "course-outline", space: "course", title: "Agree on the report outline", source: "project:course-report", resolved: true,
    summary: "The report follows the shared outline. Each method gets an explanation, a limitation and the same comparison setup.",
    messages: [{ id: "outline-1", who: "carla", when: "Yesterday · 17:00", text: "Use the shared outline and describe one limitation for each optimizer before the experiments section." }], decisions: ["outline-1"] },
];

for (const [space, task, topic, message] of [["research", "r2", "sam-setup", "sam-3"], ["course", "c2", "weight-decay", "decay-3"]]) {
  Object.assign(spaceById(space).dates.find((d) => d.id === task), { topic, message, assignee: "you" });
}

const DISCUSS = { view: "topics", filter: "open", query: "", selected: {}, drafts: {}, creating: false, editing: false, taskMessage: null };
const discussionTopics = (s) => DISCUSSION_TOPICS.filter((t) => t.space === s.id);
const selectedDiscussion = (s) => discussionTopics(s).find((t) => t.id === DISCUSS.selected[s.id]);
const discussionSource = (source) => {
  const [kind, id] = source.split(":");
  return kind === "paper" ? paperShort(id) : kind === "note" ? noteTitle(NOTES.find((n) => n.id === id)) : PROJECTS[id].name;
};
