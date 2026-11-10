import { createContext, useCallback, useContext } from "react";
import type { LibraryKind } from "../shared/library";

// Skills & Tools lives inside the Bots screen. A bot's settings and the bot list ask for it
// here, optionally for one item, and the Bots screen they belong to switches to it.
//
// Paseo can keep more than one Bots screen mounted (one per bot, plus the full surface), so
// a request names the screen that made it: its scope. Without that, every mounted screen
// would open Skills & Tools at once and they would stack on top of each other.

/** The library item to show: a skill, an MCP server, a connected app (by slug), or the app catalog. */
export type LibraryTarget = { kind: LibraryKind | "app"; id: string } | { kind: "apps" };

type Listener = (target: LibraryTarget | null) => void;
const listeners = new Map<string, Set<Listener>>();

/** Identifies one mounted Bots screen: a bot's id for its own screen, "all" for the full surface. */
export const ScreenScope = createContext<string>("all");

export function openLibrary(scope: string, target: LibraryTarget | null = null): void {
  for (const listener of listeners.get(scope) ?? []) listener(target);
}

export function onLibraryTarget(scope: string, listener: Listener): () => void {
  const set = listeners.get(scope) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(scope, set);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(scope) === set) listeners.delete(scope);
  };
}

/** Opens Skills & Tools in the screen this component is part of. */
export function useOpenLibrary(): (target?: LibraryTarget | null) => void {
  const scope = useContext(ScreenScope);
  return useCallback((target = null) => openLibrary(scope, target), [scope]);
}
