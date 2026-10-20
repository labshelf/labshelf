const REDIRECT = "http://127.0.0.1:8976/callback";
window.signIn = (startUrl) => new Promise(async (resolve) => {
  const seen = [];
  const tab = await chrome.tabs.create({ url: startUrl, active: true });
  const onUpdated = (id, change, t) => {
    if (id !== tab.id) return;
    const url = change.url ?? t.pendingUrl;
    if (url) seen.push(url);
    if (url && url.startsWith(REDIRECT)) { chrome.tabs.onUpdated.removeListener(onUpdated); chrome.tabs.remove(tab.id); resolve({ url, seen }); }
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
});
window.tokenProbe = async () => {
  const r = await fetch("https://dash.cloudflare.com/oauth2/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "bogus", client_id: "6bf60d8231e753c5249c7044aa0c4aff" }) });
  return { status: r.status, body: await r.text() };
};
window.takeLease = (name) => new Promise((resolve) => {
  navigator.locks.request(name, { ifAvailable: true }, (lock) => {
    if (!lock) { resolve("busy"); return; }
    resolve("owner");
    return new Promise(() => {}); // hold until the page dies
  });
});
window.stealLease = (name) => new Promise((resolve) => {
  navigator.locks.request(name, { steal: true }, () => { resolve("stolen"); return new Promise(() => {}); }).catch((e) => resolve("err " + e.name));
});
window.watchLoss = (name) => { window.lost = null; };
window.queryLease = async () => (await navigator.locks.query()).held.map((l) => l.name);
