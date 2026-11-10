// Shows the Account tab: the shared Account view over the display name shared projects use and the page's Cloudflare relay.
import { createAccountSource } from "@labshelf/core";
import { mountAccountView, renderElement } from "@labshelf/core/dom";
import { followMemberName, readMemberName, writeMemberName } from "../../collab";
import type { TabModule } from "./tabKinds";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const { relay, logger } = ctx;
  const source = createAccountSource({
    readUserName: async () => (await readMemberName()) ?? "",
    writeUserName: writeMemberName,
    cloudflare: () => relay,
    remoteAccess: () => ctx.remote?.(),
    logger,
  });
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  const view = mountAccountView(body, source);
  // The options page edits the same name; the tab follows it.
  const stopName = followMemberName(() => { void source.refresh(); }, logger);
  return { dispose: () => { stopName(); view.dispose(); body.remove(); } };
};
