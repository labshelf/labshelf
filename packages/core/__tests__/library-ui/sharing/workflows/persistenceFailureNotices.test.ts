// Pins that a share's failure to store edits on this device is reported once per episode.
import type { ProjectEntry, ShareConnection } from "../../../../src/index.js";
import { persistenceFailureNotices } from "../../../../src/library-ui/sharing/index.js";

function setup() {
  let failure: string | undefined;
  const share = { shareId: "s1", folder: "/lib/thesis", state: () => ({ persistenceFailure: failure }) } as unknown as ShareConnection;
  const shares: ShareConnection[] = [share];
  const entry = { kind: "ready", folder: "/lib/thesis", settings: { id: "thesis", title: "My Thesis" } } as unknown as ProjectEntry;
  const notify = jest.fn();
  const check = persistenceFailureNotices({ shares: { list: () => shares } as never, projects: { list: () => [entry] } as never }, "page", notify);
  return { check, notify, shares, fail: (reason: string | undefined) => { failure = reason; check(); } };
}

describe("persistenceFailureNotices", () => {
  it("notifies once when a failure appears, naming the project and the reason", () => {
    const { notify, fail } = setup();
    fail("QuotaExceededError");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      `Edits to "My Thesis" cannot be stored on this device: QuotaExceededError. Keep this page open until it is fixed; the other members still receive your edits while you are connected.`,
    );
  });

  it("does not notify again while the failure lasts, nor when it clears", () => {
    const { notify, fail, check } = setup();
    fail("QuotaExceededError");
    fail("QuotaExceededError");
    fail("another write failed");
    check();
    fail(undefined);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies a failure after a clear as a new episode", () => {
    const { notify, fail } = setup();
    fail("QuotaExceededError");
    fail(undefined);
    fail("QuotaExceededError");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not notify while no failure was seen", () => {
    const { notify, check } = setup();
    check();
    expect(notify).not.toHaveBeenCalled();
  });
});
