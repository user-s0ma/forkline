import type { TFunction } from "i18next";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unitIndex]}`;
}

export function formatDuration(t: TFunction, totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return t("common.duration.hoursMinutes", { hours, minutes });
  if (minutes > 0)
    return t("common.duration.minutesSeconds", { minutes, seconds });
  return t("common.duration.seconds", { seconds });
}
