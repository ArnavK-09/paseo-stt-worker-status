import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RpcInput } from "@getpaseo/plugin";
import { sttStatus, type SttStatus } from "../shared/stt";

const execFileAsync = promisify(execFile);

const PASEO_HOME = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
const MODELS_DIR = path.join(PASEO_HOME, "models", "local-speech");
const LOG_PATH = path.join(PASEO_HOME, "daemon.log");

const OS = platform();
const PROBE_TIMEOUT_MS = 2000;
const WATCHER_RETRY_MS = 30000;
const LOG_TAIL_BYTES = 512 * 1024;
const LOG_DELTA_RESEED_BYTES = 2 * LOG_TAIL_BYTES;
const COLD_SCAN_TTL_MS = 5000;
const MODELS_TTL_MS = 60000;
const TIMELINE_SCAN_MAX_LINES = 4000;

type CpuSample = { pid: number; cpuMs: number };
let lastCpuSample: CpuSample | null = null;

const BUSY_DELTA_MS = 50;

type WarmCache = { pid: number | null; fullScanAt: number };
let warmCache: WarmCache | null = null;

type TimelineSnapshot = {
  spawnAt: number | null;
  startAt: number | null;
  startMs: number | null;
  finalAt: number | null;
};

type TimelineCache = TimelineSnapshot & { size: number; aligned: boolean };
let timelineCache: TimelineCache = {
  spawnAt: null,
  startAt: null,
  startMs: null,
  finalAt: null,
  size: 0,
  aligned: true,
};

type ModelProbe = SttStatus["models"][number];
let modelsCache: { probes: ModelProbe[]; checkedAt: number } | null = null;

const MODELS: ReadonlyArray<{ id: string; role: string }> = [
  {
    id: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    role: "STT for dictation and voice mode (english-only)",
  },
  { id: "kokoro-en-v0_19", role: "voice TTS" },
  { id: "silero-vad", role: "voice turn detection" },
];

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

function timelineToState(t: TimelineSnapshot, now: number): SttTimeline {
  const sec = (ts: number | null): number | null =>
    ts === null ? null : Math.max(0, Math.round((now - ts) / 1000));
  return {
    lastWorkerSpawnSecAgo: sec(t.spawnAt),
    lastSttStartedSecAgo: sec(t.startAt),
    lastSttProcessingMs: (t.startAt !== null ? t.startMs : null) ?? null,
    lastFinalSecAgo: sec(t.finalAt),
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

function absorbLogLine(line: string): void {
  if (
    line.indexOf("ws_runtime_metrics") === -1 &&
    line.indexOf("Local speech worker spawned") === -1
  ) {
    return;
  }
  let j: LogLine;
  try {
    j = JSON.parse(line) as LogLine;
  } catch {
    return;
  }
  const t = j.time;
  if (typeof t !== "number") {
    return;
  }
  const msg = j.msg ?? "";
  if (msg === "Local speech worker spawned") {
    if (timelineCache.spawnAt === null || t >= timelineCache.spawnAt) {
      timelineCache.spawnAt = t;
    }
  }
  if (msg !== "ws_runtime_metrics") {
    return;
  }
  for (const e of j.latency ?? []) {
    if (e.type === "dictation_stream_start" && typeof e.maxMs === "number") {
      if (timelineCache.startAt === null || t >= timelineCache.startAt) {
        timelineCache.startAt = t;
        timelineCache.startMs = e.maxMs;
      }
    }
  }
  const hasFinal = (j.outboundSessionMessageTypesTop ?? []).some(
    ([type]) => type === "dictation_stream_final",
  );
  if (hasFinal) {
    if (timelineCache.finalAt === null || t >= timelineCache.finalAt) {
      timelineCache.finalAt = t;
    }
  }
}

function scanLines(lines: string[]): void {
  const scanCount = Math.min(lines.length, TIMELINE_SCAN_MAX_LINES);
  for (let i = lines.length - scanCount; i < lines.length; i++) {
    absorbLogLine(lines[i]);
  }
}

async function readLogChunk(from: number, to: number): Promise<string> {
  const fh: FileHandle = await open(LOG_PATH, "r");
  try {
    const buf = Buffer.alloc(to - from);
    await fh.read(buf, 0, buf.length, from);
    return buf.toString("utf8");
  } finally {
    await fh.close().catch(() => undefined);
  }
}

async function refreshTimeline(): Promise<void> {
  let size: number;
  try {
    size = (await stat(LOG_PATH)).size;
  } catch {
    timelineCache = {
      spawnAt: null,
      startAt: null,
      startMs: null,
      finalAt: null,
      size: 0,
      aligned: true,
    };
    return;
  }
  if (size === timelineCache.size) {
    return;
  }
  try {
    const isReseed =
      timelineCache.size === 0 ||
      size < timelineCache.size ||
      size - timelineCache.size > LOG_DELTA_RESEED_BYTES;
    const from = isReseed ? Math.max(0, size - LOG_TAIL_BYTES) : timelineCache.size;
    const raw = await readLogChunk(from, size);

    if (isReseed) {
      timelineCache = {
        spawnAt: null,
        startAt: null,
        startMs: null,
        finalAt: null,
        size,
        aligned: false,
      };
    }

    let skip = 0;
    if (!timelineCache.aligned) {
      const firstNl = raw.indexOf("\n");
      if (firstNl === -1) {
        return;
      }
      skip = firstNl + 1;
      timelineCache.aligned = true;
    }
    const rest = raw.slice(skip);
    const lastNl = rest.lastIndexOf("\n");
    if (lastNl === -1) {
      return;
    }
    scanLines(rest.slice(0, lastNl).split("\n"));
    timelineCache.size = from + skip + lastNl + 1;
  } catch {
    timelineCache = {
      spawnAt: null,
      startAt: null,
      startMs: null,
      finalAt: null,
      size: 0,
      aligned: true,
    };
  }
}

function timelineSnapshot(): TimelineSnapshot {
  return {
    spawnAt: timelineCache.spawnAt,
    startAt: timelineCache.startAt,
    startMs: timelineCache.startMs,
    finalAt: timelineCache.finalAt,
  };
}

let logWatcher: FSWatcher | null = null;
let logWatchInode: number | null = null;
let watcherDeadAt: number | null = null;
let refreshChain: Promise<void> = Promise.resolve();

function refreshSerialized(): Promise<void> {
  refreshChain = refreshChain.then(refreshTimeline).catch(() => undefined);
  return refreshChain;
}

function detachLogWatcher(): void {
  if (logWatcher !== null) {
    logWatcher.close();
    logWatcher = null;
  }
  logWatchInode = null;
}

function attachLogWatcher(): void {
  if (logWatcher !== null) {
    return;
  }
  try {
    const w = watch(LOG_PATH, { persistent: false }, (eventType: "rename" | "change") => {
      void refreshSerialized();
      if (eventType === "rename") {
        void stat(LOG_PATH)
          .then((s) => {
            if (logWatcher !== null && logWatchInode !== null && s.ino !== logWatchInode) {
              detachLogWatcher();
              attachLogWatcher();
            }
          })
          .catch(() => undefined);
      }
    });
    w.on("error", () => {
      detachLogWatcher();
      watcherDeadAt = Date.now();
    });
    w.unref();
    logWatcher = w;
    void stat(LOG_PATH)
      .then((s) => {
        logWatchInode = s.ino;
      })
      .catch(() => undefined);
  } catch {
    watcherDeadAt = Date.now();
  }
}

function ensureLogWatcher(now: number): void {
  if (logWatcher !== null) {
    return;
  }
  if (watcherDeadAt !== null && now - watcherDeadAt < WATCHER_RETRY_MS) {
    return;
  }
  attachLogWatcher();
}

export function startSttCacheWatcher(): () => void {
  attachLogWatcher();
  const watcher = logWatcher;
  return () => {
    if (logWatcher === watcher) {
      detachLogWatcher();
    }
  };
}

async function readComm(pid: number): Promise<string | null> {
  try {
    return (await readFile(`/proc/${pid}/comm`, "utf8")).trim().toLowerCase();
  } catch {
    return null;
  }
}

async function findWarmPidLinux(): Promise<number | null> {
  let pids: string[];
  try {
    pids = (await readdir("/proc")).filter((e) => /^\d+$/.test(e));
  } catch {
    return null;
  }
  const pidNumbers = pids.map(Number);
  const comms = await Promise.all(pidNumbers.map((pid) => readComm(pid)));
  const hit = comms.findIndex((comm) => comm === "paseo voice");
  if (hit !== -1) {
    return pidNumbers[hit];
  }
  const cmdlines = await Promise.all(
    pidNumbers.map((pid) =>
      readFile(`/proc/${pid}/cmdline`, "utf8")
        .then((cmdline) =>
          cmdline.split("\0").join(" ").toLowerCase().includes("paseo voice") ? pid : null,
        )
        .catch(() => null),
    ),
  );
  return cmdlines.find((pid): pid is number => pid !== null) ?? null;
}

async function findWarmPidDarwin(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", "Paseo Voice"], {
      timeout: PROBE_TIMEOUT_MS,
    });
    const pid = Number(stdout.split("\n")[0]?.trim() ?? "");
    if (Number.isFinite(pid) && pid > 0) {
      return pid;
    }
    return null;
  } catch {
    return darwinPidFromPs();
  }
}

async function darwinPidFromPs(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm="], {
      timeout: PROBE_TIMEOUT_MS,
    });
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (match && match[2].toLowerCase().includes("paseo voice")) {
        return Number(match[1]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fullScanForWarmPid(): Promise<number | null> {
  if (OS === "linux") {
    return findWarmPidLinux();
  }
  if (OS === "darwin") {
    return findWarmPidDarwin();
  }
  return null;
}

async function validateCachedPid(pid: number): Promise<boolean> {
  if (OS === "linux") {
    return (await readComm(pid)) === "paseo voice";
  }
  if (OS === "darwin") {
    try {
      const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], {
        timeout: PROBE_TIMEOUT_MS,
      });
      return stdout.trim().toLowerCase().includes("paseo voice");
    } catch {
      return false;
    }
  }
  return false;
}

function spawnSeenSince(at: number): boolean {
  return timelineCache.spawnAt !== null && timelineCache.spawnAt > at;
}

async function findWarmPid(now: number): Promise<number | null> {
  if (warmCache !== null) {
    if (warmCache.pid !== null && (await validateCachedPid(warmCache.pid))) {
      return warmCache.pid;
    }
    if (now - warmCache.fullScanAt < COLD_SCAN_TTL_MS && !spawnSeenSince(warmCache.fullScanAt)) {
      if (warmCache.pid !== null) {
        warmCache = { pid: null, fullScanAt: warmCache.fullScanAt };
      }
      return null;
    }
  }
  const pid = await fullScanForWarmPid();
  warmCache = { pid, fullScanAt: now };
  return pid;
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

async function probeModelsCached(now: number): Promise<ModelProbe[]> {
  if (modelsCache !== null && now - modelsCache.checkedAt < MODELS_TTL_MS) {
    return modelsCache.probes;
  }
  const probes = await probeModels();
  modelsCache = { probes, checkedAt: now };
  return probes;
}

function parsePsCpuTimeMs(raw: string): number | null {
  const value = raw.trim();
  const dashIdx = value.indexOf("-");
  const clock = dashIdx !== -1 ? value.slice(dashIdx + 1) : value;
  const parts = clock.split(":");
  if (parts.length < 2) {
    return null;
  }
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const segment = Number(parts[i]);
    if (!Number.isFinite(segment) || segment < 0) {
      return null;
    }
    if (i === parts.length - 1) {
      seconds += segment;
    } else {
      seconds += segment * 60 ** (parts.length - 1 - i);
    }
  }
  return Math.round(seconds * 1000);
}

async function workerCpuCumulativeMs(pid: number): Promise<number | null> {
  if (OS === "linux") {
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
      return (utime + stime) * 10;
    } catch {
      return null;
    }
  }
  if (OS === "darwin") {
    try {
      const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "time="], {
        timeout: PROBE_TIMEOUT_MS,
      });
      return parsePsCpuTimeMs(stdout);
    } catch {
      return null;
    }
  }
  return null;
}

async function sampleWorkerCpu(
  warmPid: number | null,
): Promise<{ busy: boolean; deltaMs: number | null }> {
  if (warmPid === null) {
    lastCpuSample = null;
    return { busy: false, deltaMs: null };
  }
  const cpuMs = await workerCpuCumulativeMs(warmPid);
  if (cpuMs === null) {
    lastCpuSample = null;
    return { busy: false, deltaMs: null };
  }
  const prev = lastCpuSample !== null && lastCpuSample.pid === warmPid ? lastCpuSample : null;
  lastCpuSample = { pid: warmPid, cpuMs };

  if (prev === null) {
    return { busy: false, deltaMs: null };
  }
  const delta = Math.max(0, cpuMs - prev.cpuMs);
  return {
    busy: delta >= BUSY_DELTA_MS,
    deltaMs: delta,
  };
}

export async function getSttStatus(_input: RpcInput<typeof sttStatus>): Promise<SttStatus> {
  const now = Date.now();
  if (OS !== "linux" && OS !== "darwin") {
    return toSttStatus(
      { daemon: true, warm: false, warmPid: null },
      [],
      emptyTimeline(),
      { busy: false, deltaMs: null },
      "Live worker probing supports Linux and macOS only; this host shows no warm/cold state.",
    );
  }
  ensureLogWatcher(now);
  try {
    const [models] = await Promise.all([probeModelsCached(now), refreshSerialized()]);
    const timeline = timelineToState(timelineSnapshot(), now);
    const warmPid = await findWarmPid(now);
    const cpu = await sampleWorkerCpu(warmPid);
    return toSttStatus(
      { daemon: true, warm: warmPid !== null, warmPid },
      models,
      timeline,
      cpu,
      null,
    );
  } catch (e) {
    lastCpuSample = null;
    warmCache = null;
    return toSttStatus(
      { daemon: true, warm: false, warmPid: null },
      modelsCache?.probes ?? [],
      emptyTimeline(),
      { busy: false, deltaMs: null },
      e instanceof Error ? e.message : String(e),
    );
  }
}
