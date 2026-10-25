// Uploads the Worker script to an account as a multipart module with its bindings.
import type { CloudflareClient } from "./cloudflareClient.js";

const COMPATIBILITY_DATE = "2026-10-01";
const SCRIPT_FILE = "worker.js";

export interface WorkerUpload { accountId: string; workerName: string; script: string; kvNamespaceId: string; withMigrations: boolean }

/** Migrations go only on the first upload: they create the Room class; later uploads keep its data and the secrets. */
function workerMetadata(kvNamespaceId: string, withMigrations: boolean): Record<string, unknown> {
  return {
    main_module: SCRIPT_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "durable_object_namespace", name: "ROOM", class_name: "Room" },
      { type: "kv_namespace", name: "KV", namespace_id: kvNamespaceId },
    ],
    keep_bindings: ["secret_text"],
    ...(withMigrations ? { migrations: { new_tag: "v1", new_sqlite_classes: ["Room"] } } : {}),
  };
}

export async function uploadWorker(client: CloudflareClient, upload: WorkerUpload): Promise<void> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(workerMetadata(upload.kvNamespaceId, upload.withMigrations))], { type: "application/json" }));
  form.append(SCRIPT_FILE, new Blob([upload.script], { type: "application/javascript+module" }), SCRIPT_FILE);
  await client.call("PUT", `/accounts/${upload.accountId}/workers/scripts/${upload.workerName}`, form);
}
