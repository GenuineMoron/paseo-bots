import { useEffect } from "react";
import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
const dom = globalThis as unknown as {
  addEventListener?: (type: "keydown", listener: (event: { key: string; stopPropagation(): void }) => void, capture?: boolean) => void;
  removeEventListener?: (type: "keydown", listener: (event: { key: string; stopPropagation(): void }) => void, capture?: boolean) => void;
};

/**
 * Closes an overlay on Escape (web and desktop). Capture phase: Paseo's own shortcut handling
 * would otherwise swallow the key first.
 */
export function useEscapeToClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open || Platform.OS !== "web" || !dom.addEventListener) return;
    const onKey = (event: { key: string; stopPropagation(): void }) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener?.("keydown", onKey, true);
  }, [open, close]);
}
