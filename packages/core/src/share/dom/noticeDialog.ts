// Shows an informational dialog with a single OK button.
import { showDialog } from "../../ui/dom/index.js";

export async function showNoticeDialog(title: string, message: string, severity: "info" | "warning" = "info"): Promise<void> {
  await showDialog({ title, message, severity, buttons: [{ id: "ok", label: "OK", primary: true }] });
}
