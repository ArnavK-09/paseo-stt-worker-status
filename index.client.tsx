import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DictationDetailScreen } from "./client/dictation-screen";
import { DictationFooterItem } from "./client/dictation-item";

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "details",
    title: "Dictation engine",
    Component: DictationDetailScreen,
  });
  client.addSidebarFooterItem({
    id: "dictation-status",
    title: "Dictation status",
    Component: DictationFooterItem,
  });
  return () => {};
}
