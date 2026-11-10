import { getPaseoClient, usePaseo, useHosts, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { applyAgentUpdate, groupChats, type BotChatLists } from "../shared/chat-lists";
import { paseoToolsState, type PaseoToolsConfig } from "../shared/paseo-tools";
import { botWorkspacesRpc } from "../shared/rpc";
import { createPersistedCache } from "./cache";
import type { PaseoAgent, PaseoApi } from "./paseo";
import { removeItem } from "./storage";

export interface LocalHost {
  id: string;
  label: string;
}

export interface BotHost {
  api: PaseoApi | null;
  /** Stable key for queries; the local host uses its own id. */
  key: string;
  label: string;
  isLocal: boolean;
  online: boolean;
}

type HostSummaries = ReturnType<typeof useHosts>;

function resolveHost(hostId: string | null, local: LocalHost, localApi: PaseoApi, hosts: HostSummaries): BotHost {
  if (!hostId || hostId === local.id) {
    return { api: localApi, key: local.id, label: local.label, isLocal: true, online: true };
  }
  const summary = hosts.find((host) => host.serverId === hostId);
  const label = summary?.label ?? "Unknown host";
  if (summary?.status !== "online") return { api: null, key: hostId, label, isLocal: false, online: false };
  try {
    return { api: getPaseoClient(hostId), key: hostId, label, isLocal: false, online: true };
  } catch {
    return { api: null, key: hostId, label, isLocal: false, online: false };
  }
}

/** Resolves the host a bot runs on. `hostId === null` is the host that stores the bots. */
export function useBotHost(hostId: string | null, local: LocalHost): BotHost {
  const localApi = usePaseo();
  const hosts = useHosts();
  const summary = hostId ? hosts.find((host) => host.serverId === hostId) : undefined;
  const status = summary?.status;
  return useMemo(
    () => resolveHost(hostId, local, localApi, hosts),
    // Only the fields that change the result.
    [hostId, local.id, local.label, localApi, summary?.label, status],
  );
}

/** The same resolution outside render, e.g. for menu actions. */
export function useHostResolver(local: LocalHost): (hostId: string | null) => BotHost {
  const localApi = usePaseo();
  const hosts = useHosts();
  return (hostId) => resolveHost(hostId, local, localApi, hosts);
}

export function useProviders(host: BotHost) {
  return useQuery({
    queryKey: ["paseo-bots", "providers", host.key],
    enabled: !!host.api,
    staleTime: 60_000,
    queryFn: async () => {
      const snapshot = await host.api!.providers.snapshot();
      return snapshot.entries.filter((entry) => entry.enabled);
    },
  });
}

export function useAgentProfiles(host: BotHost) {
  return useQuery({
    queryKey: ["paseo-bots", "profiles", host.key],
    enabled: !!host.api,
    staleTime: 60_000,
    queryFn: async () => (await host.api!.config.get()).config.agentProfiles ?? [],
  });
}

export function useHostWorkspaces(host: BotHost) {
  return useQuery({
    queryKey: ["paseo-bots", "workspaces", host.key],
    enabled: !!host.api,
    staleTime: 30_000,
    queryFn: async () => {
      const result = await host.api!.workspaces.list();
      return result.entries.map((workspace) => ({
        id: workspace.id,
        label: workspace.title || `${workspace.projectDisplayName} · ${workspace.name}`,
        directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
      }));
    },
  });
}

// ------------------------------------------------------------------ bot chats

const NO_CHATS: PaseoAgent[] = [];
const CHAT_LIST_KEY = "paseo-bots";
const chatsKey = (hostKey: string) => [CHAT_LIST_KEY, "chats", hostKey];

type HostChats = BotChatLists<PaseoAgent>;

// Saved per host, so the bots' chats show at once after a restart or on a slow host and refresh behind.
const savedChats = createPersistedCache<HostChats>({ key: "paseo-bots:chat-lists:v2", maxEntries: 8, maxBytes: 1_000_000 });
// The custom chat view's stores, retired with it.
for (const key of ["paseo-bots:chats:v1", "paseo-bots:chat-lists:v1", "@paseo-bots:composer-drafts"]) void removeItem(key);

/** Kept this long after the last screen using them closes (react-query drops unused data after 5 minutes). */
const KEEP_QUERY_MS = 24 * 3_600_000;
/** Paseo's page size for agent lists. */
const AGENT_PAGE = 200;

/** The agent as a saved copy shows it: never mid-turn or waiting on a permission it can't answer. */
function settled(agent: PaseoAgent): PaseoAgent {
  return { ...agent, status: "idle", pendingPermissions: [], activeTurn: null };
}

async function listAgents(api: PaseoApi): Promise<PaseoAgent[]> {
  const agents: PaseoAgent[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 50; pages++) {
    const result = await api.agents.list({ includeBackground: true, page: { limit: AGENT_PAGE, ...(cursor ? { cursor } : {}) } });
    agents.push(...result.entries.map((entry) => entry.agent));
    cursor = result.pageInfo.nextCursor ?? undefined;
    if (!result.pageInfo.hasMore || !cursor) break;
  }
  return agents;
}

/** Every bot's chats on a host, from one list of its agents. */
function useHostChats<T>(host: BotHost, select: (chats: HostChats) => T) {
  const queryClient = useQueryClient();
  const botWorkspaces = useRpc(botWorkspacesRpc);
  const queryKey = chatsKey(host.key);
  // Phones load the saved lists asynchronously; use them if the first fetch hasn't landed.
  useEffect(() => {
    void savedChats.ready.then(() => {
      const saved = savedChats.get(host.key);
      if (saved && !queryClient.getQueryData(queryKey)) queryClient.setQueryData(queryKey, saved, { updatedAt: 0 });
    });
  }, [host.key]);
  return useQuery({
    queryKey,
    enabled: !!host.api,
    // Shown at once if saved, but old: the host is asked as soon as the list mounts.
    initialData: () => savedChats.get(host.key),
    initialDataUpdatedAt: 0,
    gcTime: KEEP_QUERY_MS,
    // The local host pushes agent updates (useChatInvalidation), so its lists stay current; a
    // full read now and then catches anything missed while disconnected. Other hosts are polled.
    staleTime: host.isLocal ? 60_000 : 0,
    refetchInterval: host.isLocal ? false : 15_000,
    queryFn: async (): Promise<HostChats> => {
      // Bot workspaces are known to this host's plugin; on other hosts chats are found by their label.
      const [agents, owned] = await Promise.all([listAgents(host.api!), host.isLocal ? botWorkspaces({}) : null]);
      const chats = groupChats(agents, Object.fromEntries((owned?.workspaces ?? []).map((entry) => [entry.workspaceId, entry.botId])));
      savedChats.set(host.key, { ...chats, byBot: Object.fromEntries(Object.entries(chats.byBot).map(([botId, list]) => [botId, list.map(settled)])) });
      return chats;
    },
    select,
  });
}

/** A bot's live chats, newest first. */
export function useBotChats(host: BotHost, botId: string) {
  return useHostChats(host, useCallback((chats: HostChats) => chats.byBot[botId] ?? NO_CHATS, [botId]));
}

/** One live subscription to agent updates per host connection, however many screens ask for it. */
const watchers = new WeakMap<object, { count: number; stop(): void }>();

function watchAgents(paseo: PaseoApi, hostKey: string, queryClient: ReturnType<typeof useQueryClient>): () => void {
  let watcher = watchers.get(paseo);
  if (!watcher) {
    let closed = false;
    let subscription: { release(): Promise<void> } | null = null;
    const unsubscribe = paseo.agents.subscribe((update) => {
      const current = queryClient.getQueryData<HostChats>(chatsKey(hostKey));
      // Before the first list arrives there's nothing to update: the list will include it.
      if (!current) return;
      const next = applyAgentUpdate(current, update);
      if (next !== current) queryClient.setQueryData(chatsKey(hostKey), next);
    });
    // The daemon only sends agent updates to sessions that subscribed through a list request.
    void paseo.agents
      .list({ page: { limit: 1 }, subscribe: {} })
      .then((result) => {
        if (closed) void result.subscription.release();
        else subscription = result.subscription;
      })
      .catch(() => {});
    watcher = {
      count: 0,
      stop: () => {
        closed = true;
        unsubscribe();
        void subscription?.release();
      },
    };
    watchers.set(paseo, watcher);
  }
  watcher.count++;
  const held = watcher;
  return () => {
    if (--held.count > 0) return;
    held.stop();
    if (watchers.get(paseo) === held) watchers.delete(paseo);
  };
}

/** Keeps the local host's chat lists live: each agent update is applied as it arrives. */
export function useChatInvalidation(local: LocalHost) {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  useEffect(() => watchAgents(paseo, local.id, queryClient), [paseo, local.id, queryClient]);
}

/** Re-reads a host's chats, e.g. after starting one. */
export function refreshChats(queryClient: ReturnType<typeof useQueryClient>, hostKey: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: chatsKey(hostKey) });
}

/** The bot's workspace on a host, as far as the chat lists know: its own, else its newest chat's. */
export function botWorkspaceId(queryClient: ReturnType<typeof useQueryClient>, hostKey: string, botId: string): string | undefined {
  const chats = queryClient.getQueryData<HostChats>(chatsKey(hostKey));
  const owned = Object.entries(chats?.workspaces ?? {}).find(([, owner]) => owner === botId)?.[0];
  return owned ?? chats?.byBot[botId]?.find((chat) => chat.workspaceId)?.workspaceId ?? undefined;
}

/** A chat's whole timeline, oldest first, page by page (a transcript needs all of it). */
export async function fullTimeline(api: PaseoApi, agentId: string) {
  const handle = api.agents.ref(agentId);
  let page = await handle.timeline.refetch({ direction: "tail", projection: "projected", limit: AGENT_PAGE });
  if (page.error) throw new Error(page.error);
  let entries = page.entries;
  for (let pages = 0; pages < 100 && page.hasOlder && page.startCursor; pages++) {
    page = await handle.timeline.refetch({ direction: "before", cursor: page.startCursor, projection: "projected", limit: AGENT_PAGE });
    if (page.error) throw new Error(page.error);
    if (page.entries.length === 0) break;
    entries = [...page.entries, ...entries];
  }
  return entries;
}

/** The host's Paseo-tools settings for a provider, and a way to turn them on. */
export function usePaseoTools(host: BotHost, provider: string) {
  const queryClient = useQueryClient();
  const key = ["paseo-bots", "paseo-tools", host.key];
  const config = useQuery({
    queryKey: key,
    enabled: !!host.api,
    staleTime: 30_000,
    queryFn: async () => (await host.api!.config.get()).config as PaseoToolsConfig,
  });
  const state = config.data ? paseoToolsState(config.data, provider) : null;
  const turnOn = async () => {
    if (!host.api || !state || state.on) return;
    await host.api.config.patch(state.reason === "provider" ? { providers: { [provider]: { paseoTools: { enabled: true } } } } : { mcp: { injectIntoAgents: true } });
    await queryClient.invalidateQueries({ queryKey: key });
  };
  return { state, loading: config.isLoading, turnOn };
}
