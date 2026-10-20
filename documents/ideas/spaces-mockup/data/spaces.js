// Holds the three sample Spaces: members, own folders of paper references, linked projects, dates, goals and activity. Mockup only.
const PEOPLE = {
  you: { name: "You" },
  lima: { name: "Prof. Lima" },
  ana: { name: "Ana" },
  bruno: { name: "Bruno" },
  carla: { name: "Carla" },
};

// Dates are days in October and November 2026; today is Tue 20 Oct. A goal counts Done papers or a project's checklist.
const SPACES = [
  {
    id: "research", name: "Research internship",
    purpose: "Why sharpness-aware training generalizes: background reading and the internship report.",
    members: [["you", "Intern"], ["lima", "Advisor"]],
    folders: [
      { id: "background", name: "Background", papers: [["sgdgen", "you"], ["largebatch", "lima"], ["adam", "you"]] },
      { id: "methods", name: "Methods", papers: [["sam", "lima"], ["adamw", "you"]] },
      { id: "baselines", name: "Baselines", papers: [["dropout", "you"], ["bn", "you"], ["edge", "lima"]] },
    ],
    focus: ["sam", "sgdgen", "edge", "dropout"],
    projects: ["ic-report"],
    dates: [
      { id: "r1", day: "16 Oct", kind: "item", text: "Pick the CIFAR-10 setup", done: true },
      { id: "r2", day: "22 Oct", kind: "item", text: "Rerun the SAM baseline with ρ = 0.05", done: false },
      { id: "r3", day: "27 Oct", kind: "item", text: "Send Prof. Lima the related-work list", done: false },
      { id: "r4", day: "3 Nov", kind: "goal", text: "Read the 5 Background and Methods papers", papers: ["sgdgen", "largebatch", "adam", "sam", "adamw"] },
      { id: "r5", day: "10 Nov", kind: "goal", text: "First draft of the report", project: "ic-report" },
      { id: "r6", day: "14 Nov", kind: "deadline", text: "Internship report due" },
    ],
    activity: [
      { who: "lima", icon: "plus", text: "added <b>Edge of Stability</b> to Baselines", when: "yesterday" },
      { who: "lima", icon: "edit", text: "edited the note <b>Meeting 15 Oct</b>", when: "yesterday" },
      { who: "lima", icon: "check", text: "ticked <b>Pick the CIFAR-10 setup</b>", when: "2 days ago" },
      { who: "lima", icon: "link", text: "set the deadline of <b>ic-report</b> to 14 Nov", when: "3 days ago" },
    ],
  },
  {
    id: "course", name: "Course: Optimization for ML",
    purpose: "Group report on adaptive optimizers and weight decay for the final project.",
    members: [["you", "Member"], ["ana", "Member"], ["bruno", "Member"], ["carla", "Member"]],
    folders: [
      { id: "lectures", name: "Lectures", papers: [["bottou", "ana"], ["sgdr", "bruno"], ["adam", "you"], ["bn", "carla"]] },
      { id: "sources", name: "Report sources", papers: [["adamw", "ana"], ["dropout", "you"], ["lookahead", "carla"]] },
    ],
    focus: ["adamw", "adam", "lookahead"],
    projects: ["course-report"],
    dates: [
      { id: "c1", day: "19 Oct", kind: "item", text: "Outline section 2", done: true },
      { id: "c2", day: "23 Oct", kind: "item", text: "Compare AdamW and Adam on the toy problem", done: false },
      { id: "c3", day: "3 Nov", kind: "goal", text: "Read the 5 lecture papers", papers: ["adam", "sgdr", "bottou", "bn", "adamw"] },
      { id: "c4", day: "6 Nov", kind: "goal", text: "First draft of the report", project: "course-report" },
      { id: "c5", day: "12 Nov", kind: "deadline", text: "Report due" },
    ],
    activity: [
      { who: "ana", icon: "edit", text: "edited the note <b>Adam vs AdamW</b>", when: "2 h ago" },
      { who: "bruno", icon: "check", text: "ticked <b>Outline section 2</b>", when: "yesterday" },
      { who: "carla", icon: "plus", text: "added <b>Lookahead Optimizer</b> to Report sources", when: "yesterday" },
      { who: "ana", icon: "link", text: "linked <b>course-report</b> to the Space", when: "4 days ago" },
    ],
  },
  {
    id: "personal", name: "Personal: paper reader", purpose: "",
    members: [["you", "Owner"]],
    folders: [{ id: "toread", name: "To read", papers: [["vae", "you"], ["ddpm", "you"]] }],
    focus: [], projects: [], dates: [], activity: [],
  },
];

const spaceById = (id) => SPACES.find((s) => s.id === id);
const spacePapers = (s) => s.folders.flatMap((f) => f.papers.map(([id, by]) => ({ id, by, folder: f })));
const otherSpaces = (paperId, s) => SPACES.filter((o) => o !== s && spacePapers(o).some((p) => p.id === paperId));
const spacesOfProject = (projectId) => SPACES.filter((s) => s.projects.includes(projectId));
