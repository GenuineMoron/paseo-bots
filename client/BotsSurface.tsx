import type { PaseoAgent } from "./paseo";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, type LayoutRectangle, Platform, Text, View } from "react-native";
import { randomSeed } from "../shared/avatar";
import { applyDefaults, DEFAULT_BOT_DEFAULTS, EMPTY_LIBRARY, newBotId, newGroupId, presetFromBot, type Bot, type BotGroup, type BotListUi } from "../shared/bot";
import { saveTeam, tabOf, teamTabs, withoutBot } from "../shared/groups";
import { addImportedBots } from "../shared/library";
import { backStep } from "../shared/back";
import { displayTitle } from "../shared/chat";
import { moveKey } from "../shared/sidebar";
import { chatTranscript } from "../shared/transcript";
import { exportBotRpc, importBotRpc, importTeamRpc } from "../shared/rpc";
import { botFromPreset, newBot } from "../shared/templates";
import { AvatarTheme } from "./Avatar";
import { botMenuEntries, chatMenuEntries, ExportDialog, NewBotDialog, RenameDialog } from "./BotDialogs";
import { BotSidebar, type ChatMenuContext, type MenuSource } from "./BotSidebar";
import { SETUP_PROMPT, useBotChatActions } from "./chats";
import { botWorkspaceId, fullTimeline, refreshChats, useBotHost, useChatInvalidation, useHostResolver, useProviders, type LocalHost } from "./data";
import { onIntent, peekIntent, takeIntent } from "./intent";
import { LibraryView } from "./library/LibraryView";
import { onLibraryTarget, ScreenScope, type LibraryTarget } from "./navigation";
import { useBotDrafts } from "./surface/useBotDrafts";
import { useListUi } from "./surface/useListUi";
import { Splash } from "./Splash";
import { TeamMap } from "./teams/TeamMap";
import { TeamSheet } from "./teams/TeamSheet";
import { TeamTabsRow, TeamTabSwitcher } from "./teams/TeamTabs";
import { ResizeHandle, SlideOver } from "./ui/Columns";
import { fitColumns } from "../shared/layout";
import { confirmDialog, errorText, nativeTokens } from "./native";
import { MenuProvider, useMenu } from "./ui/Menu";
import { useTooltipTheme } from "./ui/Tooltip";
import { homeIndicatorInset, useKeyboardHeight } from "./keyboard";
import { BotPanel, type SectionId } from "./panel/BotPanel";
import { useBotSettings } from "./useBotSettings";
import { ui, useTypeScale } from "./typography";

/** A bot's settings in the main column stay readable on wide screens. */
const PANE_MAX_WIDTH = 760;

interface BotsSurfaceProps extends PluginSurfaceProps {
  focusedBotId?: string;
}

export function BotsSurface(props: BotsSurfaceProps) {
  const { colors } = props.theme;
  useTooltipTheme(colors);
  return (
    <ScreenScope.Provider value={props.focusedBotId ?? "all"}>
      <MenuProvider colors={colors} compact={props.layout.compact}>
        <AvatarTheme dark={nativeTokens(colors).dark}>
          <BotsSurfaceContent {...props} />
        </AvatarTheme>
      </MenuProvider>
    </ScreenScope.Provider>
  );
}


function BotsSurfaceContent({ theme, layout, host, navigation, focusedBotId }: BotsSurfaceProps) {
  const { colors } = theme;
  const { settings, latest, commit } = useBotSettings();
  const toast = useToast();
  const menu = useMenu();
  const queryClient = useQueryClient();
  const localHost: LocalHost = { id: host.id, label: host.label };
  const localProviders = useProviders(useBotHost(null, localHost));
  const resolveHost = useHostResolver(localHost);
  const exportBot = useRpc(exportBotRpc);
  const importBot = useRpc(importBotRpc);
  const importTeam = useRpc(importTeamRpc);

  /** Names this screen to the navigation store: a bot's own screen, or the full surface. */
  const scope = focusedBotId ?? "all";
  const chatActions = useBotChatActions(navigation);
  const [focusedCollapsed, setFocusedCollapsed] = useState(false);
  /** The bot whose settings are open, and the open page (null: the overview). A bot's own screen opens on them on wide layouts. */
  const [panel, setPanel] = useState<{ botId: string; section: SectionId | null } | null>(focusedBotId && !layout.compact ? { botId: focusedBotId, section: null } : null);
  const [panelVersion, setPanelVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  /** The team map replaces the chat pane while open. */
  const [teamMap, setTeamMap] = useState(false);
  const [editingTeam, setEditingTeam] = useState<BotGroup | "new" | null>(null);
  /** Skills & Tools replaces the bot list and chat while open; `target` is its page (null: the list, on compact). */
  const [libraryView, setLibraryView] = useState<{ target: LibraryTarget | null } | null>(null);
  const [renaming, setRenaming] = useState<Bot | null>(null);
  const [exporting, setExporting] = useState<Bot | null>(null);
  const { drafts, patchBot, updateBot, flush } = useBotDrafts({ latest, commit });
  const { listUi, currentUi, updateUi } = useListUi({ settings, latest, commit });
  const keyboardHeight = useKeyboardHeight();
  /** The home indicator on phones; the keyboard covers it while it's up. */
  const bottomInset = keyboardHeight > 0 ? 0 : homeIndicatorInset();
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  /** The list's width while its resize handle is dragged; saved to the list UI on release. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Re-renders the whole surface when Paseo's interface/content/code sizes change.
  useTypeScale();
  useChatInvalidation(localHost);

  /** Opens Skills & Tools. Unsaved bot edits are saved first so the library sees them. */
  const enterLibrary = (target: LibraryTarget | null) => {
    void flush();
    setLibraryView({ target });
  };

  // A bot's settings and the bot list ask for Skills & Tools through the navigation store, by screen.
  const enterLibraryRef = useRef(enterLibrary);
  enterLibraryRef.current = enterLibrary;
  useEffect(
    () =>
      onLibraryTarget(scope, (target) => {
        enterLibraryRef.current(target);
      }),
    [scope],
  );

  // One step back through the Bots screen (see shared/back.ts). Android's Back and the phone
  // swipes use it; with nothing left to step back from, Back leaves the plugin.
  const back = useRef({ panel, compact: layout.compact, teamMap, libraryView });
  back.current = { panel, compact: layout.compact, teamMap, libraryView };
  const goBack = (): boolean => {
    const state = back.current;
    const step = backStep({
      libraryOpen: state.libraryView !== null,
      libraryPage: state.libraryView?.target != null,
      panelOpen: state.panel !== null,
      panelSection: state.panel?.section != null,
      compact: state.compact,
      teamMapOpen: state.teamMap,
    });
    switch (step) {
      case "library-list": setLibraryView({ target: null }); break;
      case "close-library": setLibraryView(null); break;
      case "settings-list": setPanel((current) => (current ? { ...current, section: null } : null)); break;
      case "close-settings": setPanel(null); break;
      case "close-team-map": setTeamMap(false); break;
      default: return false;
    }
    return true;
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => goBackRef.current());
    return () => subscription.remove();
  }, []);

  const consumeIntent = useRef<() => void>(() => {});
  consumeIntent.current = () => {};
  // Sidebar actions can target either an already-open screen or a newly mounted route.
  useEffect(() => {
    const listener = () => consumeIntent.current();
    const unsubscribe = onIntent(listener);
    listener();
    return unsubscribe;
  }, []);
  useEffect(() => consumeIntent.current(), [settings.status, focusedBotId]);

  if (settings.status !== "ready") {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: colors.surface0, justifyContent: settings.status === "loading" ? "center" : "flex-start", alignItems: settings.status === "loading" ? "center" : "stretch" }}>
        {settings.status === "loading" ? (
          <ActivityIndicator size="large" color={colors.foregroundMuted} accessibilityLabel="Loading bots" />
        ) : (
          <Text style={{ fontSize: ui(14), color: colors.statusDanger }}>Couldn't read bots: {settings.error}</Text>
        )}
        {settings.status === "invalid" ? (
          <SettingsCard>
            <SettingsAction label="Reset bots" hint="Replaces the unreadable bot list with an empty one." actionLabel="Reset" onPress={() => void settings.reset()} />
          </SettingsCard>
        ) : null}
      </View>
    );
  }

  const columns = fitColumns(surfaceWidth || 1600, dragWidth ?? listUi.listWidth, null);
  const commitWidth = (width: number) => {
    setDragWidth(null);
    updateUi((current) => ({ ...current, listWidth: Math.round(width) }));
  };
  const allBots = settings.values.bots.filter((bot) => !focusedBotId || bot.id === focusedBotId).map((bot) => drafts[bot.id] ?? bot);
  const library = settings.values.library ?? EMPTY_LIBRARY;
  const groups = focusedBotId ? [] : settings.values.groups ?? [];
  const listed = allBots
    .filter((bot) => focusedBotId || listUi.showArchived || !bot.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const panelBot = panel ? allBots.find((bot) => bot.id === panel.botId) : undefined;
  const archivedCount = allBots.filter((bot) => bot.archived).length;
  const tabs = teamTabs(groups, listed);
  const openTab = focusedBotId ? null : tabs.find((tab) => tab.id === listUi.tab) ?? tabs[0] ?? null;

  // ------------------------------------------------------------ actions

  /** Shows a bot's settings, with its bot expanded in the list and its team's tab open. */
  const openPanel = (bot: Bot, section: SectionId | null) => {
    setPanel({ botId: bot.id, section });
    setTeamMap(false);
    const tab = openTab && tabOf(bot.id, groups) !== openTab.id ? tabOf(bot.id, groups) : null;
    if (tab || currentUi().collapsed.includes(bot.id)) {
      updateUi((current) => ({ ...current, tab: tab ?? current.tab, collapsed: current.collapsed.filter((id) => id !== bot.id) }));
    }
  };

  /** Saves a new bot and opens it with its settings. */
  const addBot = async (bot: Bot, section: SectionId = "identity") => {
    const saved = await commit((values) => ({ ...values, bots: [...values.bots, bot] }));
    if (saved) openPanel(bot, section);
  };

  /** Opens a chat in Paseo's chat view. */
  const openChat = (bot: Bot, chatId: string) => chatActions.open(resolveHost(bot.hostId), chatId);

  /** Starts a chat with the bot (empty, or with a first message) and opens it. Edits are saved first. */
  const newChat = (bot: Bot, prompt?: string) =>
    void flush().then(() => chatActions.startAndOpen(bot, resolveHost(bot.hostId), library, prompt));

  const defaultProvider = () => {
    const ready = (localProviders.data ?? []).filter((entry) => entry.status === "ready");
    return (ready.find((entry) => entry.provider === "claude") ?? ready[0])?.provider ?? "";
  };

  const duplicate = async (bot: Bot) => {
    await flush();
    const { json } = await exportBot({ bot, includeMemory: false });
    const { bot: copy } = await importBot({ botId: newBotId(), json });
    // Same library items as the original; the copy's own file only carries redacted server settings.
    await addBot({
      ...copy,
      name: `${bot.name} copy`,
      hostId: bot.hostId,
      cwd: bot.cwd,
      alwaysAllow: bot.alwaysAllow,
      skillIds: bot.skillIds,
      mcpServerIds: bot.mcpServerIds,
      avatar: { ...bot.avatar, seed: randomSeed() },
    });
  };

  const remove = async (bot: Bot) => {
    const ok = await commit((values) => ({
      ...values,
      bots: values.bots.filter((entry) => entry.id !== bot.id),
      history: values.history.filter((entry) => entry.botId !== bot.id),
      groups: withoutBot(values.groups ?? [], bot.id, new Date().toISOString()),
    }));
    if (!ok) return;
    if (panel?.botId === bot.id) setPanel(null);
    updateUi((current) => {
      const { [bot.id]: _order, ...chatOrder } = current.chatOrder;
      return {
        ...current,
        collapsed: current.collapsed.filter((id) => id !== bot.id),
        pinnedChats: current.pinnedChats.filter((pin) => pin.botId !== bot.id),
        chatOrder,
      };
    });
  };

  /**
   * Swaps a bot with its neighbour as the list shows it: on a team's tab within the team,
   * whose Chief of Staff stays first; otherwise among the listed bots, where pinned and
   * unpinned bots keep their own runs.
   */
  const moveBot = (bot: Bot, delta: -1 | 1): (() => void) | undefined => {
    const shown = openTab?.bots ?? listed;
    const index = shown.findIndex((entry) => entry.id === bot.id);
    const neighbour = shown[index + delta];
    if (index === -1 || !neighbour) return undefined;
    const swap = (ids: readonly string[]) => ids.map((id) => (id === bot.id ? neighbour.id : id === neighbour.id ? bot.id : id));
    const group = openTab?.group;
    if (group) {
      if (bot.id === group.leadId || neighbour.id === group.leadId) return undefined;
      return () =>
        void commit((values) => ({
          ...values,
          groups: (values.groups ?? []).map((entry) => (entry.id === group.id ? { ...entry, memberIds: swap(entry.memberIds), updatedAt: new Date().toISOString() } : entry)),
        }));
    }
    if (neighbour.pinned !== bot.pinned) return undefined;
    return () =>
      void commit((values) => {
        const order = swap(values.bots.map((entry) => entry.id));
        return { ...values, bots: order.map((id) => values.bots.find((entry) => entry.id === id)!) };
      });
  };

  const copy = (text: string, done: string) =>
    void copyText(text)
      .then(() => toast.show(done, { variant: "success" }))
      .catch(() => toast.error("Unable to copy"));

  const deleteBot = async (bot: Bot) => {
    const confirmed = await confirmDialog({
      title: "Delete bot?",
      message: `Delete "${bot.name}"?\n\nIts chats stay on the host and remain in Paseo's history.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (confirmed) await remove(bot);
  };

  consumeIntent.current = () => {
    const intent = peekIntent();
    if (!intent) return;
    if (intent.kind === "new-bot") {
      if (!focusedBotId) { takeIntent(); setCreating(true); }
      return;
    }
    if (intent.hostId !== host.id || intent.botId !== focusedBotId) return;
    takeIntent();
    const bot = allBots.find((entry) => entry.id === intent.botId);
    if (!bot) return;
    switch (intent.action) {
      case "settings": openPanel(bot, "identity"); break;
      case "rename": setRenaming(bot); break;
      case "export": setExporting(bot); break;
      case "delete": void deleteBot(bot).catch((error: unknown) => toast.error(errorText(error))); break;
    }
  };

  const openBotMenu = (bot: Bot, anchor: LayoutRectangle, source: MenuSource) => {
    const botHost = resolveHost(bot.hostId);
    const workspaceId = botWorkspaceId(queryClient, botHost.key, bot.id);
    const openWorkspace = navigation?.openWorkspace;
    menu.open({
      anchor,
      align: source === "kebab" ? "end" : "start",
      width: 220,
      title: "Bot actions",
      entries: botMenuEntries({
        bot,
        onOpenInPaseo: openWorkspace && workspaceId && botHost.online ? () => openWorkspace({ workspaceId, serverId: botHost.key }) : undefined,
        onOpenSettings: () => openPanel(bot, "identity"),
        onTogglePin: () => void updateBot(bot.id, { pinned: !bot.pinned }),
        onMoveUp: moveBot(bot, -1),
        onMoveDown: moveBot(bot, 1),
        onRename: () => setRenaming(bot),
        onDuplicate: () => duplicate(bot).catch((error: unknown) => toast.error(`Couldn't duplicate: ${errorText(error)}`)),
        onExport: () => setExporting(bot),
        onCopyId: () => copy(bot.id, "Bot ID copied"),
        onSaveAsPreset: () =>
          void flush()
            .then(() => commit((values) => ({ ...values, presets: [...(values.presets ?? []), presetFromBot(values.bots.find((entry) => entry.id === bot.id) ?? bot)] })))
            .then((saved) => saved && toast.show(`Saved ${bot.name} as a preset. It's under New bot.`, { variant: "success" })),
        onToggleArchive: () => void updateBot(bot.id, { archived: !bot.archived }),
        onDelete: () => deleteBot(bot),
      }),
    });
  };

  const deleteTeam = async (group: BotGroup) => {
    const confirmed = await confirmDialog({ title: "Delete team?", message: `Delete the "${group.name}" team? Its bots stay, without a team.`, confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true });
    if (!confirmed) return false;
    await commit((values) => ({ ...values, groups: (values.groups ?? []).filter((entry) => entry.id !== group.id) }));
    return true;
  };

  const openTeamMenu = (group: BotGroup, anchor: LayoutRectangle) =>
    menu.open({
      anchor,
      align: "end",
      width: 200,
      title: "Team actions",
      entries: [
        { label: "Edit team", icon: "Pencil", onSelect: () => setEditingTeam(group) },
        { label: "Team map", icon: "Network", onSelect: () => setTeamMap(true) },
        { kind: "separator" },
        { label: "Delete team", icon: "Trash2", destructive: true, onSelect: () => void deleteTeam(group) },
      ],
    });

  const openChatMenu = (bot: Bot, chat: PaseoAgent, anchor: LayoutRectangle, source: MenuSource, context: ChatMenuContext) => {
    const botHost = resolveHost(bot.hostId);
    const move = (delta: -1 | 1) => {
      const order = moveKey(context.siblings, chat.id, delta);
      return order ? () => updateUi((current) => ({ ...current, chatOrder: { ...current.chatOrder, [bot.id]: order } })) : undefined;
    };
    const unpin = (current: BotListUi) => ({ ...current, pinnedChats: current.pinnedChats.filter((pin) => pin.chatId !== chat.id) });
    menu.open({
      anchor,
      align: source === "kebab" ? "end" : "start",
      width: 260,
      title: "Chat actions",
      entries: chatMenuEntries({
        pinned: context.pinned,
        onCopyPath: () => (chat.cwd ? copy(chat.cwd, "Path copied") : toast.error("Chat path not available")),
        onCopyId: () => copy(chat.id, "Chat ID copied"),
        onCopyTranscript: async () => {
          if (!botHost.api) {
            toast.error("Host is not connected");
            return;
          }
          try {
            const entries = await fullTimeline(botHost.api, chat.id);
            await copyText(chatTranscript({ title: displayTitle(chat.title), botName: bot.name, entries, exportedAt: new Date() }));
            toast.show("Transcript copied", { variant: "success" });
          } catch (error) {
            toast.error(`Couldn't copy the transcript: ${errorText(error)}`);
          }
        },
        onTogglePin: () =>
          updateUi((current) =>
            context.pinned ? unpin(current) : { ...current, pinnedChats: [...current.pinnedChats, { botId: bot.id, chatId: chat.id }] },
          ),
        move: context.pinned || listUi.chatSort !== "manual" ? null : { up: move(-1), down: move(1) },
        onArchive: async () => {
          if (!botHost.api) {
            toast.error("Host is not connected");
            return;
          }
          try {
            await botHost.api.agents.ref(chat.id).archive();
            if (context.pinned) updateUi(unpin);
            await refreshChats(queryClient, botHost.key);
          } catch (error) {
            toast.error(`Failed to archive chat: ${errorText(error)}`);
          }
        },
      }),
    });
  };

  const openDisplayMenu = (anchor: LayoutRectangle) => {
    menu.open({
      anchor,
      align: "end",
      width: 232,
      title: "Display",
      entries: [
        {
          label: "Archived bots",
          trailing: listUi.showArchived ? "Shown" : archivedCount ? `Hidden (${archivedCount})` : "Hidden",
          onSelect: () => updateUi((current) => ({ ...current, showArchived: !current.showArchived })),
        },
        {
          label: "Chat order",
          trailing: listUi.chatSort === "manual" ? "Manual" : "Last activity",
          onSelect: () => updateUi((current) => ({ ...current, chatSort: current.chatSort === "manual" ? "activity" : "manual" })),
        },
      ],
    });
  };

  const sidebar = (
    <BotSidebar
      colors={colors}
      bots={listed}
      focused={Boolean(focusedBotId)}
      openTab={openTab}
      hiddenArchivedCount={listUi.showArchived ? 0 : archivedCount}
      ui={focusedBotId ? { ...listUi, collapsed: focusedCollapsed ? [focusedBotId] : [] } : listUi}
      localHost={localHost}
      touch={layout.compact || layout.platform !== "web"}
      splash={layout.compact}
      bottomInset={bottomInset}
      onToggle={(botId) => focusedBotId ? setFocusedCollapsed((value) => !value) :
        updateUi((current) => ({
          ...current,
          collapsed: current.collapsed.includes(botId) ? current.collapsed.filter((id) => id !== botId) : [...current.collapsed, botId],
        }))
      }
      onTogglePinnedSection={() => updateUi((current) => ({ ...current, pinnedCollapsed: !current.pinnedCollapsed }))}
      onShowArchived={() => updateUi((current) => ({ ...current, showArchived: true }))}
      onOpenChat={openChat}
      onNewChat={(bot) => newChat(bot)}
      onNewBot={() => setCreating(true)}
      onBotMenu={openBotMenu}
      onChatMenu={openChatMenu}
      onDisplayMenu={openDisplayMenu}
      onEditTeam={setEditingTeam}
      onTeamMap={() => setTeamMap(true)}
    />
  );

  const tabProps = openTab
    ? { colors, tabs, openTab, onTab: (tab: string) => updateUi((current) => ({ ...current, tab })), onTeamMenu: openTeamMenu, onNewTeam: () => setEditingTeam("new" as const) }
    : null;

  const teamMapView = teamMap ? (
    <TeamMap
      colors={colors}
      groups={groups}
      bots={allBots}
      localHost={localHost}
      compact={layout.compact}
      bottomInset={bottomInset}
      onBack={layout.compact ? () => setTeamMap(false) : undefined}
      onNewTeam={() => setEditingTeam("new")}
      onEditTeam={setEditingTeam}
      onOpenBot={(bot) => openPanel(bot, "overview")}
    />
  ) : null;

  const settingsPanel =
    panel && panelBot ? (
      <BotPanel
        key={`${panelBot.id}:${panelVersion}`}
        colors={colors}
        compact={layout.compact}
        bottomInset={bottomInset}
        bot={panelBot}
        localHost={localHost}
        history={settings.values.history}
        library={library}
        groups={groups}
        section={panel.section}
        onSection={(section) => setPanel({ botId: panelBot.id, section })}
        onClose={() => setPanel(null)}
        onPatch={(patch) => patchBot(panelBot.id, patch)}
        flush={flush}
        onRestore={(snapshot) => {
          patchBot(panelBot.id, snapshot);
          setPanelVersion((version) => version + 1);
          toast.show("Restored. Undo it from History if needed.", { variant: "success" });
        }}
        onSetup={() => newChat(panelBot, SETUP_PROMPT)}
        onOpenChat={(chatId) => openChat(panelBot, chatId)}
      />
    ) : null;

  const libraryScreen = libraryView ? (
    <LibraryView
      colors={colors}
      layout={layout}
      bottomInset={bottomInset}
      values={settings.values}
      commit={commit}
      target={libraryView.target}
      onTarget={(target) => setLibraryView({ target })}
      onBack={() => setLibraryView(null)}
    />
  ) : null;

  // On desktop Skills & Tools takes over the screen, like Paseo's settings.
  if (libraryScreen && !layout.compact) {
    return <View style={{ flex: 1, backgroundColor: colors.surface0, paddingBottom: keyboardHeight }}>{libraryScreen}</View>;
  }

  return (
    <>
    {/* The host gives plugin surfaces no keyboard handling; lift everything above the keyboard. */}
    <View
      style={{ flex: 1, backgroundColor: colors.surface0, paddingBottom: keyboardHeight }}
      onLayout={(event) => setSurfaceWidth(event.nativeEvent.layout.width)}
    >
      {layout.compact ? (
        <View style={{ flex: 1 }}>
          {tabProps ? <TeamTabSwitcher {...tabProps} /> : null}
          {sidebar}
          {teamMapView ? <SlideOver onClose={() => setTeamMap(false)}>{teamMapView}</SlideOver> : null}
          {settingsPanel ? (
            <SlideOver onClose={() => setPanel(null)} onBack={() => (panel?.section ? goBack() : false)}>
              {settingsPanel}
            </SlideOver>
          ) : null}
          {libraryScreen ? <SlideOver onClose={() => setLibraryView(null)}>{libraryScreen}</SlideOver> : null}
        </View>
      ) : (
        <>
          {tabProps ? <TeamTabsRow {...tabProps} /> : null}
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ width: columns.list, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: nativeTokens(colors).surfaceSidebar }}>
              {sidebar}
              <ResizeHandle side="right" width={columns.list} onResize={setDragWidth} onCommit={commitWidth} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {teamMapView ?? (settingsPanel ? (
                <View style={{ flex: 1, alignItems: "center" }}>
                  <View style={{ flex: 1, width: "100%", maxWidth: PANE_MAX_WIDTH }}>{settingsPanel}</View>
                </View>
              ) : (
                <Splash colors={colors} />
              ))}
            </View>
          </View>
        </>
      )}

      {editingTeam ? (
        <TeamSheet
          colors={colors}
          group={editingTeam === "new" ? null : editingTeam}
          groups={groups}
          bots={allBots}
          onClose={() => setEditingTeam(null)}
          onSave={(draft) => {
            const id = editingTeam === "new" ? null : editingTeam.id;
            const teamId = id ?? newGroupId();
            setEditingTeam(null);
            // A new team opens in its tab.
            void commit((values) => ({ ...values, groups: saveTeam(values.groups ?? [], id, draft, teamId, new Date().toISOString()) })).then((saved) => saved && !id && updateUi((current) => ({ ...current, tab: teamId })));
          }}
          onDelete={editingTeam === "new" ? undefined : () => void deleteTeam(editingTeam).then((deleted) => deleted && setEditingTeam(null))}
        />
      ) : null}
      {creating ? (
        <NewBotDialog
          colors={colors}
          onClose={() => setCreating(false)}
          presets={settings.status === "ready" ? (settings.values.presets ?? []) : []}
          onCreate={(start) => {
            setCreating(false);
            const bot = start?.preset ? botFromPreset(defaultProvider(), start.preset) : newBot(defaultProvider(), start?.template);
            const defaults = (settings.status === "ready" ? settings.values.defaults : undefined) ?? DEFAULT_BOT_DEFAULTS;
            void addBot(applyDefaults(bot, defaults, defaultProvider()), start ? "overview" : "identity");
          }}
          onImport={async (json) => {
            const { bots, teams } = await importTeam({ json });
            setCreating(false);
            const saved = await commit((values) => addImportedBots(values, bots, teams));
            const first = bots[0]?.bot;
            if (saved && first) {
              openPanel(first, "overview");
              if (bots.length > 1) toast.show(`Added ${bots.length} bots`, { variant: "success" });
            }
          }}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          colors={colors}
          title="Rename bot"
          initialValue={renaming.name}
          placeholder={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            if (!(await updateBot(renaming.id, { name }, true))) throw new Error("Unable to save");
            // The identity section holds its own copy of the name.
            if (panel?.botId === renaming.id) setPanelVersion((version) => version + 1);
          }}
        />
      ) : null}

      {exporting ? <ExportDialog colors={colors} bot={exporting} onClose={() => setExporting(null)} /> : null}
    </View>
    </>
  );
}
