// Fills the sign-in result page from its query: which service the app connected and whether the sign-in failed.

const SERVICES = { cloudflare: "Cloudflare", github: "GitHub" };
const CROSS = '<path d="M4 4l8 8M12 4l-8 8"/>';

const query = new URLSearchParams(location.search);
const service = Object.hasOwn(SERVICES, query.get("service")) ? query.get("service") : undefined;
const error = query.get("error");
const name = service ? SERVICES[service] : "your account";
const text = (id, value) => { document.getElementById(id).textContent = value; };

text("svc-cmd", service ?? "account");
document.title = error ? "LabShelf · Sign-in failed" : "LabShelf · Connected";

if (error) {
  document.getElementById("status").classList.add("err");
  document.getElementById("icon").innerHTML = CROSS;
  text("status-text", error === "access_denied" ? "access denied" : "sign-in failed");
  text("title", "Sign-in did not finish.");
  text("lead", error === "access_denied"
    ? `${name} was not connected because access was denied. Go back to LabShelf to try again.`
    : `${name} was not connected. Go back to LabShelf to try again; it shows what went wrong.`);
} else {
  text("status-text", `connected to ${name}`);
  text("title", "You are signed in.");
  text("lead", "Go back to LabShelf. You can close this tab.");
  if (service === "cloudflare") {
    text("note", "LabShelf keeps this sign-in on your device to install and update your relay. Disconnect Cloudflare in LabShelf to remove it.");
  }
}
