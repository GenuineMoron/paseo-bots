import { realpath } from "node:fs/promises";
import { APPS_MCP_NAME } from "../shared/apps";
import { applyBotSetup, BOT_LABEL, type Bot, type BotSessionConfig, type McpServerConfig } from "../shared/bot";
import { TOOLS_MCP_NAME } from "../shared/bot-tools";
import { NEW_CHAT_LABEL, startBotChat } from "../shared/chat";
import { newUuid } from "../shared/uuid";
import { botDataPath, ensureBotHome } from "./bot-home";
import type { BotsHost } from "./host";
import { systemPrompt } from "./prompt";
import type { PaseoAgent } from "./paseo";
import type { Relay } from "./relay";

/** How long a bot's resolved folder is trusted before it's looked up again. */
const FOLDER_CACHE_MS = 10_000;
/** Bot names are saved as they're typed; workspaces are renamed once the typing stops. */
const RENAME_DELAY_MS = 2_000;

export interface StartInput {
  /** The first message. Without one the chat opens empty, waiting for the person. */
  prompt?: string;
  title?: string;
  labels?: Record<string, string>;
}

/**
 * Bot chats are ordinary Paseo agents in the bot's workspace, shown in Paseo's own chat view.
 * This decides which bot a chat belongs to and gives it the bot's setup, whichever way the chat
 * was started: the Bots screen or sidebar, a routine, another bot, or Paseo's New agent.
 *
 * A chat belongs to the bot named by its label, or else to the bot whose own folder it runs in.
 * Only folders the plugin manages count: a bot given a working folder of yours shares it with
 * your other agents, so only the chats the plugin starts there (labelled) are the bot's.
 */
export class BotChats {
  private folders: { at: number; byPath: Map<string, Bot> } | null = null;
  private renameTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: BotsHost,
    private readonly relay: Relay,
  ) {}

  /** Each live bot's managed folder, under its own path and its real one (a bot folder can be a link). */
  private async folderIndex(): Promise<Map<string, Bot>> {
    if (this.folders && Date.now() - this.folders.at < FOLDER_CACHE_MS) return this.folders.byPath;
    const byPath = new Map<string, Bot>();
    for (const bot of await this.host.bots()) {
      if (bot.archived || bot.hostId || bot.cwd) continue;
      const path = trimSlash(botDataPath(bot.id));
      byPath.set(path, bot);
      const real = await realpath(path).catch(() => null);
      if (real) byPath.set(trimSlash(real), bot);
    }
    this.folders = { at: Date.now(), byPath };
    return byPath;
  }

  /** The bot whose folder `cwd` is. Only the folder itself counts, never a folder inside it. */
  async botForFolder(cwd: string): Promise<Bot | null> {
    const index = await this.folderIndex();
    const exact = index.get(trimSlash(cwd));
    if (exact) return exact;
    const real = await realpath(cwd).catch(() => null);
    return real ? (index.get(trimSlash(real)) ?? null) : null;
  }

  /** The bots changed: forget their folders, and keep each bot's workspace named after it. */
  botsChanged(): void {
    this.folders = null;
    if (this.renameTimer) clearTimeout(this.renameTimer);
    this.renameTimer = setTimeout(() => {
      this.renameTimer = null;
      void this.renameWorkspaces().catch((error: unknown) => console.error("paseo-bots: couldn't rename a bot's workspace", error));
    }, RENAME_DELAY_MS);
  }

  stop(): void {
    if (this.renameTimer) clearTimeout(this.renameTimer);
    this.renameTimer = null;
  }

  private async renameWorkspaces(): Promise<void> {
    if (!this.host.paseo) return;
    for (const { workspaceId, title, bot } of await this.workspaces()) {
      if (bot.name.trim() && title !== bot.name) await this.host.paseo.workspaces.ref(workspaceId).setTitle(bot.name);
    }
  }

  /** This host's bot workspaces: the ones whose folder is a bot's own. */
  async workspaces(): Promise<{ workspaceId: string; title: string | null; bot: Bot }[]> {
    const { entries } = await this.host.requirePaseo().workspaces.list();
    const found: { workspaceId: string; title: string | null; bot: Bot }[] = [];
    for (const workspace of entries) {
      const folder = workspace.workspaceDirectory ?? workspace.projectRootPath;
      const bot = folder ? await this.botForFolder(folder) : null;
      if (bot) found.push({ workspaceId: workspace.id, title: workspace.title ?? null, bot });
    }
    return found;
  }

  /**
   * A bot's chats, newest first: the ones labelled with it, and the ones started in its folder
   * with Paseo's New agent, which carry no label (among the host's newest `limit` agents).
   */
  async chatsOf(bot: Bot, options: { includeArchived: boolean; limit: number }): Promise<PaseoAgent[]> {
    const paseo = this.host.requirePaseo();
    const list = async (labels?: Record<string, string>) =>
      (
        await paseo.agents.list({
          filter: { ...(labels ? { labels } : {}), includeArchived: options.includeArchived },
          includeBackground: true,
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: options.limit },
        })
      ).entries.map((entry) => entry.agent);
    const workspaceIds = new Set((await this.workspaces()).filter((entry) => entry.bot.id === bot.id).map((entry) => entry.workspaceId));
    const [labelled, recent] = await Promise.all([list({ [BOT_LABEL]: bot.id }), workspaceIds.size ? list() : []]);
    const unlabelled = recent.filter((agent) => !agent.labels[BOT_LABEL] && !!agent.workspaceId && workspaceIds.has(agent.workspaceId));
    return [...labelled, ...unlabelled].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, options.limit);
  }

  /** `agent.create`: a new agent in a bot's folder becomes that bot's chat. */
  async onCreate<Config extends BotSessionConfig>(config: Config): Promise<Config | null> {
    const bot = await this.botForFolder(config.cwd);
    if (!bot) return null;
    const library = await this.host.library();
    // A chat the plugin started already carries the bot's prompt; one from Paseo's New agent gets it here.
    const prompt = config.systemPrompt === undefined ? (await systemPrompt({ bot, local: true }, library, this.host.paseo, await this.host.values())).systemPrompt : "";
    return applyBotSetup(bot, library, config, prompt);
  }

  /**
   * `agent.session_open`: the plugin's tools and connected apps for a bot chat started outside
   * the plugin, such as with Paseo's New agent in the bot's folder, each time its session opens.
   * Chats the plugin starts (labelled) have them in their saved setup, where their quiet tools can
   * be pre-approved, and Paseo refuses a chat whose session adds a server its setup already has.
   */
  async sessionServers(chat: { agentId: string; cwd: string; labels: Readonly<Record<string, string>> }): Promise<Record<string, McpServerConfig> | null> {
    if (chat.labels[BOT_LABEL]) return null;
    const bot = await this.botForFolder(chat.cwd);
    return bot ? this.pluginServers(bot, chat.agentId) : null;
  }

  private async pluginServers(bot: Bot, agentId: string): Promise<Record<string, McpServerConfig>> {
    const servers: Record<string, McpServerConfig> = {};
    if (bot.botTools) servers[TOOLS_MCP_NAME] = await this.relay.mountTools(bot.id, agentId);
    if (bot.apps.length > 0) {
      const apps = await this.relay.mountApps(bot.id);
      if (apps) servers[APPS_MCP_NAME] = apps;
    }
    return servers;
  }

  /**
   * "New chat": the bot's untouched new chat if it has one (opened and left without a message),
   * else a fresh one. Paseo's own New agent makes nothing until the first message; this keeps
   * the chat list from filling with empty chats the same way.
   */
  async newChat(bot: Bot): Promise<string> {
    const { entries } = await this.host.requirePaseo().agents.list({ filter: { labels: { [BOT_LABEL]: bot.id, [NEW_CHAT_LABEL]: "1" } }, page: { limit: 20 } });
    const untouched = entries.find(({ agent }) => !agent.lastUserMessageAt && !agent.archivedAt && agent.status !== "running");
    return untouched?.agent.id ?? this.start(bot, { labels: { [NEW_CHAT_LABEL]: "1" } });
  }

  /**
   * Starts a chat with a bot on this host and returns its id. With a prompt it starts working at
   * once (routines, another bot asking); without one it waits for the person in Paseo's chat view.
   */
  async start(bot: Bot, input: StartInput = {}): Promise<string> {
    const paseo = this.host.requirePaseo();
    if (bot.hostId) throw new Error(`${bot.name} runs on another host, so its chats can't be started from here.`);
    const library = await this.host.library();
    const home = await ensureBotHome({ botId: bot.id });
    const { systemPrompt: system } = await systemPrompt({ bot, local: true, ...(input.prompt ? { message: input.prompt } : {}) }, library, paseo, await this.host.values());
    // Picked ahead so the plugin's tools can name the chat, and their quiet tools be pre-approved.
    const agentId = newUuid();
    return startBotChat(paseo, {
      bot,
      library,
      agentId,
      plugin: await this.pluginServers(bot, agentId).then((servers) => ({ tools: servers[TOOLS_MCP_NAME] ?? null, apps: servers[APPS_MCP_NAME] ?? null })),
      placement: bot.cwd ? { path: bot.cwd, projectRoot: null } : { path: home.path, projectRoot: home.root },
      ...(input.prompt ? { prompt: input.prompt } : {}),
      systemPrompt: system,
      ...(input.title ? { title: input.title } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
    });
  }
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
