/** Google OAuth and Drive endpoints and the Drive scopes, shared by every app's sign-in and the Drive client. */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** drive.file shows an app only the files its own Google Cloud project created; appdata holds the hidden app folder. */
export const GOOGLE_DRIVE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];

export const DRIVE_API_BASE = "https://www.googleapis.com";
export const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload";
