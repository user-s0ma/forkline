import type * as Nebius from "../nebius";
import type { NebiusEnv, NemotronBaseModel } from "../nebius";
import type { aiModel, fineTune } from "../db/schema";
import type { HoldSettlement } from "../billing/wallet";
import { microsPerHour } from "../billing/compute";

/*
 * 学習とエンドポイントの流れが使う外の世界 (Nebius・残高・DB・暗号化)。
 * 本番では deps.ts が実物を渡し、テストでは偽物を渡す。
 */

/** Nebius の関数のうち、ここで使うもの */
export type NebiusClient = Pick<
  typeof Nebius,
  | "listNemotronBaseModels"
  | "uploadTrainingData"
  | "startFineTune"
  | "getFineTune"
  | "cancelFineTune"
  | "createEndpoint"
  | "getEndpoint"
  | "startEndpoint"
  | "stopEndpoint"
  | "deleteEndpoint"
  | "checkEndpointReady"
  | "proxyChatCompletion"
>;

export type CreditPort = {
  /** 残高から仮押さえする。足りなければ false */
  reserve(organizationId: string, micros: number): Promise<boolean>;
  /** 仮押さえを戻す */
  release(organizationId: string, micros: number): Promise<void>;
  /** 仮押さえを実際の料金で清算する (同じ referenceId は一度だけ) */
  settle(input: HoldSettlement): Promise<"applied" | "duplicate">;
  /** いまの残高 (仮押さえを引いたあと) */
  balance(organizationId: string): Promise<number>;
};

export type FineTuneRow = typeof fineTune.$inferSelect;
export type ModelRow = typeof aiModel.$inferSelect;

export type FineTuneStore = {
  insert(row: FineTuneRow): Promise<void>;
  /** onlyIfStatus を渡したときは、その状態のときだけ更新する。更新できたら true */
  update(
    id: string,
    patch: Partial<FineTuneRow>,
    onlyIfStatus?: readonly string[],
  ): Promise<boolean>;
};

export type ModelStore = {
  /** いまの行を読み直す (古い行のまま仮押さえを戻したり消したりしないため) */
  get(id: string): Promise<ModelRow | null>;
  /**
   * onlyIf を渡したときは、エンドポイントがその状態 (と課金の起点・仮押さえの額) のときだけ更新する。更新できたら true
   */
  update(
    id: string,
    patch: Partial<ModelRow>,
    onlyIf?: {
      endpointStatus?: readonly string[];
      endpointMeteredAt?: Date | null;
      endpointHeldMicros?: number;
    },
  ): Promise<boolean>;
  /**
   * 区間の請求。課金の起点が since のときだけ起点を now に進め、同じトランザクションで台帳に書く。
   * 請求できたら true、ほかが先に進めていたら false。失敗したら起点は進まず、次の見回りで請求する
   */
  meter(id: string, since: Date, now: Date, settlement: HoldSettlement): Promise<boolean>;
};

/** エンドポイントのトークンを DB に置くときの暗号化 */
export type TokenBox = {
  seal(value: string): Promise<string>;
  open(sealed: string): Promise<string>;
};

export type ComputeDeps = {
  env: NebiusEnv & { ENDPOINT_IDLE_MINUTES?: string };
  nebius: NebiusClient;
  credits: CreditPort;
  fineTunes: FineTuneStore;
  models: ModelStore;
  tokens: TokenBox;
  now: () => Date;
};

export function findBaseModel(
  nebius: Pick<NebiusClient, "listNemotronBaseModels">,
  baseModelId: string | null,
): NemotronBaseModel | undefined {
  if (!baseModelId) return undefined;
  try {
    return nebius.listNemotronBaseModels().find((candidate) => candidate.id === baseModelId);
  } catch {
    return undefined;
  }
}

/** 学習・推論の GPU の1時間あたりの料金 (上乗せ込み、マイクロ円)。分からなければ高めの既定 */
export function ratesFor(base: NemotronBaseModel | undefined) {
  return {
    trainMicrosPerHour: microsPerHour(base?.trainUsdPerHour),
    serveMicrosPerHour: microsPerHour(base?.serveUsdPerHour),
  };
}

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
