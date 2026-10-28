import { createProjectLabels } from "../../../src/latex/projectLabels";

// Tests that a file's labels are rescanned once after edits pause, from the latest text.
describe("project labels", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("scans a file once after rapid schedules, using the last text", () => {
    const labels = createProjectLabels({ error: jest.fn() } as never);
    const first = jest.fn(() => "\\label{a}");
    const last = jest.fn(() => "\\label{b}");
    labels.schedule("main.tex", first);
    labels.schedule("main.tex", last);
    jest.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
    expect(labels.labels().map((l) => l.name)).toEqual(["b"]);
  });

  it("drops a pending scan on dispose", () => {
    const labels = createProjectLabels({ error: jest.fn() } as never);
    const text = jest.fn(() => "\\label{a}");
    labels.schedule("main.tex", text);
    labels.dispose();
    jest.advanceTimersByTime(300);
    expect(text).not.toHaveBeenCalled();
  });
});
