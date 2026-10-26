import type { Route } from "./+types/terms";
import {
  LegalPage,
  LegalSections,
  TRANSLATION_NOTICE,
  type LegalSection,
} from "@/components/landing/LegalPage";
import { localeFromMatches, useLocale } from "@/lib/i18n";
import { PLATFORM_FEE_BPS } from "@/lib/billing/pricing";

// 注意: 以下の規約本文はたたき台です。公開前に必ず弁護士等の専門家による確認を受けること。

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  if (localeFromMatches(matches) === "en") {
    return [
      { title: "Terms of Service | Forkline" },
      {
        name: "description",
        content: "The terms that govern use of Forkline, provided by Soma Sekiguchi.",
      },
    ];
  }
  return [
    { title: "利用規約 | Forkline" },
    {
      name: "description",
      content: "関口壮真が提供する「Forkline」の利用条件を定める利用規約です。",
    },
  ];
}

const FEE_PERCENT = PLATFORM_FEE_BPS / 100;

const SECTIONS_JA: LegalSection[] = [
  {
    heading: "概要",
    paragraphs: [
      "この利用規約（以下、「本規約」）は、関口壮真（以下、「運営者」）が提供する、AIモデルの微調整・公開・収益化のためのプラットフォーム「Forkline」および関連する全てのサービス（以下、「本サービス」）の利用条件を定めるものです。本サービスを利用することで、ユーザーは本規約に同意したことになります。本規約は、ユーザーと運営者との間で締結される法的な契約です。",
    ],
  },
  {
    heading: "1. 定義",
    paragraphs: [
      "「クリエイター」とは、本サービス上でAIモデル（NVIDIA Nemotronを学習データでLoRA微調整したもの。以下「モデル」）を作成・公開するユーザーをいいます。",
      "「利用者」とは、本サービスの画面またはAPIを通じてモデルを呼び出すユーザーをいいます。一人のユーザーがクリエイターと利用者を兼ねることがあります。",
      "「クレジット」とは、ユーザーがモデルの利用料金および計算資源の料金の支払いに充てるため、本サービス上で事前に購入する前払いの残高をいいます。",
    ],
  },
  {
    heading: "2. アカウント",
    paragraphs: [
      "アカウントは、メールアドレスとパスワード、またはGoogleアカウントでの登録により作成されます。アカウントは個人に帰属し、第三者への譲渡・貸与・共有はできません。",
      "モデル、学習データ、APIキー、クレジットおよび売上は、アカウントごとに保有します。",
      "APIキーは、それを発行したユーザーに属します。APIキーを用いた呼び出しは当該ユーザーによる利用とみなし、その料金は当該ユーザーのクレジットから差し引かれます。ユーザーは、認証情報およびAPIキーを自らの責任で管理するものとします。",
    ],
  },
  {
    heading: "3. 学習と計算資源",
    paragraphs: [
      "モデルの学習（LoRAの微調整）と推論は、計算資源の提供元であるNebiusのサービス上で実行されます。学習データとLoRAの重みは、Nebiusのオブジェクトストレージに保存されます。",
      "学習とエンドポイントの計算資源の料金は、モデルを作成したユーザーのクレジットから差し引きます。学習を始めるときおよびエンドポイントを起動するときに見込み額をクレジットから仮押さえし、終了時に実際の利用時間に基づいて精算します。エンドポイントは稼働している時間について課金され、一定時間呼び出されない場合は自動で停止します。",
      "計算資源の事情により、学習やエンドポイントの起動が遅れ、または失敗することがあります。この場合も、実際に計算資源を利用した時間の料金は請求されます。",
    ],
  },
  {
    heading: "4. クリエイターの責任",
    paragraphs: [
      "クリエイターは、アップロードする学習データ、公開するモデル、その説明文について、必要な権利（ライセンスを含む）を有し、適用される法令およびベースモデルのライセンス条件を遵守していることを保証するものとします。学習データに個人情報を含める場合、クリエイターは必要な同意の取得その他法令上の対応を自ら行うものとします。",
      "クリエイターは、モデルの出力内容、性能、提供の継続性について自ら責任を負い、説明ページにおいてモデルの用途・制約を誤認させない表示を行うものとします。",
    ],
  },
  {
    heading: "5. 利用者の責任",
    paragraphs: [
      "利用者は、モデルの出力が誤りや偏りを含み得ることを理解し、自らの判断と責任で利用するものとします。モデルに送信する入力に個人情報や機密情報を含める場合、利用者は必要な同意の取得その他法令上の対応を自ら行うものとします。",
    ],
  },
  {
    heading: "6. 料金・クレジット",
    paragraphs: [
      "モデルの利用料金は、クリエイターが設定する価格（入力・出力のトークン数あたり、および1リクエストあたり）とし、利用のつど利用者のクレジットから差し引きます。単価は各モデルの詳細ページに表示します。",
      "クレジットは前払い式であり、Stripeの決済画面を通じて購入します。法令に別段の定めがある場合を除き、払い戻しは行いません。ストリーミング応答や計算資源の精算の性質上、精算後の残高が一時的にマイナスとなることがあり、その場合ユーザーは不足額を支払うものとします。",
    ],
  },
  {
    heading: "7. クリエイターへの支払い",
    paragraphs: [
      `クリエイターの売上は、利用料金のうちクリエイター価格部分から運営者の手数料（${FEE_PERCENT}%）を差し引いた額とし、クリエイターの売上として計上します。売上は Stripe Connect を通じて、クリエイターが登録した口座へ支払います。支払いを受けるには、Stripe の定める本人確認等の手続きを完了する必要があります。`,
      "不正な利用、チャージバック、本規約違反が判明した場合、運営者は該当する売上の支払いを保留し、または取り消すことができます。",
    ],
  },
  {
    heading: "8. 禁止事項",
    paragraphs: [
      "ユーザーは、法令または公序良俗に違反する行為、第三者の知的財産権・プライバシーその他の権利を侵害する行為、マルウェアの作成・配布、不正アクセス、詐欺・なりすまし、児童の性的搾取に関わるコンテンツの生成、選挙や公衆衛生に関する欺瞞的な情報の大量生成、その他運営者が不適切と判断する目的で本サービスを利用してはなりません。",
      "また、本サービスの負荷試験や過度なリクエスト、レート制限の回避、他のユーザーのモデル設定・学習データ・シークレットを取得しようとする行為を禁止します。",
    ],
  },
  {
    heading: "9. コンテンツの取り扱い",
    paragraphs: [
      "学習データ、モデル（LoRAの重みを含む）およびその説明、ならびに利用者の入力・出力に関する権利は、各ユーザーに留保されます。ユーザーは運営者に対し、本サービスの提供・不正防止に必要な範囲で、これらを保存・処理・表示する権利を許諾するものとします。運営者は、学習データやモデルへの入力を運営者自身のモデルの学習に利用しません。",
    ],
  },
  {
    heading: "10. 公開の停止・アカウントの停止",
    paragraphs: [
      "運営者は、モデルまたはユーザーが本規約に違反するおそれがあると判断した場合、事前の通知なく、モデルの非公開化、学習やエンドポイントの停止、アカウントの停止その他必要な措置を講じることができます。",
    ],
  },
  {
    heading: "11. 外部サービス",
    paragraphs: [
      "本サービスは、計算資源とホスティング（Nebius）、決済（Stripe）、セキュリティ確認とメール配信（Cloudflare）その他の外部サービスを利用しています。外部サービスの障害や仕様変更、価格の改定により、本サービスの全部または一部を提供できない場合、または料金を改定する場合があります。",
    ],
  },
  {
    heading: "12. 免責・責任の制限",
    paragraphs: [
      "本サービスおよびモデルは現状有姿で提供され、運営者は特定目的への適合性、正確性、継続性、学習の結果について保証しません。運営者は、クリエイターと利用者その他の第三者との間の紛争に関与せず、責任を負いません。",
      "運営者が損害賠償責任を負う場合、その総額は、法令に別段の定めがある場合を除き、10,000円またはユーザーが過去6か月間に運営者へ支払った料金総額のいずれか高い方を上限とします。",
    ],
  },
  {
    heading: "13. 全般",
    paragraphs: [
      "運営者は、独自の裁量で本規約をいつでも改定できます。改定後にユーザーが本サービスの利用を継続した場合、改定後の規約に同意したものとみなします。本規約の最新版は、常に運営者サイトでご確認ください。",
      "本規約の一部が無効とされた場合でも、他の規定は有効に存続します。本規約は日本法に準拠し、本サービスに関する紛争は東京地方裁判所を第一審の専属的合意管轄裁判所とします。",
    ],
  },
];

// 英語版は参考訳。日本語版と食い違うときは日本語版が優先する
const SECTIONS_EN: LegalSection[] = [
  {
    heading: "Overview",
    paragraphs: [
      "These Terms of Service (the \"Terms\") set out the conditions for using Forkline, a platform for fine-tuning, publishing and earning from AI models, and all related services (the \"Service\"), provided by Soma Sekiguchi (the \"Operator\"). By using the Service, you agree to these Terms. These Terms are a legal agreement between you and the Operator.",
    ],
  },
  {
    heading: "1. Definitions",
    paragraphs: [
      "\"Creator\" means a user who creates and publishes AI models on the Service (NVIDIA Nemotron fine-tuned with LoRA on training data; each a \"Model\").",
      "\"User\" means a user who calls Models through the Service's screens or API. One user may be both a Creator and a User.",
      "\"Credits\" means a prepaid balance that a user buys on the Service in advance to pay for Model usage and compute.",
    ],
  },
  {
    heading: "2. Accounts",
    paragraphs: [
      "Accounts are created by registering with an email address and password or with a Google account. An account belongs to an individual and may not be transferred, lent or shared with a third party.",
      "Models, training data, API keys, Credits and earnings are held per account.",
      "An API key belongs to the user who created it. Calls made with an API key are treated as use by that user, and their charges are deducted from that user's Credits. Users are responsible for managing their credentials and API keys.",
    ],
  },
  {
    heading: "3. Training and compute",
    paragraphs: [
      "Model training (LoRA fine-tuning) and inference run on services of Nebius, the compute provider. Training data and LoRA weights are stored in Nebius object storage.",
      "Compute charges for training and endpoints are deducted from the Credits of the user who created the Model. An estimated amount is held from Credits when training starts and when an endpoint starts, and settled on the actual usage time at the end. Endpoints are charged for the time they run and stop automatically if not called for a certain period.",
      "Training or endpoint startup may be delayed or fail because of compute conditions. Even in that case, the time compute was actually used is charged.",
    ],
  },
  {
    heading: "4. Creator responsibilities",
    paragraphs: [
      "Creators warrant that they hold the necessary rights (including licenses) to the training data they upload, the Models they publish and their descriptions, and that they comply with applicable laws and the license terms of the base model. If training data contains personal information, the Creator is responsible for obtaining the necessary consent and meeting other legal requirements.",
      "Creators are responsible for their Model's output, performance and continued availability, and must not describe a Model's uses or limitations in a misleading way.",
    ],
  },
  {
    heading: "5. User responsibilities",
    paragraphs: [
      "Users understand that Model output may contain errors or bias, and use it at their own judgment and responsibility. If inputs sent to a Model contain personal or confidential information, the User is responsible for obtaining the necessary consent and meeting other legal requirements.",
    ],
  },
  {
    heading: "6. Charges and Credits",
    paragraphs: [
      "The charge for using a Model is the price set by the Creator (per number of input and output tokens, and per request), deducted from the User's Credits at each use. Prices are shown on each Model's detail page.",
      "Credits are prepaid and bought through Stripe's checkout. Except where required by law, no refunds are given. Because of streaming responses and compute settlement, the balance may temporarily become negative after settlement, in which case the user must pay the shortfall.",
    ],
  },
  {
    heading: "7. Payments to Creators",
    paragraphs: [
      `A Creator's earnings are the Creator-price portion of usage charges minus the Operator's fee (${FEE_PERCENT}%), credited to the Creator's earnings. Earnings are paid through Stripe Connect to the account the Creator has registered. To receive payouts, the Creator must complete identity verification and other steps required by Stripe.`,
      "If fraudulent use, a chargeback or a breach of these Terms is found, the Operator may withhold or cancel payment of the related earnings.",
    ],
  },
  {
    heading: "8. Prohibited conduct",
    paragraphs: [
      "Users must not use the Service for acts that violate laws or public order and morals, infringe the intellectual property, privacy or other rights of third parties, create or distribute malware, gain unauthorized access, commit fraud or impersonation, generate content involving the sexual exploitation of children, mass-produce deceptive information about elections or public health, or any other purpose the Operator deems inappropriate.",
      "Load testing of the Service, excessive requests, circumventing rate limits, and attempting to obtain other users' Model settings, training data or secrets are also prohibited.",
    ],
  },
  {
    heading: "9. Content",
    paragraphs: [
      "Rights to training data, Models (including LoRA weights) and their descriptions, and to Users' inputs and outputs, remain with each user. Users grant the Operator the right to store, process and display them to the extent needed to provide the Service and prevent abuse. The Operator does not use training data or Model inputs to train the Operator's own models.",
    ],
  },
  {
    heading: "10. Suspension of publication or accounts",
    paragraphs: [
      "If the Operator judges that a Model or user may be in breach of these Terms, the Operator may, without prior notice, unpublish the Model, stop training or endpoints, suspend accounts or take other necessary measures.",
    ],
  },
  {
    heading: "11. External services",
    paragraphs: [
      "The Service uses external services for compute and hosting (Nebius), payments (Stripe), bot checks and email delivery (Cloudflare) and others. Outages, specification changes or price changes in these services may prevent the Operator from providing all or part of the Service, or lead to changes in charges.",
    ],
  },
  {
    heading: "12. Disclaimer and limitation of liability",
    paragraphs: [
      "The Service and Models are provided as is. The Operator makes no warranty as to fitness for a particular purpose, accuracy, continuity or training results. The Operator is not involved in and is not responsible for disputes between Creators, Users or other third parties.",
      "If the Operator is liable for damages, its total liability is limited, except where the law provides otherwise, to the greater of 10,000 yen or the total fees the user paid the Operator in the past six months.",
    ],
  },
  {
    heading: "13. General",
    paragraphs: [
      "The Operator may revise these Terms at any time at its discretion. If a user continues to use the Service after a revision, the user is deemed to have agreed to the revised Terms. Always check the latest version on the Operator's site.",
      "If any part of these Terms is held invalid, the remaining provisions stay in effect. These Terms are governed by the laws of Japan, and the Tokyo District Court has exclusive jurisdiction in the first instance over disputes relating to the Service.",
    ],
  },
];

export default function Terms() {
  const locale = useLocale();
  if (locale === "en") {
    return (
      <LegalPage title="Terms of Service" notice={TRANSLATION_NOTICE}>
        <LegalSections sections={SECTIONS_EN} effectiveDate="Effective: October 26, 2026" />
      </LegalPage>
    );
  }
  return (
    <LegalPage title="利用規約">
      <LegalSections sections={SECTIONS_JA} effectiveDate="発効日: 2026年10月26日" />
    </LegalPage>
  );
}
