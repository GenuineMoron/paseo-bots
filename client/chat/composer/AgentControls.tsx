import type { PaseoAgent } from "@getpaseo/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { Bot } from "../../../shared/bot";
import { chatConfigRpc, type ChatConfig } from "../../../shared/chat-config";
import { ensureBotHomeRpc } from "../../../shared/rpc";
import { useProviders, type BotHost } from "../../data";
import { errorText, nativeTokens } from "../../native";
import { ui } from "../../typography";
import { measureAnchor, useMenu } from "../../ui/Menu";
import { tooltip } from "../../ui/Tooltip";

type Colors = PluginTheme["colors"];
type Model = NonNullable<NonNullable<ReturnType<typeof useProviders>["data"]>[number]["models"]>[number];
interface Props { colors: Colors; bot: Bot; host: BotHost; agentId: string | null; agent?: PaseoAgent | null; running: boolean; }

/** One instance per composer draft/session; the bot's saved defaults stay separate. */
export function useComposerConfig({ bot, host, agentId, agent, running, colors }: Props) {
  const providers = useProviders(host);
  const configure = useRpc(chatConfigRpc);
  const ensureHome = useRpc(ensureBotHomeRpc);
  const toast = useToast();
  const [draft, setDraft] = useState<ChatConfig>({ model: bot.model, ...(bot.modeId ? { modeId: bot.modeId } : {}), thinkingOptionId: bot.thinkingOptionId });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [picking, setPicking] = useState(false);
  const provider = providers.data?.find((entry) => entry.provider === (agent?.provider ?? bot.provider));
  const models = (provider?.models ?? []).filter((entry) => entry.isSelectable !== false);
  const modelId = agentId ? agent?.model : draft.model;
  const model = models.find((entry) => entry.id === modelId) ?? (!modelId ? models.find((entry) => entry.isDefault) : undefined);
  const modes = agentId ? agent?.availableModes ?? [] : provider?.modes ?? [];
  const modeId = agentId ? agent?.currentModeId : draft.modeId ?? provider?.defaultModeId;
  const thinking = model?.thinkingOptions ?? [];
  const thinkingId = agentId ? agent?.thinkingOptionId ?? agent?.effectiveThinkingOptionId : draft.thinkingOptionId;
  const featureQuery = useQuery({
    queryKey: ["paseo-bots", "composer-features", host.key, bot.provider, bot.cwd, model?.id, modeId, thinkingId],
    enabled: !!host.api && !agentId && !!provider && (host.isLocal || !!bot.cwd),
    staleTime: 60_000,
    queryFn: async () => host.api!.providers.listFeatures({
      provider: `${bot.provider}${model?.id ? `/${model.id}` : ""}`,
      cwd: bot.cwd ?? (await ensureHome({ botId: bot.id })).path,
      ...(modeId ? { modeId } : {}),
      ...(thinkingId ? { thinkingOptionId: thinkingId } : {}),
    }),
  });
  const features = agentId ? agent?.features ?? [] : featureQuery.data?.features ?? [];
  const featureValues = agentId ? {} : { ...Object.fromEntries(features.map((feature) => [feature.id, feature.value])), ...draft.featureValues };
  const disabled = !host.api || busy || running || (agentId !== null && (!agent || !host.isLocal));
  const change = async (patch: ChatConfig) => {
    if (disabled || saving.current) return;
    if (!agentId) { setDraft((current) => ({ ...current, ...patch })); return; }
    saving.current = true;
    setBusy(true);
    try {
      const result = await configure({ botId: bot.id, agentId, config: patch });
      await host.api!.agents.ref(agentId).refresh();
      if (result.notice) toast.show(result.notice);
    } catch (error) {
      toast.error(`Couldn't change chat settings: ${errorText(error)}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const controls = <>
    <Control colors={colors} icon="Bot" label={providers.isLoading ? "Loading models…" : model?.label ?? modelId ?? "Choose model"} accessibilityLabel="Select model" disabled={disabled || providers.isLoading} onPress={() => setPicking(true)} />
    {modes.length ? <Choice colors={colors} icon="Shield" title="Mode" label={modes.find((entry) => entry.id === modeId)?.label ?? "Mode"} disabled={disabled} options={modes.map((entry) => ({ id: entry.id, label: entry.label }))} value={modeId ?? null} onChange={(modeId) => change({ modeId })} /> : null}
    {thinking.length ? <Choice colors={colors} icon="Brain" title="Thinking" label={thinking.find((entry) => entry.id === thinkingId)?.label ?? "Thinking"} disabled={disabled} options={thinking} value={thinkingId ?? null} onChange={(thinkingOptionId) => change({ thinkingOptionId })} /> : null}
    {features.map((feature) => feature.type === "toggle" ? (
      <Control key={feature.id} colors={colors} icon={feature.id === "auto_accept" ? "ShieldCheck" : "SlidersHorizontal"} label={feature.label} accessibilityLabel={`Toggle ${feature.label}`} selected={Boolean(agentId ? feature.value : featureValues[feature.id])} disabled={disabled} onPress={() => void change({ featureValues: { ...(agentId ? {} : draft.featureValues), [feature.id]: !(agentId ? feature.value : featureValues[feature.id]) } })} />
    ) : <Choice key={feature.id} colors={colors} icon="SlidersHorizontal" title={feature.label} label={`${feature.label}: ${feature.options.find((entry) => entry.id === (agentId ? feature.value : featureValues[feature.id]))?.label ?? "Default"}`} disabled={disabled} options={feature.options} value={(agentId ? feature.value : featureValues[feature.id]) as string | null} onChange={(value) => change({ featureValues: { ...(agentId ? {} : draft.featureValues), [feature.id]: value } })} />)}
    {busy ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : null}
    {picking ? <ModelPicker colors={colors} models={models} selected={modelId ?? model?.id ?? null} loading={providers.isLoading} error={providers.error ? errorText(providers.error) : null} onRetry={() => void providers.refetch()} onClose={() => setPicking(false)} onSelect={(model) => { setPicking(false); void change({ model, ...(!agentId || thinking.length ? { thinkingOptionId: null } : {}), ...(!agentId ? { featureValues: {} } : {}) }); }} /> : null}
  </>;
  return { controls, busy, startConfig: { ...draft, ...(features.length || draft.featureValues ? { featureValues } : {}) } satisfies ChatConfig };
}

function Control({ colors, icon, label, accessibilityLabel, disabled, selected, onPress }: { colors: Colors; icon: string; label: string; accessibilityLabel: string; disabled?: boolean; selected?: boolean; onPress(): void }) {
  const tokens = nativeTokens(colors);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled, ...(selected === undefined ? {} : { selected }) }} disabled={disabled} {...tooltip(label)} onPress={onPress} style={({ pressed }) => ({ minHeight: 28, maxWidth: 310, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 6, borderRadius: 6, opacity: disabled ? 0.5 : 1, backgroundColor: pressed || selected ? tokens.interactionHighlight : "transparent" })}>
    <Icon name={icon} size={14} color={colors.foregroundMuted} />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: ui(12) }}>{label}</Text>
    {selected === undefined ? <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} /> : null}
  </Pressable>;
}

function Choice({ colors, icon, title, label, disabled, options, value, onChange }: { colors: Colors; icon: string; title: string; label: string; disabled: boolean; options: { id: string; label: string }[]; value: string | null; onChange(value: string): Promise<void> }) {
  const anchor = useRef<View>(null);
  const menu = useMenu();
  const open = async () => {
    const rect = await measureAnchor(anchor);
    if (rect) menu.open({ title, anchor: rect, width: 260, entries: options.map((entry) => ({ label: entry.label, selected: entry.id === value, onSelect: () => onChange(entry.id) })) });
  };
  return <View ref={anchor} collapsable={false} style={{ flexShrink: 1 }}><Control colors={colors} icon={icon} label={label} accessibilityLabel={`Select ${title.toLowerCase()}`} disabled={disabled} onPress={() => void open()} /></View>;
}

function ModelPicker({ colors, models, selected, loading, error, onRetry, onClose, onSelect }: { colors: Colors; models: Model[]; selected: string | null; loading: boolean; error: string | null; onRetry(): void; onClose(): void; onSelect(id: string): void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = models.filter((model) => `${model.label} ${model.id} ${model.description ?? ""}`.toLowerCase().includes(query));
  return <Modal title="Choose model" open onOpenChange={(open) => !open && onClose()}>
    <Modal.Content>
      <TextInput accessibilityLabel="Search models" value={search} onChangeText={setSearch} placeholder="Search models…" style={{ color: colors.foreground, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: ui(14) }} />
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 2 }} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
        {error ? <><Text style={{ color: colors.statusDanger, fontSize: ui(14) }}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry}><Text style={{ color: colors.foreground }}>Retry</Text></Pressable></> : null}
        {!loading && !error && filtered.length === 0 ? <Text style={{ padding: 12, color: colors.foregroundMuted }}>No matching models</Text> : null}
        {filtered.map((model) => <Pressable key={model.id} accessibilityRole="button" accessibilityLabel={`Choose ${model.label}`} accessibilityState={{ selected: model.id === selected }} onPress={() => onSelect(model.id)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 6, backgroundColor: pressed || model.id === selected ? colors.surface2 : "transparent" })}>
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.foreground, fontSize: ui(14) }}>{model.label}</Text>{model.description ? <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: ui(12) }}>{model.description}</Text> : null}</View>
          {model.id === selected ? <Icon name="Check" size={16} color={colors.foreground} /> : null}
        </Pressable>)}
      </ScrollView>
    </Modal.Content>
  </Modal>;
}
