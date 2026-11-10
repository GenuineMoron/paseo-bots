import { useEffect, useRef, useState } from "react";
import { pushHistory, type Bot } from "../../shared/bot";
import type { useBotSettings } from "../useBotSettings";

/** Autosave delay after the last edit in the settings panel. */
const SAVE_DELAY_MS = 600;

type Settings = Pick<ReturnType<typeof useBotSettings>, "latest" | "commit">;

/**
 * Edits made in a bot's settings panel. They show at once as drafts, and save behind a short
 * delay (and when the screen closes) as one write that also records the bot's previous version.
 */
export function useBotDrafts({ latest, commit }: Settings) {
  const [drafts, setDrafts] = useState<Record<string, Bot>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async (): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = draftsRef.current;
    if (Object.keys(pending).length === 0) return;
    const ok = await commitRef.current((values) => {
      let history = values.history;
      const bots = values.bots.map((bot) => {
        const draft = pending[bot.id];
        if (!draft) return bot;
        history = pushHistory(history, bot);
        return draft;
      });
      return { ...values, bots, history };
    });
    if (!ok) return;
    setDrafts((current) => {
      const next = { ...current };
      // An edit made while the save ran is a newer draft and stays.
      for (const [id, bot] of Object.entries(pending)) if (next[id] === bot) delete next[id];
      return next;
    });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** Edits a bot's draft; saved after a pause. */
  const patchBot = (botId: string, patch: Partial<Bot>) => {
    setDrafts((current) => {
      const base = current[botId] ?? (latest.current.status === "ready" ? latest.current.values.bots.find((bot) => bot.id === botId) : undefined);
      return base ? { ...current, [botId]: { ...base, ...patch, updatedAt: new Date().toISOString() } } : current;
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  };

  /** Applies a patch to the saved bot and to any unsaved draft of it, so autosave can't undo it. */
  const updateBot = (botId: string, patch: Partial<Bot>, recordHistory = false): Promise<boolean> => {
    setDrafts((current) => (current[botId] ? { ...current, [botId]: { ...current[botId], ...patch } } : current));
    return commit((values) => {
      const previous = values.bots.find((entry) => entry.id === botId);
      if (!previous) return values;
      return {
        ...values,
        bots: values.bots.map((entry) => (entry.id === botId ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry)),
        history: recordHistory ? pushHistory(values.history, previous) : values.history,
      };
    });
  };

  // Save pending edits when the screen closes.
  useEffect(() => () => void flushRef.current(), []);

  return { drafts, patchBot, updateBot, flush };
}
