import { useRef, useState, type ReactNode } from "react";
import { Platform, View, type ViewStyle } from "react-native";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type Modifier } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Bot } from "../shared/bot";
import { applyStoredOrdering, moveKeyTo } from "../shared/sidebar";
import { domNode } from "./web";

export interface BotDragHandle {
  props?: Record<string, unknown>;
  ref?: (node: unknown) => void;
  isDragging: boolean;
  canPress(): boolean;
}

interface Props {
  bots: Bot[];
  hostId: string;
  onReorder(source: string, target: string): Promise<boolean>;
  renderBot(bot: Bot, drag: BotDragHandle): ReactNode;
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const modifiers = [restrictToVerticalAxis];

/** Matches Paseo 0.12's DraggableList: sensors, collision strategy, lift and row transitions.
 * https://github.com/getpaseo/paseo/blob/v0.12.0/packages/app/src/components/draggable-list.web.tsx
 * The plugin SDK does not export that host component, so its dnd-kit engine is bundled here.
 */
export function BotSortableList(props: Props) {
  if (Platform.OS !== "web") return <>{props.bots.map((bot) => <View key={bot.id}>{props.renderBot(bot, { isDragging: false, canPress: () => true })}</View>)}</>;
  return <WebBotSortableList {...props} />;
}

function WebBotSortableList({ bots, hostId, onReorder, renderBot }: Props) {
  const [drag, setDrag] = useState<{ id: string; ids: string[] } | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const endedAt = useRef(0);
  const canPress = () => Date.now() - endedAt.current > 150;
  const items = applyStoredOrdering(bots, drag?.ids ?? pending ?? [], (bot) => bot.id);
  const ids = items.map((bot) => bot.id);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const finish = () => { endedAt.current = Date.now(); setDrag(null); };
  return (
    <DndContext
      id={`bots-${hostId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      onDragStart={({ active }) => { endedAt.current = Infinity; setDrag({ id: String(active.id), ids }); }}
      onDragCancel={finish}
      onDragEnd={({ active, over }) => {
        finish();
        if (!over || active.id === over.id || !ids.includes(String(active.id)) || !ids.includes(String(over.id))) return;
        const source = String(active.id); const target = String(over.id);
        setPending(moveKeyTo(ids, source, target));
        // Hold the final placement while the VPS saves it, then follow authoritative settings.
        void onReorder(source, target).finally(() => setPending(null));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((bot) => <SortableBot key={bot.id} bot={bot} disabled={items.length < 2 || pending !== null} canPress={canPress} renderBot={renderBot} />)}
      </SortableContext>
    </DndContext>
  );
}

function SortableBot({ bot, disabled, canPress, renderBot }: { bot: Bot; disabled: boolean; canPress(): boolean; renderBot: Props["renderBot"] }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: bot.id, disabled });
  const base = CSS.Transform.toString(transform && isDragging ? { ...transform, scaleX: 1, scaleY: 1 } : transform);
  const style = {
    transform: [base, isDragging ? "scale(1.02)" : ""].filter(Boolean).join(" ") || undefined,
    transition,
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 1000 : 1,
    userSelect: "none",
  } as ViewStyle;
  return (
    <View ref={(node) => setNodeRef(domNode(node) as Parameters<typeof setNodeRef>[0])} style={style}>
      {renderBot(bot, {
        props: { ...attributes, ...listeners, onDragStart: (event: { preventDefault(): void }) => event.preventDefault() },
        ref: (node) => setActivatorNodeRef(domNode(node) as Parameters<typeof setActivatorNodeRef>[0]),
        isDragging,
        canPress,
      })}
    </View>
  );
}
