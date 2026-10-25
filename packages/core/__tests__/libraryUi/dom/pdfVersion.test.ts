/**
 * @jest-environment jsdom
 */
import { ALL_CAPABILITIES, menuLabels, mountForTest, paper } from "./mountHarness";

const library = [
  paper("pre", "papers", { title: "Pre", pdfVersion: "preprint" }),
  paper("acc", "papers", { title: "Acc", pdfVersion: "accepted" }),
  paper("pub", "papers", { title: "Pub", pdfVersion: "published" }),
  paper("unk", "papers", { title: "Unk" }),
  paper("nopdf", "papers", { title: "NoPdf", pdfVersion: "preprint" }),
];
const withPdf = ["papers/pre", "papers/acc", "papers/pub", "papers/unk"];

function setup(caps = ALL_CAPABILITIES, stats = {}) {
  const t = mountForTest({}, { ...caps, findPdf: true });
  t.snapshot(library, withPdf, [], stats);
  return t;
}

function show(t: ReturnType<typeof mountForTest>, id: string): void {
  t.host.post({ type: "select", id });
}

describe("detail head", () => {
  it("shows the chip in the meta line and a Find Published Version button for a preprint", () => {
    const t = setup();
    show(t, "pre");
    expect(t.detail().querySelector(".detail-meta .version-chip")?.textContent).toBe("Preprint");
    expect(t.detail().querySelector('[data-action="findBetterPdf"]')).not.toBeNull();
  });

  it("offers no button for a published PDF, and no button without the findPdf capability", () => {
    const t = setup();
    show(t, "pub");
    expect(t.detail().querySelector('[data-action="findBetterPdf"]')).toBeNull();
    expect(t.detail().querySelector(".version-chip")).toBeNull();
    const bare = mountForTest({}, { reveal: true });
    bare.snapshot(library, withPdf);
    show(bare, "pre");
    expect(bare.detail().querySelector('[data-action="findBetterPdf"]')).toBeNull();
    expect(bare.detail().querySelector(".version-chip")?.textContent).toBe("Preprint");
  });
});

describe("paper menu", () => {
  const rightClick = (t: ReturnType<typeof mountForTest>, id: string): void => {
    t.rows().find((r) => r.dataset["id"] === id)!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  };

  it("lists Find Published Version only for a pre-publication PDF", () => {
    const t = setup();
    rightClick(t, "acc");
    expect(menuLabels()).toContain("Find Published Version…");
    t.key("Escape");
    rightClick(t, "pub");
    expect(menuLabels()).not.toContain("Find Published Version…");
  });
});
