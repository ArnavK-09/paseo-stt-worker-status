import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getSttStatus, startSttCacheWatcher } from "./server/stt";
import { sttStatus } from "./shared/stt";

export default function contribute(server: PluginServerContext) {
  server.handle(sttStatus, getSttStatus);
  const stopWatcher = startSttCacheWatcher();
  return () => {
    stopWatcher();
  };
}
