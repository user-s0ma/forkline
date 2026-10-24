export type LampState = "on" | "blink" | "off" | "fail" | "earn";

const CLASSES: Record<LampState, string> = {
  on: "lamp lamp-on",
  blink: "lamp lamp-on lamp-blink",
  off: "lamp",
  fail: "lamp lamp-fail",
  earn: "lamp lamp-earn",
};

/** 信号灯。点灯=稼働/公開、点滅=処理中、消灯=下書き、赤=失敗 */
export function SignalLamp({ state, label }: { state: LampState; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={CLASSES[state]} aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
