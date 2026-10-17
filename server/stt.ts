import { open, readdir, readFile, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { sttStatus, type SttStatus } from "../shared/stt";

const PASEO_HOME = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
const MODELS_DIR = path.join(PASEO_HOME, "models", "local-speech");
const LOG_PATH = path.join(PASEO_HOME, "daemon.log");

type CpuSample = { pid: number; ticks: number };
let lastCpuSample: CpuSample | null = null;

const MS_PER_TICK = 10;
const BUSY_TICKS = 5;

const MODELS: ReadonlyArray<{ id: string; role: string }> = [
  {
    id: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    role: "STT for dictation and voice mode (english-only)",
  },
  { id: "kokoro-en-v0_19", role: "voice TTS" },
  { id: "silero-vad", role: "voice turn detection" },
];

type ModelProbe = SttStatus["models"][number];

type SttTimeline = Pick<
  SttStatus,
  "lastWorkerSpawnSecAgo" | "lastSttStartedSecAgo" | "lastSttProcessingMs" | "lastFinalSecAgo"
>;

type LogLine = {
  time?: number;
  msg?: string;
  latency?: Array<{ type?: string; maxMs?: number }>;
  outboundSessionMessageTypesTop?: Array<[string, number]>;
};

function toSttStatus(
  base: { daemon: boolean; warm: boolean; warmPid: number | null },
  models: ModelProbe[],
  timeline: SttTimeline,
  cpu: { busy: boolean; deltaMs: number | null },
  error: string | null,
): SttStatus {
  return {
    daemon: base.daemon,
    warm: base.warm,
    warmPid: base.warmPid,
    models,
    lastSttStartedSecAgo: timeline.lastSttStartedSecAgo,
    lastSttProcessingMs: timeline.lastSttProcessingMs,
    lastFinalSecAgo: timeline.lastFinalSecAgo,
    lastWorkerSpawnSecAgo: timeline.lastWorkerSpawnSecAgo,
    busy: cpu.busy,
    sttCpuDeltaMs: cpu.deltaMs,
    error,
  };
}

async function findWarmPid(): Promise<number | null> {
  let pids: string[];
  try {
    pids = (await readdir("/proc")).filter((e) => /^\d+$/.test(e));
  } catch {
    return null;
  }

  const hits = await Promise.all(
    pids.map(async (pid): Promise<number | null> => {
      try {
        const comm = (await readFile(`/proc/${pid}/comm`, "utf8")).trim().toLowerCase();
        if (comm === "paseo voice") {
          return Number(pid);
        }
        const cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8"))
          .split("\0")
          .join(" ")
          .toLowerCase();
        return cmdline.includes("paseo voice") ? Number(pid) : null;
      } catch {
        return null;
      }
    }),
  );
  return hits.find((pid): pid is number => pid !== null) ?? null;
}

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
          const s = await stat(full).catch(() => null);
          if (s !== null) {
            total += s.size;
            counted = true;
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
    return counted && total > 0 ? Math.round((total / (1024 * 1024)) * 10) / 10 : null;
  }
}

async function readLogTimeline(now: number): Promise<SttTimeline> {
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
      if (
        msg === "Local speech worker spawned" &&
        lastSpawn === null &&
        typeof j.time === "number"
      ) {
        lastSpawn = j.time;
      }
      if (msg === "ws_runtime_metrics") {
        if (lastFinal === null && typeof j.time === "number") {
          const hasFinal = (j.outboundSessionMessageTypesTop ?? []).some(
            ([t]) => t === "dictation_stream_final",
          );
          if (hasFinal) {
            lastFinal = j.time;
          }
        }
        if (lastStart === null && typeof j.time === "number") {
          for (const e of j.latency ?? []) {
            if (e.type === "dictation_stream_start" && typeof e.maxMs === "number") {
              lastStart = { at: j.time, ms: e.maxMs };
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
      lastSttStartedSecAgo: sec(lastStart?.at ?? null),
      lastSttProcessingMs: lastStart?.ms ?? null,
      lastFinalSecAgo: sec(lastFinal),
    };
  } catch {
    return {
      lastWorkerSpawnSecAgo: null,
      lastSttStartedSecAgo: null,
      lastSttProcessingMs: null,
      lastFinalSecAgo: null,
    };
  } finally {
    if (fh) {
      await fh.close().catch(() => undefined);
    }
  }
}

async function workerCpuTicks(pid: number): Promise<number | null> {
  try {
    const raw = (await readFile(`/proc/${pid}/stat`, "utf8")).trimEnd();
    const closeIdx = raw.lastIndexOf(")");
    if (closeIdx === -1) {
      return null;
    }
    const fields = raw.slice(closeIdx + 2).split(" ");
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
      return null;
    }
    return utime + stime;
  } catch {
    return null;
  }
}

async function sampleWorkerCpu(
  warmPid: number | null,
): Promise<{ busy: boolean; deltaMs: number | null }> {
  if (warmPid === null) {
    lastCpuSample = null;
    return { busy: false, deltaMs: null };
  }
  const ticks = await workerCpuTicks(warmPid);
  if (ticks === null) {
    lastCpuSample = null;
    return { busy: false, deltaMs: null };
  }
  const prev = lastCpuSample !== null && lastCpuSample.pid === warmPid ? lastCpuSample : null;
  lastCpuSample = { pid: warmPid, ticks };

  if (prev === null) {
    return { busy: false, deltaMs: null };
  }
  const deltaTicks = ticks - prev.ticks;
  return {
    busy: deltaTicks >= BUSY_TICKS,
    deltaMs: Math.max(0, deltaTicks) * MS_PER_TICK,
  };
}

function emptyTimeline(): SttTimeline {
  return {
    lastWorkerSpawnSecAgo: null,
    lastSttStartedSecAgo: null,
    lastSttProcessingMs: null,
    lastFinalSecAgo: null,
  };
}

export async function getSttStatus(_input: RpcInput<typeof sttStatus>): Promise<SttStatus> {
  const now = Date.now();
  try {
    const warmPid = await findWarmPid();
    const [models, timeline, cpu] = await Promise.all([
      probeModels(),
      readLogTimeline(now),
      sampleWorkerCpu(warmPid),
    ]);
    return toSttStatus(
      { daemon: true, warm: warmPid !== null, warmPid },
      models,
      timeline,
      cpu,
      null,
    );
  } catch (e) {
    lastCpuSample = null;
    return toSttStatus(
      { daemon: true, warm: false, warmPid: null },
      [],
      emptyTimeline(),
      { busy: false, deltaMs: null },
      e instanceof Error ? e.message : String(e),
    );
  }
}
