import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { sttStatus, type SttStatus } from "../shared/stt";

export type Poll = ReturnType<typeof useSttPoll>;

export function useSttPoll(fast: boolean) {
  const call = useRpc(sttStatus);
  return useQuery({
    queryKey: ["stt-status", fast],
    queryFn: () => call({}),
    refetchInterval: fast ? 500 : 1000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 1000,
  });
}

export type EngineState = {
  key: "warm" | "cooling" | "cold" | "busy" | "unknown" | "error";
  label: string;
  detail: string;
};

export function engineState(
  data: SttStatus | undefined,
  isLoading: boolean,
  isError: boolean,
): EngineState {
  if (isError) {
    return {
      key: "error",
      label: "unreachable",
      detail: "The daemon did not answer the status request.",
    };
  }
  if (data === undefined) {
    return {
      key: "unknown",
      label: isLoading ? "checking…" : "unknown",
      detail: "Waiting for the first status response.",
    };
  }
  if (data.error) {
    return { key: "unknown", label: "unknown", detail: data.error };
  }
  if (data.busy) {
    return {
      key: "busy",
      label: "transcribing",
      detail: `Speech worker is decoding audio (${data.sttCpuDeltaMs ?? 0}ms CPU since last check).`,
    };
  }
  if (data.warm) {
    return {
      key: "warm",
      label: "warm",
      detail: "Speech worker (Paseo Voice) is running — your voice reaches the model instantly.",
    };
  }
  const justUsed = data.lastFinalSecAgo !== null && data.lastFinalSecAgo < 60;
  if (justUsed) {
    return {
      key: "cooling",
      label: "cooling",
      detail: `A transcript finished ${data.lastFinalSecAgo}s ago; Paseo releases the model shortly after each burst.`,
    };
  }
  const slowLoad = data.lastSttProcessingMs !== null && data.lastSttProcessingMs > 3000;
  return {
    key: "cold",
    label: "cold",
    detail:
      (slowLoad ? `Last cold start took ${(data.lastSttProcessingMs ?? 0) / 1000}s. ` : "") +
      "Speak a throwaway word to warm up.",
  };
}

export function agoLine(sec: number | null | undefined, noun: string): string {
  if (sec === null || sec === undefined) {
    return `${noun}: never`;
  }
  if (sec < 60) {
    return `${noun}: ${sec}s ago`;
  }
  return `${noun}: ${Math.floor(sec / 60)}m ${sec % 60}s ago`;
}
