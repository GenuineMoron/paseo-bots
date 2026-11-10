import { BOT_LABEL } from "./bot";

// The bots' chat lists in the app: one list of a host's agents, sorted into bots, then kept
// current from Paseo's agent updates instead of being fetched again on every change.

export interface ListedChat {
  id: string;
  labels: Record<string, string>;
  workspaceId?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
  updatedAt: string;
}

/** Each bot's live chats, newest first, and which bot each of the host's bot workspaces belongs to. */
export interface BotChatLists<Chat extends ListedChat> {
  byBot: Record<string, Chat[]>;
  /** Workspace id → bot id. A chat started with Paseo's New agent there carries no bot label. */
  workspaces: Record<string, string>;
}

/** The bot a chat belongs to: its label, else its bot workspace. Archived and internal agents are no one's. */
export function chatOwner(chat: ListedChat, workspaces: Readonly<Record<string, string>>): string | null {
  if (chat.archivedAt || chat.internal) return null;
  return chat.labels[BOT_LABEL] ?? (chat.workspaceId ? (workspaces[chat.workspaceId] ?? null) : null);
}

const newestFirst = (a: ListedChat, b: ListedChat) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export function groupChats<Chat extends ListedChat>(chats: readonly Chat[], workspaces: Record<string, string>): BotChatLists<Chat> {
  const byBot: Record<string, Chat[]> = {};
  for (const chat of chats) {
    const botId = chatOwner(chat, workspaces);
    if (botId) (byBot[botId] ??= []).push(chat);
  }
  for (const list of Object.values(byBot)) list.sort(newestFirst);
  return { byBot, workspaces };
}

export type AgentUpdate<Chat> = { kind: "upsert"; agent: Chat } | { kind: "remove"; agentId: string } | { kind: string };

/** Applies one of Paseo's agent updates; the same object back when it isn't about a bot chat. */
export function applyAgentUpdate<Chat extends ListedChat>(current: BotChatLists<Chat>, update: AgentUpdate<Chat>): BotChatLists<Chat> {
  const upserted = update.kind === "upsert" && "agent" in update ? update.agent : null;
  const id = upserted?.id ?? (update.kind === "remove" && "agentId" in update ? update.agentId : null);
  if (!id) return current;
  const owner = upserted ? chatOwner(upserted, current.workspaces) : null;
  const holder = Object.keys(current.byBot).find((botId) => current.byBot[botId]!.some((chat) => chat.id === id));
  if (!owner && !holder) return current;
  const byBot = { ...current.byBot };
  if (holder) {
    const rest = byBot[holder]!.filter((chat) => chat.id !== id);
    if (rest.length) byBot[holder] = rest;
    else delete byBot[holder];
  }
  if (owner && upserted) byBot[owner] = [...(byBot[owner] ?? []), upserted].sort(newestFirst);
  return { ...current, byBot };
}
