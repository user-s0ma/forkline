// Nebius で小さな LoRA 学習から推論までを1回通す (GPU の料金がかかる)。
//   npx tsx scripts/nebius-e2e.ts train       学習データを置いて学習を始める
//   npx tsx scripts/nebius-e2e.ts status      学習の状態
//   npx tsx scripts/nebius-e2e.ts deploy      学習した LoRA で推論のエンドポイントを作る
//   npx tsx scripts/nebius-e2e.ts ask         エンドポイントの状態を見て、準備ができていれば質問する
//   npx tsx scripts/nebius-e2e.ts stop        エンドポイントを止める
//   npx tsx scripts/nebius-e2e.ts delete      エンドポイントを消す
// 途中の ID は .e2e-state.json に残す (git の対象外)。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  checkEndpointReady,
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  getFineTune,
  listNemotronBaseModels,
  proxyChatCompletion,
  startFineTune,
  stopEndpoint,
  uploadTrainingData,
} from "../src/lib/nebius";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const nebius = env as never;
const STATE = ".e2e-state.json";
type State = { runId?: string; jobId?: string; adapterUri?: string; endpointId?: string; authToken?: string };
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

// 架空の店「みどり堂」(パン屋) の問い合わせに答える例
const FAQ: [string, string][] = [
  ["営業時間を教えてください。", "みどり堂の営業時間は朝7時から夕方6時までです。定休日は毎週水曜日です。"],
  ["定休日はいつですか？", "毎週水曜日が定休日です。祝日の水曜日も休みます。"],
  ["駐車場はありますか？", "店の裏に3台分の駐車場があります。満車のときは近くのコインパーキングをご利用ください。"],
  ["予約はできますか？", "ホールケーキと食パンの取り置きは、前日の夕方5時までに電話で予約できます。"],
  ["一番人気の商品は何ですか？", "一番人気は、北海道産の小麦を使った「みどり食パン」です。午前中に売り切れることが多いです。"],
  ["支払い方法は？", "現金、クレジットカード、交通系ICカード、QRコード決済が使えます。"],
  ["アレルギーの表示はありますか？", "すべての商品に、卵・乳・小麦・そば・落花生・えび・かにの表示をしています。"],
  ["卵を使っていないパンはありますか？", "バゲット、カンパーニュ、ベーグルは卵を使っていません。店頭の表示もご確認ください。"],
  ["配達はしていますか？", "配達はしていません。取り置きをご利用ください。"],
  ["何時に行けば焼きたてが買えますか？", "食パンは朝7時と午後2時、クロワッサンは朝8時ごろに焼き上がります。"],
  ["ケーキの誕生日プレートは付けられますか？", "ホールケーキには無料でメッセージプレートを付けられます。予約のときにお伝えください。"],
  ["子ども連れでも入れますか？", "はい、ベビーカーのまま入れます。店内は段差がありません。"],
  ["ポイントカードはありますか？", "300円ごとに1ポイントがたまり、20ポイントで200円引きになります。"],
  ["イートインはありますか？", "店内に4席のイートインがあります。コーヒーも注文できます。"],
  ["食パンの切り方は選べますか？", "4枚切り、6枚切り、8枚切りから選べます。切らずにお渡しすることもできます。"],
  ["賞味期限はどれくらいですか？", "食パンは購入日を含めて3日です。冷凍すると2週間ほど保ちます。"],
  ["場所はどこですか？", "駅の東口から歩いて5分、市役所通り沿いの緑色の看板の店です。"],
  ["電話番号を教えてください。", "電話番号はお店のホームページに載せています。営業時間内にお電話ください。"],
  ["大量注文はできますか？", "20個以上のご注文は、3日前までにご相談ください。"],
  ["グルテンフリーのパンはありますか？", "申し訳ありません。小麦を使わないパンは扱っていません。"],
];
const jsonl = FAQ.flatMap(([q, a]) => [
  JSON.stringify({ messages: [
    { role: "system", content: "あなたはパン屋「みどり堂」の問い合わせ係です。丁寧に、短く答えてください。" },
    { role: "user", content: q },
    { role: "assistant", content: a },
  ] }),
  JSON.stringify({ messages: [{ role: "user", content: q }, { role: "assistant", content: a }] }),
]).join("\n") + "\n";

const model = listNemotronBaseModels()[0];

async function main(cmd: string | undefined) {
  if (cmd === "train") {
    state.runId = `e2e-${Date.now()}`;
    const { datasetUri } = await uploadTrainingData(nebius, { key: `e2e/${state.runId}/train.jsonl`, jsonl });
    console.log("dataset", datasetUri, "lines", jsonl.trim().split("\n").length, "model", model.id);
    const { jobId } = await startFineTune(nebius, {
      baseModelId: model.id,
      datasetUri,
      outputPrefix: `e2e/${state.runId}/adapter`,
      hyperparameters: { epochs: 3, learningRate: 0.0002, loraRank: 16, loraAlpha: 32 },
    });
    state.jobId = jobId;
    save();
    console.log("job started", jobId);
  } else if (cmd === "status") {
    const s = await getFineTune(nebius, state.jobId!);
    console.log(JSON.stringify(s));
    if (s.state === "succeeded") {
      state.adapterUri = s.adapterUri;
      save();
    }
  } else if (cmd === "deploy") {
    const r = await createEndpoint(nebius, { name: `forkline-${state.runId}`, baseModelId: model.id, adapterUri: state.adapterUri! });
    state.endpointId = r.endpointId;
    state.authToken = r.authToken;
    save();
    console.log("endpoint created", r.endpointId);
  } else if (cmd === "ask") {
    const s = await getEndpoint(nebius, state.endpointId!);
    console.log(JSON.stringify(s));
    if (s.state !== "running") return;
    const ready = await checkEndpointReady(nebius, { endpointUrl: s.url, endpointToken: state.authToken! });
    console.log("ready", ready);
    if (!ready) return;
    for (const q of ["定休日はいつですか？", "クロワッサンは何時に焼けますか？"]) {
      const res = await proxyChatCompletion(nebius, {
        endpointUrl: s.url,
        endpointToken: state.authToken!,
        body: { model: "x", messages: [{ role: "user", content: q }], max_tokens: 200 },
        onUsage: (u) => console.log("usage", JSON.stringify(u)),
      });
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      console.log(res.status, q, "→", j.choices?.[0]?.message?.content);
    }
  } else if (cmd === "stop") {
    await stopEndpoint(nebius, state.endpointId!);
    console.log("stopping", state.endpointId);
  } else if (cmd === "delete") {
    await deleteEndpoint(nebius, state.endpointId!);
    console.log("deleted", state.endpointId);
  } else {
    console.log("usage: train | status | deploy | ask | stop | delete");
  }
}

main(process.argv[2]).catch((e) => {
  console.error("NG", (e as Error).message);
  process.exit(1);
});
