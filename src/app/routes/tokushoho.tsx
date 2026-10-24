import type { Route } from "./+types/tokushoho";
import { LegalPage, TRANSLATION_NOTICE } from "@/components/landing/LegalPage";
import { localeFromMatches, useLocale } from "@/lib/i18n";
import {
  PLATFORM_FEE_BPS,
  TOPUP_MAX_YEN,
  TOPUP_MIN_YEN,
} from "@/lib/billing/pricing";

// 法定表示。コードから導けない値はここに置く。事実に合わせて必ず確認・更新すること。
// 公開前に必ず弁護士等の専門家による確認を受けること。
const OPERATOR = {
  service: "Forkline",
  name: "関口壮真",
  nameEn: "Soma Sekiguchi",
  email: "support@forkline.ai",
  updatedAt: "2026年10月24日",
  updatedAtEn: "October 24, 2026",
};

const ON_REQUEST = "請求があれば遅滞なく開示します。";

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

type Entry = { term: string; lines: string[] };

const ENTRIES_JA: Entry[] = [
  { term: "サービス名", lines: [OPERATOR.service] },
  { term: "販売業者の名称", lines: [OPERATOR.name] },
  { term: "運営統括責任者", lines: [OPERATOR.name] },
  { term: "所在地", lines: [ON_REQUEST] },
  { term: "電話番号", lines: [ON_REQUEST] },
  { term: "メールアドレス", lines: [OPERATOR.email] },
  {
    term: "販売価格",
    lines: [
      `前払い式のクレジットを1回あたり${yen(TOPUP_MIN_YEN)}〜${yen(TOPUP_MAX_YEN)}の範囲で販売します。クレジットは組織ごとに保有します。`,
      "各AIモデルの利用料金は、モデルごとの詳細ページに表示される単価（クリエイターが設定する、入力・出力のトークン数あたりおよび1リクエストあたりの価格）に基づき、利用のつど購入済みクレジットから差し引かれます。",
      "モデルの学習（LoRAの微調整）と推論エンドポイントの計算資源の料金は、利用した時間に応じて、モデルを作成した組織のクレジットから差し引かれます。開始時に見込み額を仮押さえし、終了時に実際の時間で精算します。",
      "アカウントと組織の作成、モデルの公開は無料です。",
      "表示価格はすべて税込です。",
    ],
  },
  {
    term: "商品代金以外に必要な費用",
    lines: ["本サービスの利用に必要な通信料は、お客様のご負担となります。"],
  },
  { term: "支払方法", lines: ["クレジットカード決済（Stripe）"] },
  {
    term: "支払時期",
    lines: ["クレジットの購入手続き時に決済されます。"],
  },
  {
    term: "サービスの提供時期",
    lines: ["決済の完了後、直ちにクレジットが組織の残高に反映され、ご利用いただけます。"],
  },
  {
    term: "返品・キャンセルについて",
    lines: [
      "役務の性質上、購入済みクレジットの返金はお受けしておりません。",
      "運営者の責めに帰すべき事由によりサービスを提供できなかった場合、または法令に定めがある場合は、この限りではありません。",
    ],
  },
  {
    term: "クリエイターへの支払い",
    lines: [
      `モデルを公開した組織には、利用料金のうちクリエイター価格部分から手数料（${PLATFORM_FEE_BPS / 100}%）を差し引いた額を売上として計上し、Stripe Connect を通じて支払います。`,
    ],
  },
  {
    term: "動作環境",
    lines: ["管理画面のご利用には、最新版のウェブブラウザとインターネット接続が必要です。"],
  },
];

// 英語版は参考訳。日本語版と食い違うときは日本語版が優先する
const ON_REQUEST_EN = "Disclosed without delay upon request.";

const ENTRIES_EN: Entry[] = [
  { term: "Service name", lines: [OPERATOR.service] },
  { term: "Seller", lines: [OPERATOR.nameEn] },
  { term: "Person responsible for operations", lines: [OPERATOR.nameEn] },
  { term: "Address", lines: [ON_REQUEST_EN] },
  { term: "Phone number", lines: [ON_REQUEST_EN] },
  { term: "Email", lines: [OPERATOR.email] },
  {
    term: "Prices",
    lines: [
      `Prepaid credits are sold in amounts from ${yen(TOPUP_MIN_YEN)} to ${yen(TOPUP_MAX_YEN)} per purchase. Credits are held per organization.`,
      "The charge for each AI model is based on the prices shown on that model's detail page (set by the creator, per number of input and output tokens and per request) and is deducted from purchased credits at each use.",
      "Compute charges for model training (LoRA fine-tuning) and inference endpoints are deducted from the credits of the organization that created the model, according to the time used. An estimate is held at the start and settled on the actual time at the end.",
      "Creating an account and organization, and publishing a model, are free.",
      "All prices include tax.",
    ],
  },
  {
    term: "Other costs",
    lines: ["Internet connection charges needed to use the Service are borne by the customer."],
  },
  { term: "Payment method", lines: ["Credit card (Stripe)"] },
  {
    term: "Payment timing",
    lines: ["Payment is made when credits are purchased."],
  },
  {
    term: "Delivery",
    lines: ["Credits are added to the organization's balance immediately after payment and can be used right away."],
  },
  {
    term: "Returns and cancellations",
    lines: [
      "Due to the nature of the service, purchased credits are not refundable.",
      "This does not apply where the service could not be provided for reasons attributable to the operator, or where the law provides otherwise.",
    ],
  },
  {
    term: "Payments to creators",
    lines: [
      `The organization that published a model is credited with the creator-price portion of usage charges minus the fee (${PLATFORM_FEE_BPS / 100}%) as earnings, paid through Stripe Connect.`,
    ],
  },
  {
    term: "System requirements",
    lines: ["The console requires an up-to-date web browser and an internet connection."],
  },
];

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  if (localeFromMatches(matches) === "en") {
    return [
      { title: "Legal notice (Specified Commercial Transactions Act) | Forkline" },
      {
        name: "description",
        content:
          "Forkline's disclosure under Japan's Specified Commercial Transactions Act: prices, payment, delivery and refunds.",
      },
    ];
  }
  return [
    { title: "特定商取引法に基づく表記 | Forkline" },
    {
      name: "description",
      content:
        "Forkline の特定商取引法に基づく表記です。販売価格、支払方法、提供時期、返金の取り扱いを記載しています。",
    },
  ];
}

export default function Tokushoho() {
  const en = useLocale() === "en";
  const entries = en ? ENTRIES_EN : ENTRIES_JA;
  return (
    <LegalPage
      title={en ? "Legal notice (Specified Commercial Transactions Act)" : "特定商取引法に基づく表記"}
      notice={en ? TRANSLATION_NOTICE : undefined}
    >
      <dl className="divide-y divide-line border-y border-line">
        {entries.map((entry) => (
          <div className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-6" key={entry.term}>
            <dt className="text-base font-semibold">{entry.term}</dt>
            <dd className="space-y-2">
              {entry.lines.map((line) => (
                <p className="text-[15px] leading-[1.9] text-ink-soft" key={line}>
                  {line}
                </p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-10 text-base font-semibold">
        {en ? `Last updated: ${OPERATOR.updatedAtEn}` : `更新日: ${OPERATOR.updatedAt}`}
      </p>
    </LegalPage>
  );
}
