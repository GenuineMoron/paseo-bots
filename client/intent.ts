// Command Center items can open the surface but can't pass it arguments.
// They leave an intent here; the surface consumes it when it mounts.

export type BotAction = "settings" | "rename" | "export" | "delete";
export type SurfaceIntent = { kind: "new-bot" } | { kind: "bot-action"; hostId: string; botId: string; action: BotAction };

let pending: SurfaceIntent | null = null;
const listeners = new Set<() => void>();

export function requestIntent(intent: SurfaceIntent): void {
  pending = intent;
  for (const listener of listeners) listener();
}

export function peekIntent(): SurfaceIntent | null {
  return pending;
}

/** Active screens receive actions too; queued actions survive a route/host switch. */
export function onIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function takeIntent(): SurfaceIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
