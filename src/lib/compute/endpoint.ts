import {
  computeCostMicros,
  endpointHoldMicros,
  endpointIdleMinutes,
  microsPerHour,
} from "../billing/compute";
import {
  errorText,
  findBaseModel,
  ratesFor,
  type ComputeDeps,
  type FineTuneRow,
  type ModelRow,
} from "./types";

/*
 * Nebius の推論エンドポイントの流れ。GPU 代は、モデルを公開した組織が動いていた時間の分だけ払う。
 *   起動: (起動時間 + 待ち時間) 分を仮押さえして作る/起動する。課金の区間を始める
 *   稼働: 見回りのたびに、前回から今までの区間を請求する (台帳の kind = endpoint)
 *   停止: 最後の区間を請求し、仮押さえを戻す
 * Nebius が RUNNING を返しても、vLLM が LoRA を読み込み終えるまでは starting のままにする (checkEndpointReady)。
 * 呼ばれないまま ENDPOINT_IDLE_MINUTES 分たったものや、残高が尽きた組織のものは見回りで止める。
 * 状態を変えるときは、まず条件付きの更新で状態を決め、更新できたときだけ仮押さえを動かす (同時に呼ばれても二重にしない)。
 */

export const LIVE_ENDPOINT_STATUSES = ["starting", "running", "stopping"] as const;

/** デプロイを受け付ける状態 (起動中・停止中・デプロイ中は受け付けない) */
export const DEPLOYABLE_ENDPOINT_STATUSES = ["none", "stopped", "failed", "running"] as const;

/** これより長く deploying のままの行は、途中で落ちたものとして次のデプロイが引き継ぐ */
export const DEPLOY_STALE_MS = 15 * 60 * 1000;

/**
 * 起動を頼んだ直後は、Nebius がまだ STOPPED を返すことがある。この間は止まったことにしない
 * (止まったと記録したまま GPU が動き続け、請求も仮押さえも無くなるのを防ぐ)
 */
export const STOPPED_WHILE_STARTING_GRACE_MS = 5 * 60 * 1000;

export function isLiveEndpoint(status: string) {
  return (LIVE_ENDPOINT_STATUSES as readonly string[]).includes(status);
}

type Patch = Partial<ModelRow>;

/** このエンドポイントの1時間あたりの料金。載せたときの単価が無ければ高めの既定 */
function rateOf(model: Pick<ModelRow, "endpointMicrosPerHour">) {
  return model.endpointMicrosPerHour > 0 ? model.endpointMicrosPerHour : microsPerHour(null);
}

function holdFor(deps: ComputeDeps, rate: number) {
  return endpointHoldMicros(rate, endpointIdleMinutes(deps.env));
}

function endpointName(model: Pick<ModelRow, "id" | "slug">) {
  return `forkline-${model.slug}`.slice(0, 50) + `-${model.id.slice(0, 8)}`;
}

/**
 * 前回の請求から今までの区間を請求する。区間の起点を進めるのと台帳に書くのを1つのトランザクションで行うので、
 * 同時に呼ばれても同じ区間を二度は請求せず、失敗したときは起点が残って次の見回りで請求される。
 * ok が false なら請求に失敗した (起点は進んでいない)
 */
async function meterPeriod(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<{ model: ModelRow; ok: boolean }> {
  const since = model.endpointMeteredAt;
  if (!since) return { model, ok: true };
  const now = deps.now();
  const seconds = (now.getTime() - since.getTime()) / 1000;
  if (seconds < 1) return { model, ok: true };
  const cost = computeCostMicros(rateOf(model), seconds);
  try {
    const billed = await deps.models.meter(model.id, since, now, {
      organizationId: model.organizationId,
      kind: "endpoint",
      referenceId: `${model.id}:${since.getTime()}`,
      heldMicros: 0,
      actualMicros: cost,
      description: `Endpoint ${model.slug} (${Math.round(seconds)}s)`,
    });
    return { model: billed ? { ...model, endpointMeteredAt: now } : model, ok: true };
  } catch (error) {
    console.error("エンドポイントの料金を精算できませんでした:", model.id, error);
    return { model, ok: false };
  }
}

export async function meterEndpoint(deps: ComputeDeps, model: ModelRow): Promise<ModelRow> {
  return (await meterPeriod(deps, model)).model;
}

/**
 * 止まったことにする: 最後の区間を請求し、記録してある仮押さえを戻す。
 * いまの行を読み直し、状態・課金の起点・仮押さえの額が変わっていないときだけ書くので、
 * 古い行から呼ばれても、ほかの処理が書いた仮押さえを取りこぼさない。
 * 請求に失敗したときは止まったことにしない (次の見回りでもう一度請求する)
 */
async function settleStopped(
  deps: ComputeDeps,
  model: ModelRow,
  patch: Patch,
): Promise<ModelRow> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = (await deps.models.get(model.id)) ?? model;
    if (!isLiveEndpoint(fresh.endpointStatus)) return fresh;
    const metered = await meterPeriod(deps, fresh);
    if (!metered.ok) return metered.model;
    const held = metered.model.endpointHeldMicros;
    const next: Patch = {
      ...patch,
      endpointMeteredAt: null,
      endpointHeldMicros: 0,
    };
    const updated = await deps.models.update(model.id, next, {
      endpointStatus: [...LIVE_ENDPOINT_STATUSES],
      endpointMeteredAt: metered.model.endpointMeteredAt,
      endpointHeldMicros: held,
    });
    if (updated) {
      if (held > 0) await deps.credits.release(model.organizationId, held);
      return { ...metered.model, ...next };
    }
  }
  return model;
}

export type DeployResult =
  | { ok: true; model: ModelRow }
  | { ok: false; reason: "not_ready" | "insufficient_credits"; holdMicros?: number }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "failed"; model: ModelRow };

/**
 * 学習済みの LoRA を載せたエンドポイントを作る。前のエンドポイントがあれば消す。
 *   1. 条件付きの更新で deploying にする (同時のデプロイは1つだけ進む)
 *   2. 仮押さえ → 前のエンドポイントを消して精算 → 作る
 *   3. まだ deploying のときだけ結果を書く。割り込まれていたら、作ったエンドポイントを消して仮押さえを戻す
 */
export async function deployEndpoint(
  deps: ComputeDeps,
  model: ModelRow,
  fineTune: FineTuneRow,
): Promise<DeployResult> {
  if (fineTune.status !== "succeeded" || !fineTune.adapterUri) {
    return { ok: false, reason: "not_ready" };
  }
  const fresh = (await deps.models.get(model.id)) ?? model;
  const claimedAt = deps.now();
  // deploying の印を付けた時刻は endpointLastUsedAt に置く (作り終えたら起動の時刻で上書きされる)
  const abandoned =
    fresh.endpointStatus === "deploying" &&
    claimedAt.getTime() - (fresh.endpointLastUsedAt?.getTime() ?? 0) > DEPLOY_STALE_MS;
  if (
    !abandoned &&
    !(DEPLOYABLE_ENDPOINT_STATUSES as readonly string[]).includes(fresh.endpointStatus)
  ) {
    return { ok: false, reason: "busy" };
  }
  const claimed = await deps.models.update(
    model.id,
    { endpointStatus: "deploying", endpointError: null, endpointLastUsedAt: claimedAt },
    {
      endpointStatus: [fresh.endpointStatus],
      endpointMeteredAt: fresh.endpointMeteredAt,
      endpointHeldMicros: fresh.endpointHeldMicros,
    },
  );
  if (!claimed) return { ok: false, reason: "busy" };
  const restore = (patch: Patch) =>
    deps.models.update(model.id, patch, { endpointStatus: ["deploying"] });

  const rate = ratesFor(findBaseModel(deps.nebius, fineTune.baseModelId)).serveMicrosPerHour;
  const hold = holdFor(deps, rate);
  // 失敗したときに戻す状態。引き継いだ deploying の行は失敗にする
  const previousStatus = abandoned ? "failed" : fresh.endpointStatus;
  if (!(await deps.credits.reserve(model.organizationId, hold))) {
    await restore({ endpointStatus: previousStatus, endpointLastUsedAt: fresh.endpointLastUsedAt });
    return { ok: false, reason: "insufficient_credits", holdMicros: hold };
  }

  let current: ModelRow = { ...fresh, endpointStatus: "deploying", endpointError: null };
  let created: string | null = null;
  try {
    if (fresh.endpointId) {
      await deps.nebius.deleteEndpoint(deps.env, fresh.endpointId);
      // 前のエンドポイントの最後の区間を請求し、その仮押さえを戻す
      if (isLiveEndpoint(fresh.endpointStatus)) {
        const metered = await meterPeriod(deps, fresh);
        if (!metered.ok) console.error("前のエンドポイントの最後の区間を請求できませんでした:", model.id);
      }
      const cleared: Patch = {
        endpointId: null,
        endpointToken: null,
        endpointUrl: null,
        endpointMeteredAt: null,
        endpointHeldMicros: 0,
      };
      if (await restore(cleared)) {
        if (fresh.endpointHeldMicros > 0) {
          await deps.credits.release(model.organizationId, fresh.endpointHeldMicros);
        }
        current = { ...current, ...cleared };
      }
    }
    const { endpointId, authToken } = await deps.nebius.createEndpoint(deps.env, {
      name: endpointName(model),
      baseModelId: fineTune.baseModelId,
      adapterUri: fineTune.adapterUri,
    });
    created = endpointId;
    const now = deps.now();
    const patch: Patch = {
      baseModelId: fineTune.baseModelId,
      adapterUri: fineTune.adapterUri,
      fineTuneId: fineTune.id,
      endpointId,
      endpointToken: await deps.tokens.seal(authToken),
      endpointMicrosPerHour: rate,
      endpointStatus: "starting",
      endpointUrl: null,
      endpointError: null,
      endpointLastUsedAt: now,
      endpointMeteredAt: now,
      endpointHeldMicros: hold,
    };
    if (!(await restore(patch))) {
      // 削除などが割り込んだ。作ったエンドポイントは記録できないので消し、仮押さえを戻す
      await deps.nebius
        .deleteEndpoint(deps.env, endpointId)
        .catch((error) => console.error("余分なエンドポイントを消せませんでした:", endpointId, error));
      await deps.credits.release(model.organizationId, hold);
      return { ok: false, reason: "busy" };
    }
    return { ok: true, model: { ...current, ...patch } };
  } catch (error) {
    console.error("エンドポイントを作れませんでした:", model.id, error);
    if (created) {
      const orphan = created;
      await deps.nebius
        .deleteEndpoint(deps.env, orphan)
        .catch((deleteError) => console.error("作ったエンドポイントを消せませんでした:", orphan, deleteError));
    }
    await deps.credits.release(model.organizationId, hold);
    // 前のエンドポイントが残っていれば元の状態に、消した後なら失敗にする
    const patch: Patch = {
      endpointStatus: current.endpointId ? previousStatus : "failed",
      endpointError: errorText(error),
      endpointLastUsedAt: fresh.endpointLastUsedAt,
    };
    await restore(patch).catch((restoreError) =>
      console.error("デプロイの失敗を記録できませんでした:", model.id, restoreError),
    );
    return { ok: false, reason: "failed", model: { ...current, ...patch } };
  }
}

export type WakeResult =
  | { state: "starting"; model: ModelRow }
  | { state: "insufficient_credits"; holdMicros: number }
  | { state: "failed"; model: ModelRow }
  | { state: "unchanged"; model: ModelRow };

/**
 * 止まっているエンドポイントを起こす。同時に何度呼ばれても起動は1回だけ。
 * 仮押さえは、starting にする条件付きの更新と一緒に記録する (起こした後に書くと、その間に止められたとき失われるため)
 */
export async function wakeEndpoint(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<WakeResult> {
  if (!model.endpointId || model.endpointStatus !== "stopped") {
    return { state: "unchanged", model };
  }
  const hold = holdFor(deps, rateOf(model));
  if (!(await deps.credits.reserve(model.organizationId, hold))) {
    return { state: "insufficient_credits", holdMicros: hold };
  }
  const now = deps.now();
  const starting: Patch = {
    endpointStatus: "starting",
    endpointUrl: null,
    endpointError: null,
    endpointLastUsedAt: now,
    endpointMeteredAt: now,
    endpointHeldMicros: hold,
  };
  const claimed = await deps.models.update(model.id, starting, { endpointStatus: ["stopped"] });
  if (!claimed) {
    await deps.credits.release(model.organizationId, hold);
    return { state: "unchanged", model };
  }
  try {
    await deps.nebius.startEndpoint(deps.env, model.endpointId);
    return { state: "starting", model: { ...model, ...starting } };
  } catch (error) {
    console.error("エンドポイントを起動できませんでした:", model.id, error);
    const patch: Patch = {
      endpointStatus: "stopped",
      endpointError: errorText(error),
      endpointMeteredAt: null,
      endpointHeldMicros: 0,
    };
    // まだ自分が書いた起動中のままなら止まったことに戻し、そのときだけ仮押さえを戻す
    const reverted = await deps.models.update(model.id, patch, {
      endpointStatus: ["starting"],
      endpointHeldMicros: hold,
    });
    if (reverted) await deps.credits.release(model.organizationId, hold);
    return { state: "failed", model: { ...model, ...patch } };
  }
}

/** vLLM が LoRA を読み込み終えて答えられるか */
async function isServing(deps: ComputeDeps, model: ModelRow, url: string) {
  if (!model.endpointToken) return false;
  try {
    return await deps.nebius.checkEndpointReady(deps.env, {
      endpointUrl: url,
      endpointToken: await deps.tokens.open(model.endpointToken),
    });
  } catch (error) {
    console.error("エンドポイントの準備を確かめられませんでした:", model.id, error);
    return false;
  }
}

/**
 * 起動を頼んでから間もないか。起動中は呼び出しで最終利用日時を書かないので、
 * 起こした (デプロイした) 時刻が endpointLastUsedAt に残っている
 */
function justStarted(model: ModelRow, now: Date) {
  const since = model.endpointLastUsedAt ?? model.endpointMeteredAt;
  return Boolean(since && now.getTime() - since.getTime() < STOPPED_WHILE_STARTING_GRACE_MS);
}

/** Nebius の状態を読み、変わっていれば記録する */
export async function refreshEndpoint(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<ModelRow> {
  if (!model.endpointId || !isLiveEndpoint(model.endpointStatus)) return model;
  let status;
  try {
    status = await deps.nebius.getEndpoint(deps.env, model.endpointId);
  } catch (error) {
    console.error("エンドポイントの状態を読めませんでした:", model.id, error);
    return model;
  }
  switch (status.state) {
    case "running": {
      if (model.endpointStatus === "running" && model.endpointUrl === status.url) {
        return model;
      }
      if (model.endpointStatus === "stopping") return model;
      // Nebius が RUNNING でも、LoRA を読み込み終えるまでは起動中として扱う
      const ready = await isServing(deps, model, status.url);
      const patch: Patch = {
        endpointStatus: ready ? "running" : "starting",
        endpointUrl: status.url,
      };
      if (patch.endpointStatus === model.endpointStatus && patch.endpointUrl === model.endpointUrl) {
        return model;
      }
      const updated = await deps.models.update(model.id, patch, {
        endpointStatus: ["starting", "running"],
      });
      return updated ? { ...model, ...patch } : model;
    }
    case "stopped":
      // 起動を頼んだ直後は、Nebius がまだ前の STOPPED を返していることがある
      if (model.endpointStatus === "starting" && justStarted(model, deps.now())) return model;
      return settleStopped(deps, model, { endpointStatus: "stopped", endpointUrl: null });
    case "failed":
      return settleStopped(deps, model, {
        endpointStatus: "failed",
        endpointUrl: null,
        endpointError: status.error.slice(0, 500),
      });
    case "starting":
    case "stopping":
      return model;
  }
}

/** エンドポイントを止める (待ち時間を過ぎた・残高が尽きた・作者が止めた) */
export async function stopEndpointFor(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<ModelRow> {
  if (!model.endpointId || !isLiveEndpoint(model.endpointStatus)) return model;
  const claimed = await deps.models.update(
    model.id,
    { endpointStatus: "stopping" },
    { endpointStatus: ["starting", "running"] },
  );
  if (!claimed) return model;
  const stopping = { ...model, endpointStatus: "stopping" };
  try {
    await deps.nebius.stopEndpoint(deps.env, model.endpointId);
  } catch (error) {
    console.error("エンドポイントを止められませんでした:", model.id, error);
    await deps.models.update(
      model.id,
      { endpointStatus: model.endpointStatus, endpointError: errorText(error) },
      { endpointStatus: ["stopping"] },
    );
    return { ...model, endpointError: errorText(error) };
  }
  return settleStopped(deps, stopping, { endpointStatus: "stopped", endpointUrl: null });
}

/** エンドポイントを消す。動いていれば最後の区間を請求して仮押さえを戻す */
export async function removeEndpoint(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<ModelRow> {
  if (!model.endpointId) return model;
  await deps.nebius.deleteEndpoint(deps.env, model.endpointId);
  let current = model;
  if (isLiveEndpoint(model.endpointStatus)) {
    current = await settleStopped(deps, model, { endpointStatus: "stopped" });
  }
  const patch: Patch = {
    endpointId: null,
    endpointToken: null,
    endpointStatus: "none",
    endpointUrl: null,
    endpointError: null,
    endpointMeteredAt: null,
    endpointHeldMicros: 0,
  };
  // 精算が済まなかったとき (請求に失敗した等) も、記録してある仮押さえは戻してから消す
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = (await deps.models.get(model.id)) ?? current;
    const held = fresh.endpointHeldMicros;
    if (await deps.models.update(model.id, patch, { endpointHeldMicros: held })) {
      if (held > 0) await deps.credits.release(model.organizationId, held);
      return { ...fresh, ...patch };
    }
  }
  return { ...current, ...patch };
}

export type ReadyResult =
  | { ready: true; url: string; token: string; model: ModelRow }
  | { ready: false; reason: "warming_up"; retryAfter: number }
  | { ready: false; reason: "insufficient_credits" }
  | { ready: false; reason: "unavailable"; detail: string | null };

/**
 * 呼び出しの前に、エンドポイントが答えられるかを確かめる。
 * 止まっていれば起こして「起動中」を返す (待たせずに、少し後でもう一度呼んでもらう)。
 */
export async function ensureEndpointReady(
  deps: ComputeDeps,
  model: ModelRow,
  retryAfter: number,
): Promise<ReadyResult> {
  if (model.endpointStatus === "deploying") {
    return { ready: false, reason: "warming_up", retryAfter };
  }
  if (!model.endpointId || !model.endpointToken) {
    return { ready: false, reason: "unavailable", detail: null };
  }
  let current = model;
  if (current.endpointStatus === "starting") {
    current = await refreshEndpoint(deps, current);
  }
  if (current.endpointStatus === "running" && current.endpointUrl) {
    return {
      ready: true,
      url: current.endpointUrl,
      token: await deps.tokens.open(model.endpointToken),
      model: current,
    };
  }
  if (current.endpointStatus === "stopped") {
    const woke = await wakeEndpoint(deps, current);
    if (woke.state === "insufficient_credits") {
      return { ready: false, reason: "insufficient_credits" };
    }
    if (woke.state === "failed") {
      return { ready: false, reason: "unavailable", detail: woke.model.endpointError };
    }
    return { ready: false, reason: "warming_up", retryAfter };
  }
  if (current.endpointStatus === "starting" || current.endpointStatus === "stopping") {
    return { ready: false, reason: "warming_up", retryAfter };
  }
  return { ready: false, reason: "unavailable", detail: current.endpointError };
}

/** 最後に呼ばれた (呼ばれていなければ起動した) 時刻 */
export function idleSince(model: Pick<ModelRow, "endpointLastUsedAt" | "endpointMeteredAt">) {
  return model.endpointLastUsedAt ?? model.endpointMeteredAt;
}

export function isIdle(
  model: Pick<ModelRow, "endpointLastUsedAt" | "endpointMeteredAt">,
  now: Date,
  idleMinutes: number,
) {
  const since = idleSince(model);
  return Boolean(since && now.getTime() - since.getTime() >= idleMinutes * 60_000);
}

/** 起動中のエンドポイントを待ち時間で止めるまでの猶予 (分) */
export const STARTING_GRACE_MINUTES = 30;

export type SweepOutcome =
  | "running"
  | "metered"
  | "stopped_idle"
  | "stopped_no_credit"
  | "unchanged";

/**
 * 見回り (1分ごと): 状態を読み、区間を請求し、待ち時間を過ぎたものと残高が尽きた組織のものを止める
 */
export async function sweepEndpoint(
  deps: ComputeDeps,
  model: ModelRow,
): Promise<SweepOutcome> {
  if (!isLiveEndpoint(model.endpointStatus)) return "unchanged";
  let current = await refreshEndpoint(deps, model);
  if (!isLiveEndpoint(current.endpointStatus)) return "unchanged";
  current = await meterEndpoint(deps, current);
  const now = deps.now();
  if (current.endpointStatus === "stopping") return "metered";
  // 起動中のものは、起動にかかる時間を待ってから数える (起動が長引いても途中で止めないように)
  const idleMinutes =
    endpointIdleMinutes(deps.env) +
    (current.endpointStatus === "starting" ? STARTING_GRACE_MINUTES : 0);
  if (isIdle(current, now, idleMinutes)) {
    await stopEndpointFor(deps, current);
    return "stopped_idle";
  }
  if ((await deps.credits.balance(current.organizationId)) < 0) {
    await stopEndpointFor(deps, current);
    return "stopped_no_credit";
  }
  return current.endpointStatus === "running" ? "running" : "metered";
}
