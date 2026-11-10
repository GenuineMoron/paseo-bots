import { useRef, useState } from "react";
import { DEFAULT_BOT_LIST_UI, type BotListUi } from "../../shared/bot";
import type { useBotSettings } from "../useBotSettings";

type Settings = Pick<ReturnType<typeof useBotSettings>, "settings" | "latest" | "commit">;

/**
 * The bot list's own state (collapsed groups, pins, order, widths, display options). Changes
 * apply at once and save behind; once saved, the stored document is the source of truth
 * again, so a change made on another device shows up here too.
 */
export function useListUi({ settings, latest, commit }: Settings) {
  const [override, setOverride] = useState<BotListUi | null>(null);
  const pending = useRef<BotListUi | null>(null);

  const current = (): BotListUi =>
    pending.current ?? (latest.current.status === "ready" ? latest.current.values.ui : undefined) ?? DEFAULT_BOT_LIST_UI;

  const update = (mutate: (current: BotListUi) => BotListUi) => {
    const next = mutate(current());
    pending.current = next;
    setOverride(next);
    void commit((values) => ({ ...values, ui: next })).then((saved) => {
      // Only the latest change clears the override; an earlier one finishing must not hide a newer one.
      if (saved && pending.current === next) {
        pending.current = null;
        setOverride(null);
      }
    });
  };

  const stored = settings.status === "ready" ? settings.values.ui : undefined;
  return { listUi: override ?? stored ?? DEFAULT_BOT_LIST_UI, currentUi: current, updateUi: update };
}
