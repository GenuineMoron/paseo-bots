import type { PluginPopoverProps, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarSeparator } from "@getpaseo/plugin/client/ui";
import { useCallback, useState } from "react";
import { Modal as NativeModal, Pressable, Text, View, useWindowDimensions, type LayoutRectangle } from "react-native";
import { newBotId, presetFromBot, type Bot } from "../shared/bot";
import { aggregateBuckets, BUCKET_LABELS, chatBucket, moveKey, moveKeyTo, orderSidebarBots, type ChatBucket } from "../shared/sidebar";
import { randomSeed } from "../shared/avatar";
import { exportBotRpc, importBotRpc } from "../shared/rpc";
import { Avatar } from "./Avatar";
import { BotsSurface } from "./BotsSurface";
import { botMenuEntries } from "./BotDialogs";
import { useBotChats, useBotHost, useChatInvalidation } from "./data";
import { requestIntent, type BotAction } from "./intent";
import { errorText, nativeTokens, useHover, type NativeTokens } from "./native";
import { ui } from "./typography";
import { useBotSettings } from "./useBotSettings";
import { useEscapeToClose } from "./ui/escape";
import { contextMenuProps, Entries } from "./ui/Menu";
import { BotSortableList, type BotDragHandle } from "./BotSortableList";

/** The host places header contributions before its Pinned and Workspaces sections. */
export function BotShortcuts(props: PluginSidebarItemProps) {
  const { currentScreen, theme } = props;
  const { settings, commit } = useBotSettings();
  // Keeps the bots' working and needs-you dots live.
  useChatInvalidation(props.host);
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const bots = settings.status === "ready" ? orderSidebarBots(settings.values.bots, settings.values.sidebarBotOrder) : [];
  const reorder = (source: string, target: string) => commit((values) => ({
    ...values,
    sidebarBotOrder: moveKeyTo(orderSidebarBots(values.bots, values.sidebarBotOrder).map((bot) => bot.id), source, target),
  })).catch((error: unknown) => { toast.error(`Couldn't reorder bots: ${errorText(error)}`); return false; });
  const { colors } = theme;
  return (
    <>
    <SidebarSeparator />
    <View style={{ paddingTop: 4, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bots section"
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => setCollapsed((value) => !value)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 28 }}
        >
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
          <Text style={{ fontSize: ui(12), color: colors.foregroundMuted }}>Bots</Text>
        </Pressable>
        {/* Every bot, teams, Skills & Tools and New bot live on the Bots screen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="All bots"
          hitSlop={6}
          onPress={() => props.openScreen({ screenId: "bots" })}
          style={({ pressed }) => ({ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: pressed || currentScreen?.screenId === "bots" ? nativeTokens(colors).interactionHighlight : "transparent" })}
        >
          <Icon name="LayoutGrid" size={13} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      {!collapsed ? <BotSortableList key={props.host.id} bots={bots} hostId={props.host.id} onReorder={reorder} renderBot={(bot, drag) => (
        <SidebarBot
          key={bot.id}
          {...props}
          bot={bot}
          drag={drag}
          active={currentScreen?.screenId === "bot-sessions" && currentScreen.params.botId === bot.id}
        />
      )} /> : null}
      {!collapsed && settings.status === "loading" ? <Text style={{ paddingHorizontal: 18, color: colors.foregroundMuted, fontSize: ui(12) }}>Loading bots…</Text> : null}
      {!collapsed && settings.status !== "ready" && settings.status !== "loading" ? <Text style={{ paddingHorizontal: 18, color: colors.statusDanger, fontSize: ui(12) }}>Couldn't load bots</Text> : null}
    </View>
    </>
  );
}

function SidebarBot({ bot, active, openScreen, openPopover, theme, layout, host, drag }: PluginSidebarItemProps & { bot: Bot; active: boolean; drag: BotDragHandle }) {
  const { colors } = theme;
  const { hovered, hoverProps } = useHover();
  const tokens = nativeTokens(colors);
  const [anchor, setAnchor] = useState<LayoutRectangle | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const viewport = useWindowDimensions();
  const chats = useBotChats(useBotHost(bot.hostId, host), bot.id);
  const bucket = aggregateBuckets((chats.data ?? []).map(chatBucket));
  const close = useCallback(() => setAnchor(null), []);
  useEscapeToClose(anchor !== null, close);
  const actions = (point?: LayoutRectangle) => {
    if (layout.compact || !point) openPopover((props) => <BotActions {...props} botId={bot.id} />);
    else { setMenuHeight(0); setAnchor(point); }
  };
  return (
    <>
    <Pressable
      ref={drag.ref}
      {...drag.props}
      accessibilityRole="button"
      accessibilityLabel={bot.name}
      accessibilityState={{ selected: active }}
      onPress={() => { if (drag.canPress()) openScreen({ screenId: "bot-sessions", params: { botId: bot.id, botName: bot.name } }); }}
      onLongPress={layout.compact ? () => { if (drag.canPress()) actions(); } : undefined}
      {...contextMenuProps(actions)}
      {...hoverProps}
      style={({ pressed }) => ({ minHeight: 44, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: active || hovered || pressed || drag.isDragging ? tokens.interactionHighlight : "transparent" })}
    >
      <Avatar avatar={bot.avatar} size={32} dark={tokens.dark} />
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: active ? colors.foreground : colors.foregroundMuted, fontSize: ui(14), opacity: bot.archived ? 0.6 : 1 }}>{bot.name}</Text>
      <StatusDot tokens={tokens} bucket={bucket} />
    </Pressable>
    {anchor ? (
      <NativeModal transparent visible animationType="none" onRequestClose={close}>
        <View style={{ flex: 1 }}>
          <Pressable accessibilityLabel="Close bot menu" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View
            accessibilityRole="menu"
            onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
            style={{ position: "absolute", width: 240, left: Math.max(8, Math.min(anchor.x, viewport.width - 248)), top: Math.max(8, Math.min(anchor.y, viewport.height - menuHeight - 8)), opacity: menuHeight ? 1 : 0, paddingVertical: 4, backgroundColor: colors.surface1, borderWidth: 1, borderColor: tokens.borderAccent, borderRadius: 8, overflow: "hidden", shadowColor: colors.foreground, shadowOpacity: 0.15, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 8 }}
          >
            <BotActions botId={bot.id} theme={theme} layout={layout} host={host} close={close} openScreen={openScreen} />
          </View>
        </View>
      </NativeModal>
    ) : null}
    </>
  );
}

/** A dot while one of the bot's chats is working, or needs the user. */
function StatusDot({ tokens, bucket }: { tokens: NativeTokens; bucket: ChatBucket }) {
  const color = bucket === "running" ? tokens.statusDotRunning : bucket === "needs_input" || bucket === "attention" ? tokens.statusDotWarning : bucket === "failed" ? tokens.statusDotDanger : null;
  return color ? <View accessibilityLabel={BUCKET_LABELS[bucket]} style={{ width: 7, height: 7, borderRadius: 4, marginRight: 4, backgroundColor: color }} /> : null;
}

/** Uses the nested panel's menu entries and its existing dialogs for complex actions. */
function BotActions({ botId, theme, layout, host, close, openScreen }: PluginPopoverProps & { botId: string }) {
  const { settings, commit } = useBotSettings();
  const toast = useToast();
  const exportBot = useRpc(exportBotRpc);
  const importBot = useRpc(importBotRpc);
  const bot = settings.status === "ready" ? settings.values.bots.find((entry) => entry.id === botId) : undefined;
  if (!bot) return <Text style={{ padding: 16, color: theme.colors.foregroundMuted }}>Bot unavailable</Text>;
  const ordered = settings.status === "ready" ? orderSidebarBots(settings.values.bots, settings.values.sidebarBotOrder) : [];
  const index = ordered.findIndex((entry) => entry.id === botId);
  const move = (delta: -1 | 1) => void commit((values) => {
    const next = moveKey(orderSidebarBots(values.bots, values.sidebarBotOrder).map((entry) => entry.id), botId, delta);
    return next ? { ...values, sidebarBotOrder: next } : values;
  });
  const openAction = (action: BotAction) => {
    close();
    openScreen({ screenId: "bot-sessions", params: { botId: bot.id, botName: bot.name } });
    requestIntent({ kind: "bot-action", hostId: host.id, botId: bot.id, action });
  };
  const toggle = (key: "pinned" | "archived") => void commit((values) => ({ ...values, sidebarBotOrder: key === "pinned" ? values.sidebarBotOrder?.filter((id) => id !== bot.id) : values.sidebarBotOrder, bots: values.bots.map((entry) => entry.id === bot.id ? { ...entry, [key]: !entry[key], updatedAt: new Date().toISOString() } : entry) }));
  const duplicate = async () => {
    const { json } = await exportBot({ bot, includeMemory: false });
    const { bot: copy } = await importBot({ botId: newBotId(), json });
    const next = { ...copy, name: `${bot.name} copy`, hostId: bot.hostId, cwd: bot.cwd, alwaysAllow: bot.alwaysAllow, skillIds: bot.skillIds, mcpServerIds: bot.mcpServerIds, avatar: { ...bot.avatar, seed: randomSeed() } };
    if (await commit((values) => ({ ...values, bots: [...values.bots, next] }))) {
      close();
      openScreen({ screenId: "bot-sessions", params: { botId: next.id, botName: next.name } });
      requestIntent({ kind: "bot-action", hostId: host.id, botId: next.id, action: "settings" });
    }
  };
  return <Entries colors={theme.colors} compact={layout.compact} onClose={close} entries={botMenuEntries({
    bot,
    onOpenSettings: () => openAction("settings"),
    onTogglePin: () => toggle("pinned"),
    onMoveUp: index > 0 ? () => move(-1) : undefined,
    onMoveDown: index >= 0 && index < ordered.length - 1 ? () => move(1) : undefined,
    onRename: () => openAction("rename"),
    onDuplicate: () => duplicate().catch((error: unknown) => toast.error(`Couldn't duplicate: ${errorText(error)}`)),
    onExport: () => openAction("export"),
    onCopyId: () => void copyText(bot.id).then(() => toast.show("Bot ID copied", { variant: "success" })).catch(() => toast.error("Unable to copy")),
    onSaveAsPreset: () => void commit((values) => ({ ...values, presets: [...(values.presets ?? []), presetFromBot(bot)] })).then((saved) => saved && toast.show(`Saved ${bot.name} as a preset`, { variant: "success" })),
    onToggleArchive: () => toggle("archived"),
    onDelete: async () => openAction("delete"),
  })} />;
}

export function BotSessionsScreen(props: PluginScreenProps) {
  if (!props.params.botId) return <Text style={{ padding: 24, color: props.theme.colors.foregroundMuted }}>Choose a bot from the sidebar.</Text>;
  // A different route must not retain another bot's selected chat or draft pane.
  return <BotsSurface key={props.params.botId} {...props} focusedBotId={props.params.botId} />;
}
