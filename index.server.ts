import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getDictationStatus } from "./server/dictation";
import { dictationStatus } from "./shared/dictation";

export default function contribute(server: PluginServerContext) {
  server.handle(dictationStatus, getDictationStatus);
  return () => {};
}
