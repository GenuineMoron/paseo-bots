/** Where the Bots screen is, as far as "back" is concerned. */
export interface BackState {
  libraryOpen: boolean;
  /** The open Skills & Tools page, null on its list. */
  libraryPage: boolean;
  panelOpen: boolean;
  /** The open settings page, null on the settings list. */
  panelSection: boolean;
  compact: boolean;
  teamMapOpen: boolean;
}

export type BackStep = "library-list" | "close-library" | "settings-list" | "close-settings" | "close-team-map";

/**
 * One step back through the Bots screen, as Paseo's own screens go back: a Skills & Tools
 * page to its list, then out of it; a settings page to the settings list, then out of the
 * settings; and on phones the team map back to the bot list. Null when there is
 * nothing left to step back from, so Back leaves the plugin.
 */
export function backStep(state: BackState): BackStep | null {
  if (state.libraryOpen) return state.compact && state.libraryPage ? "library-list" : "close-library";
  if (state.panelOpen) return state.panelSection ? "settings-list" : "close-settings";
  if (!state.compact) return null;
  return state.teamMapOpen ? "close-team-map" : null;
}
