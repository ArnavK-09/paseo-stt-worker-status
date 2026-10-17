import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { agoLine, engineState, useSttPoll, type EngineState } from "./use-stt";

const DOT_SIZE = 10;

function Dot({ color }: { color: string }) {
  return (
    <View
      style={{
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        backgroundColor: color,
      }}
    />
  );
}

function stateColor(key: EngineState["key"]): string {
  switch (key) {
    case "warm":
      return "#2fbf71";
    case "busy":
      return "#7b6cff";
    case "cold":
      return "#8a8f98";
    default:
      return "#e5484d";
  }
}

export function SttFooterItem({ openPopover }: PluginSidebarItemProps) {
  const query = useSttPoll(false);
  const state = engineState(query.data, query.isLoading, query.isError);
  return (
    <SidebarRow
      icon="AudioLines"
      label={`Speech · ${state.label}`}
      onPress={() => openPopover(SttPopover)}
      trailing={<Dot color={stateColor(state.key)} />}
    />
  );
}

export function SttPopover({ theme, openScreen }: PluginPopoverProps) {
  const query = useSttPoll(true);
  const state = engineState(query.data, query.isLoading, query.isError);
  const color = stateColor(state.key);
  const styles = useMemo(
    () => ({
      root: { gap: 8, padding: 12, minWidth: 260, maxWidth: 320 },
      row: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      stateLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      stateLabel: {
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "700" as const,
        textTransform: "uppercase" as const,
      },
      open: {
        marginTop: 6,
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        alignSelf: "flex-start" as const,
      },
      openText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme],
  );

  const d = query.data;
  return (
    <View style={styles.root}>
      <View style={styles.stateLine}>
        <Dot color={color} />
        <Text style={styles.stateLabel}>{state.label}</Text>
      </View>
      <Text style={styles.muted}>{state.detail}</Text>
      <Text style={styles.row}>{agoLine(d?.lastSttStartedSecAgo, "last STT start")}</Text>
      <Text style={styles.row}>{agoLine(d?.lastFinalSecAgo, "last finished transcript")}</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.open}
        onPress={() => openScreen({ screenId: "details" })}
      >
        <Text style={styles.openText}>Open full view</Text>
      </Pressable>
    </View>
  );
}
