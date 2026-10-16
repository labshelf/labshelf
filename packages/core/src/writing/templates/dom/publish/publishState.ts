// Holds the Publish screen's state and applies the host's `publish.*` messages to it.
import type { HostToGallery, PublishCheckResult } from "../../protocol/index.js";
import { PUBLISH_CHECK_IDS } from "../../publishCheckLabels.js";

export interface PublishState {
  results: PublishCheckResult[];
  running: boolean;
  login: string | undefined;
  signingIn: boolean;
  submitting: boolean;
  error: string | undefined;
  thumbnail: string | undefined;
}

export type PublishOutcome = "updated" | "signedIn" | "submitted" | "ignored";

export const initialPublishState = (): PublishState => ({
  results: [], running: false, login: undefined, signingIn: false, submitting: false, error: undefined, thumbnail: undefined,
});

export const allChecksPassed = (state: PublishState): boolean =>
  PUBLISH_CHECK_IDS.every((id) => state.results.find((r) => r.id === id)?.ok === true);

export function applyHostMessage(state: PublishState, message: HostToGallery): PublishOutcome {
  switch (message.type) {
    case "publish.checks":
      state.results = message.checks;
      state.running = message.running;
      if (message.thumbnail !== undefined) state.thumbnail = message.thumbnail;
      return "updated";
    case "publish.auth": {
      const justSignedIn = state.signingIn && message.login !== undefined;
      state.signingIn = false;
      state.login = message.login;
      state.error = message.error;
      return justSignedIn ? "signedIn" : "updated";
    }
    case "publish.submitted":
      state.submitting = false;
      return "submitted";
    case "publish.failed":
      state.running = false;
      state.submitting = false;
      state.error = message.error;
      return "updated";
    default:
      return "ignored";
  }
}
