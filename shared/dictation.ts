import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const dictationStatus = defineRpc({
  name: "dictation.status",
  input: z.object({}).strict(),
  output: z.object({
    daemon: z.boolean(),
    warm: z.boolean(),
    warmPid: z.number().nullable(),
    models: z.array(
      z.object({
        id: z.string(),
        role: z.string(),
        present: z.boolean(),
        sizeMB: z.number().nullable(),
      }),
    ),
    lastDictationStartedSecAgo: z.number().nullable(),
    lastDictationProcessingMs: z.number().nullable(),
    lastFinalSecAgo: z.number().nullable(),
    lastWorkerSpawnSecAgo: z.number().nullable(),
    busy: z.boolean(),
    sttCpuDeltaMs: z.number().nullable(),
    error: z.string().nullable(),
  }),
});

export type DictationStatus = z.infer<typeof dictationStatus.output>;
