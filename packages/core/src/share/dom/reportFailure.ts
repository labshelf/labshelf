// Runs a sharing action and shows any rejection as an error toast worded with the action.
import { toast } from "../../ui/dom/index.js";
import { shareFailureText } from "../flow/index.js";

/** `action` completes "LabShelf could not …", for example "share the project". */
export async function reportingFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    toast(shareFailureText(action, error), "error");
  }
}
