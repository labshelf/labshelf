/** disposeAll disposes every item, in the order given. */
import { disposeAll } from "../../src/disposables";

describe("disposeAll", () => {
  it("disposes the items in order", () => {
    const order: string[] = [];
    disposeAll([{ dispose: () => order.push("a") }, { dispose: () => order.push("b") }, { dispose: () => order.push("c") }]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("accepts an empty list", () => {
    expect(() => disposeAll([])).not.toThrow();
  });
});
