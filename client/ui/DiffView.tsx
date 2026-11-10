import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Platform, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { parseUnifiedDiff, type DiffLine } from "../../shared/diff";
import { MONO_FONT, MONO_PROPS } from "../native";
import { code } from "../typography";

type Colors = PluginTheme["colors"];

// Paseo's DiffViewer (components/tool-call-details.tsx): a full-bleed code surface that
// scrolls both ways, added lines green and removed lines red.
const PAD = 12;
const CODE_LINE = 18;

function lineBox(colors: Colors, line: DiffLine): ViewStyle {
  if (line.type === "add") return { backgroundColor: "rgba(46, 160, 67, 0.15)" };
  if (line.type === "remove") return { backgroundColor: "rgba(248, 81, 73, 0.1)" };
  return { backgroundColor: colors.surface1 };
}

/** A unified diff, e.g. a memory file's change. */
export function DiffView({ colors, diff, maxHeight = 420 }: { colors: Colors; diff: string; maxHeight?: number }) {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const mono: TextStyle = {
    fontFamily: MONO_FONT,
    fontSize: code(),
    lineHeight: CODE_LINE,
    ...(Platform.OS === "web" ? ({ whiteSpace: "pre", overflowWrap: "normal" } as TextStyle) : {}),
  };
  if (lines.length === 0) return null;
  return (
    <View style={{ backgroundColor: colors.surface1, overflow: "hidden", borderRadius: 4 }}>
      <ScrollView style={{ maxHeight }} contentContainerStyle={{ flexGrow: 1, paddingBottom: PAD }} nestedScrollEnabled showsVerticalScrollIndicator>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: "column", paddingRight: 16 }}>
          <View style={{ alignSelf: "flex-start", padding: PAD }}>
            {lines.map((line, index) => (
              <View key={index} style={[{ minWidth: "100%", paddingVertical: 4 }, lineBox(colors, line)]}>
                <Text selectable {...MONO_PROPS} style={[mono, { color: line.type === "add" || line.type === "remove" ? colors.foreground : colors.foregroundMuted }]}>
                  {line.content}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
