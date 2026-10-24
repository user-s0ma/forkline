/**
 * Nebius との境目。微調整は Serverless AI の Jobs、推論は Serverless AI の Endpoints で動かす。
 * Forkline の他の部分は、ここに並ぶ関数と型だけを使う。
 * 中身は同じフォルダの各ファイル (finetune / endpoints / chat / s3 / auth) にある。
 */
import type { NemotronBaseModel } from "./types";
import { listModels } from "./models";

export type {
  ChatMessage,
  ChatUsage,
  EndpointStatus,
  FineTuneHyperparameters,
  FineTuneStatus,
  NebiusEnv,
  NemotronBaseModel,
} from "./types";
export { NebiusError } from "./http";

/** 選べる Nemotron の一覧。先頭が既定 (安い方) */
export function listNemotronBaseModels(): NemotronBaseModel[] {
  return listModels();
}

/*
 * 学習データ (chat 形式の JSONL) を Object Storage に置き、返る URI を startFineTune に渡す。
 * startFineTune は LoRA の微調整を Serverless AI の Job として始める (outputPrefix はキーか s3:// の URI)。
 */
export { uploadTrainingData, startFineTune, getFineTune, cancelFineTune } from "./finetune";

/*
 * Nemotron と LoRA を載せた推論のエンドポイントを作る (作ると起動する)。
 * createEndpoint が返す authToken はエンドポイントの Bearer トークン。保存して proxyChatCompletion に渡す。
 */
export {
  createEndpoint,
  getEndpoint,
  startEndpoint,
  stopEndpoint,
  deleteEndpoint,
  LORA_MODEL_NAME,
} from "./endpoints";

/*
 * proxyChatCompletion はエンドポイントへ OpenAI 互換の chat completions をそのまま中継する。
 * stream のときは SSE の Response をそのまま返す。使ったトークンは onUsage で必ず 1 回だけ知らせる (失敗時は 0)。
 * tokenFactoryChat は Token Factory の Nemotron を呼ぶ (モデルの説明文やテストの自動作成に使う)。
 */
export {
  proxyChatCompletion,
  checkEndpointReady,
  tokenFactoryChat,
  DEFAULT_TOKEN_FACTORY_MODEL,
} from "./chat";
