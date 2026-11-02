import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { BOT_LABEL } from "../shared/bot";
import type { ChatConfig } from "../shared/chat-config";

export function assertConfigurableBotChat(agent: PaseoAgent | null | undefined, botId: string): asserts agent is PaseoAgent {
  if (!agent || agent.labels[BOT_LABEL] !== botId) throw new Error("This session does not belong to the selected bot.");
  if (agent.archivedAt) throw new Error("This chat is archived.");
  if (agent.status === "running" || agent.status === "initializing") throw new Error("Wait for the current turn to finish before changing chat settings.");
}

export function daemonLoopbackUrl(listen: unknown): string {
  if (typeof listen !== "string") throw new Error("Paseo's local endpoint is unavailable.");
  const url = new URL(`ws://${listen}/ws`);
  // Local credentials never leave the machine, even if published metadata is changed.
  if (!["127.0.0.1", "localhost", "[::1]", "0.0.0.0", "[::]"].includes(url.hostname)) throw new Error("Chat settings require a local Paseo endpoint.");
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1";
  return url.toString();
}

export function agentConfigPatch(config: ChatConfig): Parameters<DaemonClient["applyAgentConfig"]>[1] {
  const { model, ...rest } = config;
  return { ...rest, ...(Object.prototype.hasOwnProperty.call(config, "model") ? { modelId: model } : {}) };
}

/** Isolated compatibility bridge to the same config request used by Paseo's composer.
 * No extra connection is opened by client/UI code. Close the backend connection after each change.
 */
export async function configureBotChat(api: PaseoApi, input: { botId: string; agentId: string; config: ChatConfig }) {
  const current = await api.agents.ref(input.agentId).refresh();
  assertConfigurableBotChat(current?.agent, input.botId);
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const metadata = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")) as { listen?: unknown };
  const client = new DaemonClient({
    url: daemonLoopbackUrl(metadata.listen),
    clientId: `bots-chat-config-${randomUUID()}`,
    clientType: "cli",
    appVersion: "0.12.0",
    localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
    reconnect: { enabled: false },
    connectTimeoutMs: 10_000,
  });
  try {
    await client.connect();
    const notice = await client.applyAgentConfig(input.agentId, agentConfigPatch(input.config));
    if (notice?.type === "error") throw new Error(notice.message);
    return { notice: notice?.message ?? null };
  } finally {
    await client.close();
  }
}
