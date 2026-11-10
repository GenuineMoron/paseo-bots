import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { lastTurn, logLine, type TimelineItemLike } from "../shared/activity";
import type { BotsHost } from "./host";
import type { MemoryJournal } from "./journal";
import { appendDailyLog } from "./memory";
import type { RoutineScheduler } from "./scheduler";

// What happens around each turn of a bot's chat: the journal notes memory
// changes, and the daily log gets a line saying what the bot did.

export async function turnStarted(host: BotsHost, journal: MemoryJournal, { agent }: PluginLifecycleEvents["agent.turn_started"]): Promise<void> {
  const botId = await host.botIdOf(agent.id);
  if (botId) await journal.begin(botId);
}

/**
 * The turn that just ended. Paseo stopped sending it with the event (0.13; the event's `timeline`
 * is always empty now), so it's read back from the chat: the newest items, enough for one turn.
 */
async function finishedTurn(host: BotsHost, agentId: string): Promise<{ reply: string; tools: string[] }> {
  const page = await host.paseo?.agents
    .ref(agentId)
    .timeline.refetch({ direction: "tail", projection: "projected", limit: 60 })
    .catch(() => null);
  return lastTurn((page?.entries ?? []).map((entry) => entry.item as TimelineItemLike));
}

export async function turnEnded(host: BotsHost, journal: MemoryJournal, scheduler: Pick<RoutineScheduler, "finished">, { agent, outcome }: PluginLifecycleEvents["agent.turn_ended"]): Promise<void> {
  const chat = await host.chatOf(agent.id);
  if (!chat) return;
  const { botId } = chat;
  const title = chat.title?.trim() || agent.title?.trim() || "Untitled chat";
  const { reply, tools } = await finishedTurn(host, agent.id);
  try {
    await journal.end(botId, { id: agent.id, title });
  } catch (error) {
    // A journal that can't be written must not leave a routine run "running" for hours.
    console.error("paseo-bots: couldn't update the memory journal", error);
  }
  if (chat.routineId) await scheduler.finished(chat.routineId, agent.id, outcome, reply);
  if (outcome.kind === "canceled") return;
  const line = logLine({ at: new Date(), chat: title, reply, tools, failure: outcome.kind === "failed" ? outcome.error.message : null });
  if (line) await appendDailyLog(botId, line);
}
