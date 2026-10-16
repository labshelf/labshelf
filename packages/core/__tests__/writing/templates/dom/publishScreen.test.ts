/**
 * @jest-environment jsdom
 */
// Tests the publish screen of the template gallery: entry, form, checks, GitHub steps and leaving.
import { mountGallery } from "./galleryHarness";
import { CHECK_IDS, DRAFT, LABELS, PROJECT, alert, allPassed, button, checks, edit, field, openPublish, row, screen } from "./publishHarness";

describe("entry and form", () => {
  it("posts publish.start from the sidebar button", () => {
    const g = mountGallery();
    const btn = [...g.root.querySelectorAll<HTMLButtonElement>(".ls-tpl-sidebar button")].find((b) => b.textContent?.includes("Publish a template"))!;
    btn.click();
    expect(g.ofType("publish.start")).toHaveLength(1);
  });

  it("shows the screen on publish.open with the project title and the prefilled form", () => {
    const g = openPublish();
    expect(screen(g)).not.toBeNull();
    expect(screen(g)!.querySelector("h1")?.textContent).toContain("Publish");
    expect(screen(g)!.querySelector("h1")?.textContent).toContain("My Thesis");
    expect(field(g, "Name").value).toBe("My Thesis");
    expect(field(g, "Category").value).toBe("thesis");
    expect(field(g, "License").value).toBe("MIT");
    expect(field(g, "Description").value).toBe("A thesis template");
    expect(g.cards()).toHaveLength(0);
  });

  it("lists one not-run row per check with its label", () => {
    const g = openPublish();
    for (const id of CHECK_IDS) {
      expect(row(g, LABELS[id])).toBeDefined();
      expect(row(g, LABELS[id]).getAttribute("data-state")).toBe("idle");
    }
  });
});

describe("checks", () => {
  it("posts publish.check with the project and the current form values", () => {
    const g = openPublish();
    edit(field(g, "Name"), "Renamed");
    edit(field(g, "License"), "CC-BY-4.0");
    button(g, "Run checks")!.click();
    expect(g.ofType("publish.check")).toEqual([{ type: "publish.check", project: PROJECT, draft: { ...DRAFT, name: "Renamed", license: "CC-BY-4.0" } }]);
  });

  it("marks rows busy while running", () => {
    const g = openPublish();
    g.deliver(checks([], { running: true }));
    for (const id of CHECK_IDS) {
      expect(row(g, LABELS[id]).getAttribute("aria-busy")).toBe("true");
      expect(row(g, LABELS[id]).getAttribute("data-state")).toBe("running");
    }
  });

  it("shows passed and failed rows, with the message under a failed one", () => {
    const g = openPublish();
    g.deliver(checks([{ id: "license", ok: true }, { id: "latexmkrc", ok: false, message: "Remove latexmkrc." }]));
    expect(row(g, LABELS.license).getAttribute("data-state")).toBe("passed");
    expect(row(g, LABELS.latexmkrc).getAttribute("data-state")).toBe("failed");
    expect(row(g, LABELS.latexmkrc).textContent).toContain("Remove latexmkrc.");
    expect(row(g, LABELS.license).getAttribute("aria-busy")).not.toBe("true");
    expect(row(g, LABELS.sizes).getAttribute("data-state")).toBe("idle");
  });

  it("hides the GitHub step until every check passed", () => {
    const g = openPublish();
    expect(button(g, "Sign in with GitHub")).toBeNull();
    g.deliver(checks(CHECK_IDS.map((id) => (id === "build" ? { id, ok: false, message: "No engine" } : { id, ok: true }))));
    expect(button(g, "Sign in with GitHub")).toBeNull();
    g.deliver(allPassed());
    expect(button(g, "Sign in with GitHub")).not.toBeNull();
  });

  it("resets rows and hides the GitHub step when a field is edited", () => {
    const g = openPublish();
    g.deliver(allPassed());
    edit(field(g, "Description"), "changed");
    for (const id of CHECK_IDS) expect(row(g, LABELS[id]).getAttribute("data-state")).toBe("idle");
    expect(button(g, "Sign in with GitHub")).toBeNull();
  });

  it("fills the preview image from the thumbnail", () => {
    const g = openPublish();
    g.deliver(allPassed({ thumbnail: "data:image/png;base64,AAAA" }));
    expect(screen(g)!.querySelector("figure img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});

describe("GitHub steps", () => {
  const ready = () => { const g = openPublish(); g.deliver(allPassed()); return g; };

  it("posts publish.signIn from the sign-in button", () => {
    const g = ready();
    button(g, "Sign in with GitHub")!.click();
    expect(g.ofType("publish.signIn")).toHaveLength(1);
  });

  it("shows the signed-in login and posts publish.submit with project and draft", () => {
    const g = ready();
    g.deliver({ type: "publish.auth", login: "ada" });
    expect(screen(g)!.textContent).toContain("Signed in as ada");
    expect(button(g, "Sign in with GitHub")).toBeNull();
    button(g, "Submit for review")!.click();
    expect(g.ofType("publish.submit")).toEqual([{ type: "publish.submit", project: PROJECT, draft: DRAFT }]);
  });

  it("keeps the sign-in button and shows an auth error in an alert", () => {
    const g = ready();
    g.deliver({ type: "publish.auth", error: "Sign-in was refused" });
    expect(button(g, "Sign in with GitHub")).not.toBeNull();
    expect(alert(g)?.textContent).toContain("Sign-in was refused");
  });

  it("shows a submit failure in an alert and re-enables Submit", () => {
    const g = ready();
    g.deliver({ type: "publish.auth", login: "ada" });
    button(g, "Submit")!.click();
    g.deliver({ type: "publish.failed", error: "Fork failed" });
    expect(alert(g)?.textContent).toContain("Fork failed");
    expect(button(g, "Submit for review")!.disabled).toBe(false);
  });

  it("shows the pull request link when submitted and Start over returns to a fresh form", () => {
    const g = ready();
    g.deliver({ type: "publish.auth", login: "ada" });
    button(g, "Submit for review")!.click();
    g.deliver({ type: "publish.submitted", url: "https://github.com/o/r/pull/7" });
    expect(screen(g)!.textContent).toContain("Submitted for review");
    const link = [...screen(g)!.querySelectorAll("a, button")].find((e) => e.textContent?.includes("View pull request"))!;
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/7");
    button(g, "Start over")!.click();
    expect(field(g, "Name").value).toBe("My Thesis");
    for (const id of CHECK_IDS) expect(row(g, LABELS[id]).getAttribute("data-state")).toBe("idle");
    expect(button(g, "Sign in with GitHub")).toBeNull();
  });
});

describe("leaving", () => {
  it("returns to the grid with the Templates back button", () => {
    const g = openPublish();
    g.root.querySelector<HTMLButtonElement>(".ls-tpl-detail-nav button")!.click();
    expect(screen(g)).toBeNull();
  });

  it("returns to the grid on Escape", () => {
    const g = openPublish();
    screen(g)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen(g)).toBeNull();
  });
});

describe("manifest check, required description and host failure", () => {
  it("lists a Name and description set row", () => {
    const g = openPublish();
    expect(row(g, "Name and description set")).toBeDefined();
  });

  it("marks the Description textarea required", () => {
    const g = openPublish();
    expect(field(g, "Description").required).toBe(true);
  });

  it("leaves the running state on publish.failed", () => {
    const g = openPublish();
    g.deliver(checks([], { running: true }));
    expect(screen(g)!.textContent).toContain("Running checks…");
    g.deliver({ type: "publish.failed", error: "Could not run the checks" });
    expect(screen(g)!.textContent).not.toContain("Running checks…");
    expect(button(g, "Run checks")!.disabled).toBe(false);
  });
});
