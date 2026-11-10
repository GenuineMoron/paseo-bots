import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import type { Bot } from "../shared/bot";
import { applyStoredOrdering, moveKeyTo } from "../shared/sidebar";

export interface BotDragHandle {
  props?: Record<string, unknown>;
  isDragging: boolean;
  canPress(): boolean;
}

interface Props {
  bots: Bot[];
  onReorder(source: string, target: string): Promise<boolean>;
  renderBot(bot: Bot, drag: BotDragHandle): ReactNode;
}

/** A press that moves this far becomes a drag (Paseo's DraggableList uses the same distance). */
const DRAG_DISTANCE = 6;
/** Presses right after a drag are the drag's release, not a tap on the row. */
const PRESS_AFTER_DRAG_MS = 150;

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface PointerLike {
  clientY: number;
  button?: number;
  pointerType?: string;
}
const dom = globalThis as unknown as {
  addEventListener(type: string, listener: (event: PointerLike) => void): void;
  removeEventListener(type: string, listener: (event: PointerLike) => void): void;
};

/**
 * The sidebar's bots, reordered by dragging a row with the mouse on web. Phones and touch use
 * Move up / Move down in the bot's menu. No library: Paseo installs Git plugins without their
 * npm dependencies.
 */
export function BotSortableList(props: Props) {
  if (Platform.OS !== "web") return <>{props.bots.map((bot) => <View key={bot.id}>{props.renderBot(bot, { isDragging: false, canPress: () => true })}</View>)}</>;
  return <WebBotSortableList {...props} />;
}

interface Drag {
  id: string;
  /** The order when the drag started. */
  ids: string[];
  startY: number;
  rowHeight: number;
  /** Where the row would land now; null until the press has moved far enough to be a drag. */
  index: number | null;
}

function WebBotSortableList({ bots, onReorder, renderBot }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const heights = useRef(new Map<string, number>());
  const endedAt = useRef(0);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const canPress = () => Date.now() - endedAt.current > PRESS_AFTER_DRAG_MS;

  const ordered = applyStoredOrdering(bots, pending ?? [], (bot) => bot.id);
  const ids = ordered.map((bot) => bot.id);
  // While dragging, the list shows the row where it would land.
  const preview = drag?.index != null ? moveTo(drag.ids, drag.id, drag.index) : ids;
  const items = applyStoredOrdering(ordered, preview, (bot) => bot.id);

  const begin = (id: string, event: PointerLike) => {
    if (event.button !== 0 || event.pointerType === "touch" || ids.length < 2 || pending) return;
    stop.current();
    let current: Drag = { id, ids, startY: event.clientY, rowHeight: heights.current.get(id) ?? 44, index: null };
    const move = (next: PointerLike) => {
      const dy = next.clientY - current.startY;
      if (current.index === null && Math.abs(dy) < DRAG_DISTANCE) return;
      const from = current.ids.indexOf(current.id);
      const index = Math.max(0, Math.min(current.ids.length - 1, from + Math.round(dy / current.rowHeight)));
      if (index === current.index) return;
      if (current.index === null) endedAt.current = Infinity;
      current = { ...current, index };
      setDrag(current);
    };
    const end = () => {
      stop.current();
      if (current.index === null) return;
      endedAt.current = Date.now();
      setDrag(null);
      const target = current.ids[current.index]!;
      if (target === current.id) return;
      setPending(moveKeyTo(current.ids, current.id, target));
      // Hold the new order while it saves, then follow the saved settings.
      void onReorder(current.id, target).finally(() => setPending(null));
    };
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
    stop.current = () => {
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerup", end);
      dom.removeEventListener("pointercancel", end);
      stop.current = () => {};
      setDrag((value) => (value && current.index === null ? null : value));
    };
  };

  return (
    <>
      {items.map((bot) => {
        const isDragging = drag?.id === bot.id && drag.index !== null;
        const style: ViewStyle = { zIndex: isDragging ? 1 : 0, ...(isDragging ? ({ cursor: "grabbing" } as unknown as ViewStyle) : {}) };
        return (
          <View key={bot.id} style={style} onLayout={(event: LayoutChangeEvent) => heights.current.set(bot.id, event.nativeEvent.layout.height)}>
            {renderBot(bot, {
              props: {
                onPointerDown: (event: PointerLike) => begin(bot.id, event),
                // Stops the browser dragging the avatar image instead.
                onDragStart: (event: { preventDefault(): void }) => event.preventDefault(),
              },
              isDragging,
              canPress,
            })}
          </View>
        );
      })}
    </>
  );
}

/** `ids` with `id` moved to `index`. */
function moveTo(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((entry) => entry !== id);
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}
