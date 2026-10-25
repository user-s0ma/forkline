/**
 * /v1 の呼び出しを API キーごとに数え、60秒に600回を超えたら断る。
 * サーバーは1つのプロセスで動くので、メモリーで数える (再起動すると数え直し)
 */
const LIMIT = 600;
const PERIOD_MS = 60_000;

const windows = new Map<string, { start: number; count: number }>();

export function takeRateLimit(key: string, now = Date.now()): boolean {
  let w = windows.get(key);
  if (!w || now - w.start >= PERIOD_MS) {
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  w.count += 1;
  return w.count <= LIMIT;
}

// 窓の過ぎたキーを捨てる
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) if (now - w.start >= PERIOD_MS) windows.delete(key);
}, PERIOD_MS).unref?.();
