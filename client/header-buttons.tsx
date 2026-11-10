import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { botWorkspacesRpc } from "../shared/rpc";
import { Avatar } from "./Avatar";

/**
 * A button with the bot's avatar in the header of each bot's workspace, so a bot chat open in
 * Paseo's chat view is one press from its bot: its chats, settings, memory and routines.
 * Header buttons belong to one workspace each, so the set follows the bots' workspaces as they
 * appear, get renamed or go away.
 */
export function installBotHeaderButtons(client: PluginClientContext): () => void {
  const buttons = new Map<string, { registration: PluginButtonRegistration; look: string }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sync = async () => {
    const { workspaces } = await client.rpc(botWorkspacesRpc, {});
    if (stopped) return;
    const seen = new Set<string>();
    for (const { workspaceId, botId, name, avatar } of workspaces) {
      seen.add(workspaceId);
      const look = JSON.stringify([botId, name, avatar]);
      const button = {
        title: `Open ${name}`,
        icon: ({ size }: { size: number }) => <Avatar avatar={avatar} size={size} />,
        behavior: { kind: "action" as const, onPress: () => client.openScreen({ screenId: "bot-sessions", params: { botId, botName: name } }) },
      };
      const existing = buttons.get(workspaceId);
      if (existing) {
        if (existing.look !== look) existing.registration.update(button);
        existing.look = look;
        continue;
      }
      // Button ids are per workspace and allow only [a-z0-9-], so every bot workspace uses "bot".
      buttons.set(workspaceId, { registration: client.addHeaderButton({ id: "bot", workspaceId, button }), look });
    }
    for (const [workspaceId, button] of buttons) {
      if (seen.has(workspaceId)) continue;
      button.registration.remove();
      buttons.delete(workspaceId);
    }
  };
  const run = () => void sync().catch((error: unknown) => console.error("paseo-bots: couldn't update the bots' header buttons", error));
  const later = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      run();
    }, 1000);
  };

  run();
  // A bot's workspace is created (its first chat), renamed with the bot, or archived.
  const unsubscribe = client.paseo.workspaces.subscribe(later);
  // The daemon only streams workspace updates to clients that subscribed through a list request.
  let subscription: { release(): Promise<void> } | null = null;
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      if (stopped) void result.subscription.release();
      else subscription = result.subscription;
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    void subscription?.release();
    for (const button of buttons.values()) button.registration.remove();
    buttons.clear();
  };
}
