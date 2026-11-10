import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { nativeTokens } from "../native";
import { ui } from "../typography";

type Colors = PluginTheme["colors"];

/** The buttons under a proposal or sign-in card (agent-stream/view.tsx PermissionRequestCard). */
export function CardButton({ colors, label, icon, primary = false, busy = false, spinning = false, onPress }: { colors: Colors; label: string; icon: string; primary?: boolean; busy?: boolean; spinning?: boolean; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  const tint = primary ? colors.foreground : colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: "center",
        borderWidth: 1,
        backgroundColor: hovered ? colors.surface2 : colors.surface1,
        borderColor: nativeTokens(colors).borderAccent,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {spinning ? (
        <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={tint} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={14} color={tint} />
          <Text style={{ fontSize: ui(14), color: tint }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
