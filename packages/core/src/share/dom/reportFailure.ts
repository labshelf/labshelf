// Runs a sharing action and shows any rejection as an error toast worded with the action.
import { showToast } from "../../ui/dom/index.js";
import { describeShareFailure } from "../flow/index.js";

/** `action` completes "LabShelf could not …", for example "share the project". */
export async function reportFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    showToast(describeShareFailure(action, error), "error");
  }
}
