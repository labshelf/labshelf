/** Holds the text of the "How to sync between computers" guide: which sync tools carry a library, and how to set each up. */
import type { SyncGuide } from "./syncGuideTypes.js";

export const syncGuide: SyncGuide = {
  title: "How to sync between computers",
  intro:
    "A library is a folder. Any tool that syncs folders can carry it between your computers, and LabShelf talks to no cloud service. Pick a tool you already use, or set one up with the steps below.",
  tools: [
    {
      id: "dropbox",
      name: "Dropbox",
      pitch: "Syncs a Dropbox folder across your computers.",
      url: "https://www.dropbox.com/install",
      platforms: ["macOS", "Windows", "Linux"],
      steps: [
        "Download the Dropbox app from the site below, install it and sign in.",
        "Wait for the Dropbox folder to appear in your home folder and in the sidebar of your file manager.",
        "Install Dropbox on each other computer and sign in with the same account.",
      ],
    },
    {
      id: "google-drive",
      name: "Google Drive",
      pitch: "Syncs the My Drive folder with Google Drive for desktop.",
      url: "https://support.google.com/drive/answer/10838124",
      platforms: ["macOS", "Windows"],
      steps: [
        "Install Google Drive for desktop from the site below and sign in with your Google account.",
        "In the app's preferences, choose \"Mirror files\" for My Drive, so papers stay on disk instead of streaming.",
        "Install Google Drive for desktop on each other computer and sign in with the same account.",
      ],
    },
    {
      id: "onedrive",
      name: "OneDrive",
      pitch: "Syncs your OneDrive folder; built into Windows.",
      url: "https://www.microsoft.com/microsoft-365/onedrive/download",
      platforms: ["macOS", "Windows"],
      steps: [
        "Windows already includes OneDrive; on a Mac, install it from the site below. Sign in with your Microsoft account.",
        "Open the OneDrive folder and right-click the folder that will hold the library. Choose \"Always keep on this device\".",
        "Sign in to OneDrive on each other computer with the same account.",
      ],
    },
    {
      id: "icloud-drive",
      name: "iCloud Drive",
      pitch: "Syncs a folder between Apple devices and Windows PCs.",
      url: "https://support.apple.com/icloud",
      platforms: ["macOS", "Windows"],
      steps: [
        "On a Mac, open System Settings, choose your Apple Account, then iCloud, and turn on iCloud Drive. On Windows, install iCloud for Windows and tick iCloud Drive.",
        "Create a folder for the library in iCloud Drive and keep it on disk: on a Mac, Control-click the folder and choose \"Keep Downloaded\".",
        "Turn on iCloud Drive on each other computer, signed in to the same Apple Account.",
      ],
    },
    {
      id: "nextcloud",
      name: "Nextcloud",
      pitch: "Syncs a folder with a Nextcloud server you run or rent.",
      url: "https://nextcloud.com/install/#install-clients",
      platforms: ["macOS", "Windows", "Linux"],
      steps: [
        "Install the Nextcloud desktop client from the site below. You need an account on a Nextcloud server.",
        "Sign in, then pick a local folder to sync; the default is Nextcloud in your home folder.",
        "Install the client on each other computer and sign in to the same server and account.",
      ],
    },
  ],
  noCloud: {
    title: "No cloud?",
    tool: {
      id: "syncthing",
      name: "Syncthing",
      pitch: "Free, device to device. Your papers never pass through a server.",
      url: "https://syncthing.net/downloads/",
      platforms: ["macOS", "Windows", "Linux"],
      steps: [
        "Install Syncthing on every computer from the site below and open its web page (http://127.0.0.1:8384).",
        "On each computer, choose Add Remote Device and enter the device ID of the other one, then accept the request on the other side.",
        "Share the folder that holds the library with the other computers. Both must be on at the same time for changes to travel.",
      ],
    },
  },
  afterSetup: {
    title: "After setup",
    steps: [
      "On the first computer, move or create the library inside the synced folder: in VS Code run \"LabShelf: Move Library…\", in the terminal run labshelf move <path>.",
      "On each other computer, choose that same folder as the library once the sync tool has finished copying it.",
    ],
    conflictNote:
      "If a sync tool makes conflicting copies of a file, LabShelf shows them so you can choose which one to keep.",
  },
};
