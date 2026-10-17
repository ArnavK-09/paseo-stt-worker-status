import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { agoLine, engineState, useSttPoll } from "./use-stt";

export function SttDetailScreen({ theme, layout }: PluginScreenProps) {
  const query = useSttPoll(true);
  const state = engineState(query.data, query.isLoading, query.isError);
  const d = query.data;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1 as const,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 16 : 24,
        gap: 16,
      },
      card: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 12,
        padding: 14,
        gap: 6,
      },
      headline: {
        color: theme.colors.foreground,
        fontSize: 20,
        fontWeight: "800" as const,
        textTransform: "uppercase" as const,
      },
      title: { color: theme.colors.foreground, fontWeight: "700" as const, fontSize: 14 },
      body: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      modelRow: { gap: 2, marginTop: 8 },
      retry: {
        backgroundColor: theme.colors.accent,
        borderRadius: 8,
        padding: 10,
        alignSelf: "flex-start" as const,
      },
      retryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme, layout.compact],
  );

  const models = d?.models ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={styles.screen}
    >
      <View style={styles.card}>
        <Text style={styles.headline}>{state.label}</Text>
        <Text style={styles.body}>{state.detail}</Text>
        {d?.warmPid !== null && d?.warmPid !== undefined ? (
          <Text style={styles.muted}>Speech worker running: pid {d.warmPid} ("Paseo Voice")</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Lifecycle (local Parakeet STT)</Text>
        <Text style={styles.muted}>
          Paseo spawns the speech worker ("Paseo Voice") when you first use your voice in dictation
          or voice mode, loads ~630 MB of Parakeet weights on its first stream (~10 s), and keeps it
          for fast reuse. A first utterance right after a daemon restart can be swallowed — speak a
          throwaway word to warm up.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Recent activity</Text>
        <Text style={styles.body}>{agoLine(d?.lastWorkerSpawnSecAgo, "last worker spawn")}</Text>
        <Text style={styles.body}>{agoLine(d?.lastSttStartedSecAgo, "last STT start")}</Text>
        {d?.lastSttProcessingMs !== null && d?.lastSttProcessingMs !== undefined ? (
          <Text style={styles.body}>
            its start request took {(d.lastSttProcessingMs / 1000).toFixed(1)}s
          </Text>
        ) : null}
        <Text style={styles.body}>{agoLine(d?.lastFinalSecAgo, "last finished transcript")}</Text>
        {d?.sttCpuDeltaMs !== null && d?.sttCpuDeltaMs !== undefined && d.sttCpuDeltaMs > 0 ? (
          <Text style={styles.body}>speech worker CPU since last check: {d.sttCpuDeltaMs}ms</Text>
        ) : null}
        <Text style={styles.muted}>
          Source: host daemon.log tail + /proc process probing; refreshed live.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>
          Local models ({models.filter((m) => m.present).length}/{models.length} ready)
        </Text>
        {models.map((m) => (
          <View key={m.id} style={styles.modelRow}>
            <Text style={styles.body}>
              {m.present ? "✓" : "✗"} {m.id}
              {m.sizeMB !== null ? ` — ${m.sizeMB} MB` : ""}
            </Text>
            <Text style={styles.muted}>{m.role}</Text>
          </View>
        ))}
        {models.length === 0 ? (
          <Text style={styles.muted}>No model inventory available right now.</Text>
        ) : null}
      </View>

      {query.isError ? (
        <View style={styles.card}>
          <Text style={styles.body}>Status request failed: {String(query.error)}</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.retry}
            onPress={() => query.refetch()}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
