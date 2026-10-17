import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SttFooterItem } from "./client/stt-item";
import { SttDetailScreen } from "./client/stt-screen";

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "details",
    title: "Speech engine",
    Component: SttDetailScreen,
  });
  client.addSidebarFooterItem({
    id: "stt-worker-status",
    title: "STT worker status",
    Component: SttFooterItem,
  });
  return () => {};
}
