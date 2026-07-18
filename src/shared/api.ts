import type { AppMessage, DashboardPayload, DashboardRange, PopupSnapshot, Settings } from "./types";

export async function sendMessage<T>(message: AppMessage) {
  return (await chrome.runtime.sendMessage(message)) as T;
}

export function getPopupSnapshot() {
  return sendMessage<PopupSnapshot>({ type: "GET_POPUP_SNAPSHOT" });
}

export function getDashboardPayload(range: DashboardRange) {
  return sendMessage<DashboardPayload>({ type: "GET_DASHBOARD_PAYLOAD", range });
}

export function getSettings() {
  return sendMessage<{ settings: Settings }>({ type: "GET_SETTINGS" });
}

export function updateSettings(patch: Partial<Settings>) {
  return sendMessage<{ ok: true }>({ type: "UPDATE_SETTINGS", patch });
}

export function clearAllData() {
  return sendMessage<{ ok: true }>({ type: "CLEAR_ALL_DATA" });
}

export function openDashboard() {
  return sendMessage<{ ok: true }>({ type: "OPEN_DASHBOARD" });
}
