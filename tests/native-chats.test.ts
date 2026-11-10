import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BotChats } from "../server/bot-chats";
import { botDataPath } from "../server/bot-home";
import type { Relay } from "../server/relay";
import { lastTurn } from "../shared/activity";
import { appSignIns } from "../shared/apps";
import { applyBotSetup, BOT_LABEL, EMPTY_LIBRARY, type BotSessionConfig, type Library } from "../shared/bot";
import { applyAgentUpdate, groupChats } from "../shared/chat-lists";
import { NEW_CHAT_LABEL } from "../shared/chat";
import { proposalIdOf } from "../shared/proposals";
import { serverToolName, toolCallName } from "../shared/tool-name";
import { fakeHost, makeBot, NOW } from "./helpers";

// Bot chats are Paseo agents shown in Paseo's own chat view; these cover how the plugin
// recognises them, sets them up, keeps their lists, and reads ACP providers' tool calls.

describe("tool calls from ACP providers", () => {
  // Paseo names an ACP tool call by its kind ("other") and keeps the real tool in the title.
  const acp = (title: string, extra: Record<string, unknown> = {}) => ({ name: "other", metadata: { kind: "other", title }, ...extra });

  it("reads the real tool from the title Paseo keeps", () => {
    expect(toolCallName(acp("mcp__bots__propose_skill: Invoices"))).toBe("mcp__bots__propose_skill");
    expect(toolCallName({ name: "Read file", metadata: { title: "Read file" } })).toBe("Read file");
    expect(toolCallName({ name: "mcp__bots__ask_bot", metadata: { kind: "other", title: "anything" } })).toBe("mcp__bots__ask_bot");
    expect(toolCallName({ name: "shell" })).toBe("shell");
  });

  it("matches a server's tools whatever the provider calls them", () => {
    for (const name of ["mcp__bots__ask_bot", "bots.ask_bot", "bots_ask_bot", "bots / ask_bot"]) expect(serverToolName(name, "bots"), name).toBe("ask_bot");
    expect(serverToolName("mcp__other__ask_bot", "bots")).toBeNull();
    expect(serverToolName("mcp__composio__COMPOSIO_MANAGE_CONNECTIONS", "composio")).toBe("COMPOSIO_MANAGE_CONNECTIONS");
  });

  it("finds proposals and sign-ins in Hermes chats", () => {
    const output = "Proposal p-0123456789: the user sees a card";
    expect(proposalIdOf({ ...acp("mcp__bots__propose_skill: Invoices"), status: "completed", detail: { type: "unknown", input: {}, output } })).toBe("p-0123456789");
    const results = { data: { results: { notion: { redirect_url: "https://connect.composio.dev/x", accounts: [{ id: "ca_1", alias: "work" }] } } } };
    const call = { ...acp("mcp__composio__COMPOSIO_MANAGE_CONNECTIONS"), status: "completed", detail: { type: "unknown", input: {}, output: results } };
    expect(appSignIns(call)).toHaveLength(1);
  });

  it("logs the tools a turn used by their real names", () => {
    const turn = lastTurn([
      { type: "user_message", text: "hi" },
      { type: "tool_call", name: "other", metadata: { kind: "other", title: "mcp__bots__search_chats: invoices" } },
      { type: "assistant_message", text: "Found two." },
    ]);
    expect(turn).toEqual({ reply: "Found two.", tools: ["bots/search_chats"] });
  });
});

describe("the bots' chat lists", () => {
  const chat = (id: string, patch: Record<string, unknown> = {}) => ({ id, labels: {}, workspaceId: null, archivedAt: null, updatedAt: NOW, ...patch });
  const workspaces = { "wks-personal": "personal" };

  it("sorts chats into bots by label, else by the bot workspace they run in", () => {
    const lists = groupChats(
      [
        chat("labelled", { labels: { [BOT_LABEL]: "work" } }),
        chat("native", { workspaceId: "wks-personal", updatedAt: "2026-09-28T00:00:00.000Z" }),
        chat("older", { workspaceId: "wks-personal" }),
        chat("coding", { workspaceId: "wks-elsewhere" }),
        chat("archived", { labels: { [BOT_LABEL]: "work" }, archivedAt: NOW }),
      ],
      workspaces,
    );
    expect(Object.fromEntries(Object.entries(lists.byBot).map(([bot, list]) => [bot, list.map((entry) => entry.id)]))).toEqual({ work: ["labelled"], personal: ["native", "older"] });
  });

  it("applies agent updates in place and ignores other agents", () => {
    const lists = groupChats([chat("a", { workspaceId: "wks-personal" })], workspaces);
    expect(applyAgentUpdate(lists, { kind: "upsert", agent: chat("coding") })).toBe(lists);
    const added = applyAgentUpdate(lists, { kind: "upsert", agent: chat("b", { workspaceId: "wks-personal", updatedAt: "2026-09-29T00:00:00.000Z" }) });
    expect(added.byBot.personal!.map((entry) => entry.id)).toEqual(["b", "a"]);
    const archived = applyAgentUpdate(added, { kind: "upsert", agent: chat("b", { workspaceId: "wks-personal", archivedAt: NOW }) });
    expect(archived.byBot.personal!.map((entry) => entry.id)).toEqual(["a"]);
    expect(applyAgentUpdate(archived, { kind: "remove", agentId: "a" }).byBot.personal).toBeUndefined();
  });
});

describe("a bot's setup on any new chat in its folder", () => {
  const library: Library = { ...EMPTY_LIBRARY, mcpServers: [{ id: "s1", name: "files", description: "", enabled: true, config: { type: "stdio", command: "files-mcp", args: [], env: {} }, tools: null, checkedAt: null, checkError: null, createdAt: NOW, updatedAt: NOW }] };

  it("uses the bot's provider and keeps what was picked for it", () => {
    const bot = makeBot({ provider: "claude", model: "opus", modeId: "default", mcpServerIds: ["s1"], alwaysAllow: ["files/read"] });
    const fromPaseo: BotSessionConfig = { provider: "claude", cwd: "/b", model: "sonnet" };
    const picked = applyBotSetup(bot, library, fromPaseo, "You are Inbox.");
    expect(picked).toMatchObject({ provider: "claude", model: "sonnet", modeId: "default", systemPrompt: "You are Inbox." });
    expect(Object.keys(picked.mcpServers ?? {})).toEqual(["files"]);
    expect(picked.toolPolicy?.preapproved).toEqual([{ kind: "mcp", server: "files", tool: "read" }]);
    // Another provider's model means nothing to the bot's provider; the bot's own is used.
    expect(applyBotSetup(bot, library, { provider: "codex", cwd: "/b", model: "gpt" }, "")).toMatchObject({ provider: "claude", model: "opus" });
    // A prompt the chat was started with is kept.
    expect(applyBotSetup(bot, library, { provider: "claude", cwd: "/b", systemPrompt: "Given" }, "Other").systemPrompt).toBe("Given");
  });
});

describe("recognising bot chats", () => {
  let home: string;
  let elsewhere: string;
  const relay = {
    mountTools: async (botId: string, agentId: string) => ({ type: "http" as const, url: `http://127.0.0.1:1/bots/${botId}/${agentId}`, headers: {} }),
    mountApps: async () => null,
  } as unknown as Relay;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "pb-native-"));
    elsewhere = await mkdtemp(join(tmpdir(), "pb-hermes-"));
    vi.stubEnv("PASEO_HOME", home);
    await mkdir(botDataPath("plain"), { recursive: true });
    // A Hermes bot's folder is a link to its Hermes workspace.
    await symlink(elsewhere, botDataPath("hermes"), "dir");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  const setup = () => {
    const bots = [
      makeBot({ id: "plain", name: "Plain" }),
      makeBot({ id: "hermes", name: "Personal", provider: "hermes-personal", botTools: false }),
      makeBot({ id: "custom", name: "Custom", cwd: "/home/me/project" }),
      makeBot({ id: "old", name: "Old", archived: true }),
    ];
    const host = fakeHost(bots);
    const chats = new BotChats(host, relay);
    host.useChats(chats);
    return { host, chats };
  };

  it("matches a bot's own folder, through a link too, and nothing inside or shared", async () => {
    const { chats } = setup();
    expect((await chats.botForFolder(botDataPath("plain")))?.id).toBe("plain");
    expect((await chats.botForFolder(`${botDataPath("plain")}/`))?.id).toBe("plain");
    expect((await chats.botForFolder(elsewhere))?.id).toBe("hermes");
    expect(await chats.botForFolder(join(botDataPath("plain"), "memory"))).toBeNull();
    // A folder of the user's is shared with their other agents, so only labelled chats there are the bot's.
    expect(await chats.botForFolder("/home/me/project")).toBeNull();
    expect(await chats.botForFolder(botDataPath("old"))).toBeNull();
  });

  it("sets up a new agent in a bot's folder and leaves others alone", async () => {
    const { chats } = setup();
    expect(await chats.onCreate({ provider: "claude", cwd: "/home/me/project" })).toBeNull();
    const config = await chats.onCreate({ provider: "codex", cwd: elsewhere, systemPrompt: "Started by the plugin" });
    expect(config).toMatchObject({ provider: "hermes-personal", systemPrompt: "Started by the plugin" });
  });

  it("adds the plugin's tools to chats started outside it, for bots that use them", async () => {
    const { chats } = setup();
    expect(Object.keys((await chats.sessionServers({ agentId: "a1", cwd: botDataPath("plain"), labels: {} })) ?? {})).toEqual(["bots"]);
    expect(await chats.sessionServers({ agentId: "a2", cwd: elsewhere, labels: {} })).toEqual({});
    expect(await chats.sessionServers({ agentId: "a3", cwd: "/tmp", labels: {} })).toBeNull();
    // The plugin's own chats carry them in their saved setup; Paseo refuses the same server twice.
    expect(await chats.sessionServers({ agentId: "a4", cwd: botDataPath("plain"), labels: { [BOT_LABEL]: "plain" } })).toBeNull();
  });

  it("finds bot workspaces and the bot of an unlabelled chat", async () => {
    const { host, chats } = setup();
    const agents = [
      { id: "labelled", labels: { [BOT_LABEL]: "hermes" }, workspaceId: "w-hermes", updatedAt: NOW, archivedAt: null },
      { id: "native", labels: {}, workspaceId: "w-hermes", updatedAt: "2026-09-28T00:00:00.000Z", archivedAt: null },
      { id: "coding", labels: {}, workspaceId: "w-code", updatedAt: NOW, archivedAt: null },
    ];
    host.attach({
      workspaces: {
        list: async () => ({
          entries: [
            { id: "w-plain", workspaceDirectory: botDataPath("plain"), projectRootPath: home, title: "Plain" },
            { id: "w-hermes", workspaceDirectory: botDataPath("hermes"), projectRootPath: home, title: "Personal" },
            { id: "w-code", workspaceDirectory: "/home/me/project", projectRootPath: "/home/me/project", title: "project" },
          ],
        }),
      },
      agents: {
        list: async (options: { filter?: { labels?: Record<string, string> } }) => ({
          entries: agents.filter((agent) => Object.entries(options.filter?.labels ?? {}).every(([key, value]) => (agent.labels as Record<string, string>)[key] === value)).map((agent) => ({ agent })),
        }),
      },
    } as never);
    expect((await chats.workspaces()).map((entry) => [entry.workspaceId, entry.bot.id])).toEqual([
      ["w-plain", "plain"],
      ["w-hermes", "hermes"],
    ]);
    const hermes = (await host.bot("hermes"))!;
    expect((await chats.chatsOf(hermes, { includeArchived: false, limit: 10 })).map((agent) => agent.id)).toEqual(["native", "labelled"]);
  });

  it("reuses the bot's untouched new chat instead of making another", async () => {
    const { host, chats } = setup();
    const listed: { agent: Record<string, unknown> }[] = [];
    host.attach({ agents: { list: async () => ({ entries: listed }) } } as never);
    const start = vi.spyOn(chats, "start").mockResolvedValue("fresh");
    const plain = (await host.bot("plain"))!;
    expect(await chats.newChat(plain)).toBe("fresh");
    expect(start).toHaveBeenCalledWith(plain, { labels: { [NEW_CHAT_LABEL]: "1" } });
    listed.push({ agent: { id: "used", lastUserMessageAt: NOW, archivedAt: null, status: "idle" } }, { agent: { id: "untouched", lastUserMessageAt: null, archivedAt: null, status: "idle" } });
    expect(await chats.newChat(plain)).toBe("untouched");
    expect(start).toHaveBeenCalledTimes(1);
  });
});
