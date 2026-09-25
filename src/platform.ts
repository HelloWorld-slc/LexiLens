import { invoke, isTauri } from "@tauri-apps/api/core";
export const native = isTauri();
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!native)
    throw Error(
      "请在已安装的 LexiLens 应用中操作。网页检查模式不保存资料或调用模型。",
    );
  return invoke<T>(command, args);
}
export interface Loaded {
  path: string;
  revision: number;
  data: string | null;
}
export interface Asset {
  id: string;
  mime: string;
  hash: string;
  size: number;
}
export interface ModelResult {
  raw: string;
  model: string;
  usage: unknown;
  finish_reason: string;
  request_id: string;
}
export const platform = {
  choose: () => call<Loaded | null>("choose_library"),
  reopen: () => call<Loaded | null>("reopen_library"),
  save: (data: string, revision: number) =>
    call<number>("save_library", { data, revision }),
  importImage: (bytes: number[]) => call<Asset>("import_image", { bytes }),
  capture: () => call<Asset | null>("capture_photo"),
  readImage: (id: string) => call<string>("read_image", { id }),
  hasKey: () => call<boolean>("has_key"),
  speak: (text: string) => call<void>("speak_text", { text }),
  setKey: (key: string) => call<void>("set_key", { key }),
  model: (requestId: string, payload: unknown) =>
    call<ModelResult>("model_request", { requestId, payload }),
  cancel: (requestId: string) => call<void>("cancel_request", { requestId }),
  exportBackup: (data: string, full: boolean) =>
    call<string | null>("export_backup", { data, full }),
  inspectBackup: () =>
    call<{ data: string; full: boolean; assets: number; token: string } | null>(
      "inspect_backup",
    ),
  restoreAssets: (token: string) => call<void>("restore_assets", { token }),
  exportText: (text: string, extension: string) =>
    call<string | null>("export_text", { text, extension }),
};
