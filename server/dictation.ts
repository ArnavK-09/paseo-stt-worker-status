import { open, readdir, readFile, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { dictationStatus, type DictationStatus } from "../shared/dictation";

const PASEO_HOME = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
const MODELS_DIR = path.join(PASEO_HOME, "models", "local-speech");
const LOG_PATH = path.join(PASEO_HOME, "daemon.log");

/**
 * "Transcribing" detector: Linux accounting ticks of the Paseo Voice process.
 * At idle the worker burns exactly 0 ticks (verified live), while decoding a
 * Parakeet utterance spikes hard — so even 5 ticks (>50ms) since the previous
 * status poll means real work just happened or is happening right now.
 */
type CpuSample = { pid: number; ticks: number; atMs: number };
let lastCpuSample: CpuSample | null = null;

/** CLK_TCK is 100 on every modern Linux baseline; 1 tick = 10ms. */
const MS_PER_TICK = 10;
/** Any real decode easily tops 100ms of CPU; 5 ticks keeps false positives at zero. */
const BUSY_TICKS = 5;

const MODELS: ReadonlyArray<{ id: string; role: string }> = [
  { id: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", role: "dictation / voice STT (english-only)" },
  { id: "kokoro-en-v0_19", role: "voice TTS" },
  { id: "silero-vad", role: "voice turn detection" },
];

type ModelProbe = DictationStatus["models"][number];

/** Warm = the "Paseo Voice" speech worker process is alive. */
async function findWarmPid(): Promise<number | null> {
  let pids: string[];
  try {
    pids = (await readdir("/proc")).filter((e) => /^\d+$/.test(e));
  } catch {
    return null;
  }

  // The speech worker's comm is "Paseo Voice". /proc/<pid>/comm is the cheapest
  // source; test comm exactly, then fall back to a cmdline substring check.
  const hits = await Promise.all(
    pids.map(async (pid): Promise<number | null> => {
      try {
        const comm = (await readFile(`/proc/${pid}/comm`, "utf8")).trim().toLowerCase();
        if (comm === "paseo voice") {
          return Number(pid);
        }
        const cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").join(" ").toLowerCase();
        return cmdline.includes("paseo voice") ? Number(pid) : null;
      } catch {
        return null;
      }
    }),
  );
  return hits.find((pid): pid is number => pid !== null) ?? null;
}

/** Present = directory exists and contains at least one real file (not a stub). */
async function probeModels(): Promise<ModelProbe[]> {
  return Promise.all(
    MODELS.map(async (m): Promise<ModelProbe> => {
      try {
        const dir = path.join(MODELS_DIR, m.id);
        const entries = await readdir(dir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile()).length;
        const dirs = entries.filter((e) => e.isDirectory()).length;
        const sizeMB = dirs + files > 0 ? await dirSizeMB(dir) : null;
        return { id: m.id, role: m.role, present: files > 0 || dirs > 1, sizeMB };
      } catch {
        return { id: m.id, role: m.role, present: false, sizeMB: null };
      }
    }),
  );
}

async function dirSizeMB(dir: string): Promise<number | null> {
  let total = 0;
  let counted = false;
  const walk = async (d: string, depth: number): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true });
    await Promise.all(
      entries.map(async (e) => {
        const full = path.join(d, e.name);
        if (e.isFile()) {
          try {
            const s = await stat(full);
            total += s.size;
            counted = true;
          } catch {
            // vanished while summing; ignore
          }
        } else if (e.isDirectory() && depth < 3) {
          await walk(full, depth + 1);
        }
      }),
    );
  };
  try {
    await walk(dir, 0);
    return counted ? Math.round((total / (1024 * 1024)) * 10) / 10 : null;
  } catch {
    return null;
  }
}

type Timeline = Pick<
  DictationStatus,
  "lastWorkerSpawnSecAgo" | "lastDictationStartedSecAgo" | "lastDictationProcessingMs" | "lastFinalSecAgo"
>;

type LogLine = {
  time?: number;
  msg?: string;
  latency?: Array<{ type?: string; maxMs?: number }>;
  outboundSessionMessageTypesTop?: Array<[string, number]>;
};

/** Parse the daemon log tail for the last dictation lifecycle events. */
async function readLogTimeline(now: number): Promise<Timeline> {
  let fh: FileHandle | null = null;
  try {
    const s = await stat(LOG_PATH);
    const len = Math.min(s.size, 512 * 1024);
    fh = await open(LOG_PATH, "r");
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, s.size - len);
    const lines = buf.toString("utf8").split("\n");
    const scan = Math.min(lines.length, 4000);

    let lastSpawn: number | null = null;
    let lastStart: { at: number; ms: number } | null = null;
    let lastFinal: number | null = null;

    for (let i = lines.length - 1; i >= lines.length - scan && i >= 0; i--) {
      let j: LogLine;
      try {
        j = JSON.parse(lines[i]) as LogLine;
      } catch {
        continue;
      }
      const msg = j.msg ?? "";
      if (msg === "Local speech worker spawned" && lastSpawn === null && typeof j.time === "number") {
        lastSpawn = j.time;
      }
      if (msg === "ws_runtime_metrics") {
        if (lastFinal === null && typeof j.time === "number") {
          const hasFinal = (j.outboundSessionMessageTypesTop ?? []).some(([t]) => t === "dictation_stream_final");
          if (hasFinal) {
            lastFinal = j.time;
          }
        }
        if (lastStart === null && typeof j.time === "number") {
          for (const e of j.latency ?? []) {
            if (e.type === "dictation_stream_start" && typeof e.maxMs === "number") {
              lastStart = { at: j.time as number, ms: e.maxMs };
            }
          }
        }
      }
      if (lastSpawn !== null && lastStart !== null && lastFinal !== null) {
        break;
      }
    }

    const sec = (ts: number | null | undefined): number | null =>
      typeof ts !== "number" ? null : Math.max(0, Math.round((now - ts) / 1000));

    return {
      lastWorkerSpawnSecAgo: sec(lastSpawn),
      lastDictationStartedSecAgo: sec(lastStart?.at ?? null),
      lastDictationProcessingMs: lastStart?.ms ?? null,
      lastFinalSecAgo: sec(lastFinal),
    };
  } catch {
    return {
      lastWorkerSpawnSecAgo: null,
      lastDictationStartedSecAgo: null,
      lastDictationProcessingMs: null,
      lastFinalSecAgo: null,
    };
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** Reads utime+stime (fields 14/15) of /proc/<pid>/stat. */
async function workerCpuTicks(pid: number): Promise<number | null> {
  try {
    const parts = (await readFile(`/proc/${pid}/stat`, "utf8")).split(" ");
    return Number(parts[13]) + Number(parts[14]);
  } catch {
    return null;
  }
}

/**
 * Returns the CPU burned by the speech worker since the previous status call
 * (same pid only), and updates the stored sample. Always samples when the
 * worker exists, so short spikes between polls are still caught.
 */
async function sampleWorkerCpu(
  warmPid: number | null,
  now: number,
): Promise<{ busyStt: boolean; deltaMs: number | null }> {
  if (warmPid === null) {
    lastCpuSample = null;
    return { busyStt: false, deltaMs: null };
  }
  const ticks = await workerCpuTicks(warmPid);
  if (ticks === null) {
    lastCpuSample = null;
    return { busyStt: false, deltaMs: null };
  }
  const prev = lastCpuSample !== null && lastCpuSample.pid === warmPid ? lastCpuSample : null;
  lastCpuSample = { pid: warmPid, ticks, atMs: now };

  if (prev === null) {
    return { busyStt: false, deltaMs: null };
  }
  const deltaTicks = ticks - prev.ticks;
  return {
    busyStt: deltaTicks >= BUSY_TICKS,
    deltaMs: deltaTicks * MS_PER_TICK,
  };
}

export async function getDictationStatus(_input: RpcInput<typeof dictationStatus>): Promise<DictationStatus> {
  try {
    const now = Date.now();
    const warmPid = await findWarmPid();
    const [models, timeline, cpu] = await Promise.all([
      probeModels(),
      readLogTimeline(now),
      sampleWorkerCpu(warmPid, now),
    ]);
    return {
      daemon: true,
      warm: warmPid !== null,
      warmPid,
      models,
      ...timeline,
      busy: cpu.busyStt,
      sttCpuDeltaMs: cpu.deltaMs,
      error: null,
    };
  } catch (e) {
    lastCpuSample = null;
    return {
      daemon: true,
      warm: false,
      warmPid: null,
      models: [],
      lastWorkerSpawnSecAgo: null,
      lastDictationStartedSecAgo: null,
      lastDictationProcessingMs: null,
      lastFinalSecAgo: null,
      busy: false,
      sttCpuDeltaMs: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
