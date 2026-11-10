import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { BotsSurface } from "./client/BotsSurface";
import { BotSessionsScreen, BotShortcuts } from "./client/BotShortcuts";
import { ConnectCard } from "./client/cards/ConnectCard";
import { ProposalCard } from "./client/cards/ProposalCard";
import { RoutineRunCard } from "./client/cards/RoutineRunCard";
import { installBotHeaderButtons } from "./client/header-buttons";
import { requestIntent } from "./client/intent";
import { BotsSettings } from "./client/settings/BotsSettings";
import { installTooltips } from "./client/ui/Tooltip";
import { appSignIns } from "./shared/apps";
import { BOT_LABEL } from "./shared/bot";
import { proposalIdOf } from "./shared/proposals";
import { APP_SIGN_IN_CARD, AppSignInSchema, chatBotRpc, helloRpc, ROUTINE_RUN_CARD, RoutineRunCardSchema } from "./shared/rpc";
import { LEARN_COMMAND, learnPrompt } from "./shared/skills";

export default function contribute(client: PluginClientContext) {
  // Hands the daemon side its Paseo API so bot routines can run.
  void client.rpc(helloRpc, {}).catch(() => {});
  const removeTooltips = installTooltips();
  const removeHeaderButtons = installBotHeaderButtons(client);
  client.addScreen({ id: "bots", title: "Bots", Component: BotsSurface });
  client.addScreen({ id: "bot-sessions", title: (params) => params.botName || "Bot sessions", Component: BotSessionsScreen });
  client.addSidebarHeaderItem({ id: "bot-shortcuts", title: "Bots section", Component: BotShortcuts });
  client.addSettingsScreen({ id: "bots", title: "Bots", icon: "Bot", Component: BotsSettings });
  client.addCommandCenterItem({
    id: "open-bots",
    title: "Open Bots",
    icon: "Bot",
    keywords: ["bot", "assistant", "persona"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "bots" });
    },
  });
  client.addCommandCenterItem({
    id: "new-bot",
    title: "New bot",
    icon: "Plus",
    keywords: ["bot", "create", "assistant"],
    context: "global",
    onSelect({ openScreen }) {
      requestIntent({ kind: "new-bot" });
      openScreen({ screenId: "bots" });
    },
  });
  // Bot chats live in Paseo's chat view; /learn and the cards below are added to it.
  client.addSlashCommand({
    ...LEARN_COMMAND,
    context: "agent",
    async onSubmit({ agent, args, paseo }) {
      const botId = agent.labels[BOT_LABEL] ?? (await client.rpc(chatBotRpc, { agentId: agent.id })).botId;
      if (!botId) throw new Error("/learn works in bot chats.");
      await paseo.agents.ref(agent.id).send(learnPrompt(args));
    },
  });
  client.addTimelineTransformer({
    id: "proposals",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const proposalId = proposalIdOf(item);
      return proposalId ? { items: [{ type: "plugin", kind: "proposal", version: 1, data: { proposalId } }] } : undefined;
    },
  });
  client.addTimelineRenderer({
    kind: "proposal",
    version: 1,
    schema: z.object({ proposalId: z.string() }),
    Component: ({ item, theme, layout }) => <ProposalCard colors={theme.colors} compact={layout.compact} proposalId={item.data.proposalId} />,
  });
  // A bot's request to connect an app, in Paseo's view too.
  client.addTimelineTransformer({
    id: "app-sign-ins",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const signIns = appSignIns(item);
      return signIns.length ? { items: signIns.map((data) => ({ type: "plugin", ...APP_SIGN_IN_CARD, data })) } : undefined;
    },
  });
  client.addTimelineRenderer({
    ...APP_SIGN_IN_CARD,
    schema: AppSignInSchema,
    Component: ({ item, agentId, timestamp, theme }) => <ConnectCard colors={theme.colors} signIn={item.data} since={timestamp.getTime()} agentId={agentId} />,
  });
  // A routine's run, in the chat its results go to.
  client.addTimelineRenderer({
    ...ROUTINE_RUN_CARD,
    schema: RoutineRunCardSchema,
    Component: ({ item, theme }) => <RoutineRunCard colors={theme.colors} card={item.data} />,
  });
  return () => {
    removeHeaderButtons();
    removeTooltips();
  };
}
