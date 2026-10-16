// Tests which source changes mark a root's PDF stale, when a build clears that, and that the stale event fires once.
import { StaleSources } from "../../../../src/writing/preview/stale";

function setup() {
  let emit: (filePath: string) => void = () => {};
  const dispose = jest.fn();
  const events = { onSourceChanged: (listener: (filePath: string) => void) => { emit = listener; return { dispose }; } };
  let clock = 1000;
  const onStale = jest.fn();
  const sources = new StaleSources(events, () => clock, onStale);
  return { sources, onStale, dispose, edit: (file: string) => emit(file), tick: (to: number) => { clock = to; } };
}

const folder = "/p/paper";

describe("StaleSources", () => {
  it("marks a built root stale on a source edit and fires once for repeated edits", () => {
    const { sources, onStale, edit } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: false, builtAt: 1000 });
    edit("/p/paper/main.tex");
    edit("/p/paper/chapters/intro.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: true, builtAt: 1000 });
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith(folder, "main.tex");
  });

  it("clears stale and records the time on a successful build", () => {
    const { sources, onStale, edit, tick } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    edit("/p/paper/refs.bib");
    tick(2000);
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: false, builtAt: 2000 });
    edit("/p/paper/main.typ");
    expect(onStale).toHaveBeenCalledTimes(2);
  });

  it("stays stale when a source changed during the build", () => {
    const { sources, edit, tick } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    edit("/p/paper/main.tex");
    sources.building(folder, "main.tex");
    edit("/p/paper/main.tex");
    tick(3000);
    sources.succeeded(folder, "main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: true, builtAt: 3000 });
  });

  it("keeps stale as it is when a build fails", () => {
    const { sources, edit } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    edit("/p/paper/main.tex");
    sources.building(folder, "main.tex");
    sources.failed(folder, "main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: true, builtAt: 1000 });
  });

  it("ignores built outputs, other extensions and files outside the folder", () => {
    const { sources, onStale, edit } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    for (const file of ["main.log", "main.aux", "main.pdf", "/p/paper/notes.md", "/p/other/main.tex", "/p/paper-two/main.tex"]) { edit(file.startsWith("/") ? file : `/p/paper/${file}`); }
    expect(sources.statusOf(folder, "main.tex")).toEqual({ stale: false, builtAt: 1000 });
    expect(onStale).not.toHaveBeenCalled();
  });

  it("marks nothing before a root has been built", () => {
    const { sources, onStale, edit } = setup();
    edit("/p/paper/main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({});
    sources.building(folder, "main.tex");
    sources.failed(folder, "main.tex");
    edit("/p/paper/main.tex");
    expect(sources.statusOf(folder, "main.tex")).toEqual({});
    expect(onStale).not.toHaveBeenCalled();
  });

  it("tracks each root of a folder on its own and stops listening on dispose", () => {
    const { sources, dispose, edit } = setup();
    sources.building(folder, "main.tex");
    sources.succeeded(folder, "main.tex");
    expect(sources.statusOf(folder, "b/main.tex")).toEqual({});
    edit("/p/paper/main.tex");
    sources.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
