import { useAgent, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { BOT_LABEL, type Bot, type Library } from "../shared/bot";
import { startBotChat } from "../shared/chat";
import { chatBotRpc, chatNewRpc, ensureBotHomeRpc, systemPromptRpc } from "../shared/rpc";
import { refreshChats, type BotHost } from "./data";
import { errorText } from "./native";

// Bot chats open in Paseo's own chat view: its composer, attachments, images, model picker
// and history work the same as in any other agent's chat.

/** "Set up with the bot": the bot interviews the user and proposes its own instructions and memory. */
export const SETUP_PROMPT =
  "Let's set you up. Interview me one short question at a time about what I want from you, how I like to work, and what you should never do. " +
  "Then propose standing instructions for yourself and a starting MEMORY.md. Write the memory file once I confirm, and give me the instructions to paste into your Soul settings.";

type Navigation = PluginSurfaceProps["navigation"];

/** Opens and starts bot chats from a screen. */
export function useBotChatActions(navigation: Navigation) {
  const newChat = useRpc(chatNewRpc);
  const ensureHome = useRpc(ensureBotHomeRpc);
  const compose = useRpc(systemPromptRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const starting = useRef(new Set<string>());

  const open = (host: BotHost, agentId: string) => {
    if (!navigation) {
      toast.error("This version of Paseo can't open chats from plugins. Update Paseo to open bot chats.");
      return;
    }
    navigation.openAgent({ agentId, ...(host.isLocal ? {} : { serverId: host.key }) });
  };

  /** A chat on this host comes from the plugin, which gives it the bot's tools; elsewhere it's made through that host. */
  const start = async (bot: Bot, host: BotHost, library: Library, prompt?: string): Promise<string> => {
    if (!host.api) throw new Error(`${host.label} is offline.`);
    if (host.isLocal) return (await newChat({ botId: bot.id, ...(prompt ? { prompt } : {}) })).agentId;
    const home = await ensureHome({ botId: bot.id });
    const { systemPrompt } = await compose({ bot, local: false, ...(prompt ? { message: prompt } : {}) });
    return startBotChat(host.api, {
      bot,
      library,
      placement: bot.cwd ? { path: bot.cwd, projectRoot: null } : { path: home.path, projectRoot: home.root },
      systemPrompt,
      ...(prompt ? { prompt } : {}),
    });
  };

  return {
    open,
    /** Starts a chat (with a first message, or empty and waiting) and opens it. A second press while one starts does nothing. */
    async startAndOpen(bot: Bot, host: BotHost, library: Library, prompt?: string): Promise<void> {
      if (starting.current.has(bot.id)) return;
      starting.current.add(bot.id);
      try {
        const agentId = await start(bot, host, library, prompt);
        void refreshChats(queryClient, host.key);
        open(host, agentId);
      } catch (error) {
        toast.error(`Couldn't start a chat with ${bot.name || "the bot"}: ${errorText(error)}`);
      } finally {
        starting.current.delete(bot.id);
      }
    },
  };
}

/**
 * The bot a chat belongs to, for cards in Paseo's chat view: its label, else the plugin's
 * answer (a chat started with Paseo's New agent in a bot's folder has no label).
 */
export function useChatBot(agentId: string): string | null {
  const labelled = useAgent(agentId, (agent) => agent.labels[BOT_LABEL] ?? null);
  const chatBot = useRpc(chatBotRpc);
  const asked = useQuery({
    queryKey: ["paseo-bots", "chat-bot", agentId],
    enabled: !labelled,
    staleTime: Infinity,
    queryFn: async () => (await chatBot({ agentId })).botId,
  });
  return labelled ?? asked.data ?? null;
}
