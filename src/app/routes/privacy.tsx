import type { Route } from "./+types/privacy";
import {
  LegalPage,
  LegalSections,
  TRANSLATION_NOTICE,
  type LegalSection,
} from "@/components/landing/LegalPage";
import { localeFromMatches, useLocale } from "@/lib/i18n";

// 注意: 以下のポリシー本文はたたき台です。公開前に必ず弁護士等の専門家による確認を受けること。

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  if (localeFromMatches(matches) === "en") {
    return [
      { title: "Privacy Policy | Forkline" },
      {
        name: "description",
        content:
          "How Forkline handles personal information, training data and model usage data.",
      },
    ];
  }
  return [
    { title: "プライバシーポリシー | Forkline" },
    {
      name: "description",
      content:
        "Forklineにおける個人情報、学習データ、モデル利用データの取り扱いを定めるプライバシーポリシーです。",
    },
  ];
}

const SECTIONS_JA: LegalSection[] = [
  {
    heading: "1. 収集する情報",
    paragraphs: [
      "本サービスのご利用には、メールアドレスとパスワード、またはGoogleアカウントによるログイン（アカウントの作成）が必要です。運営者（関口壮真）が収集する情報は、主に以下の通りです。",
    ],
    items: [
      {
        label: "アカウントの情報:",
        text: "氏名、メールアドレス、パスワードのハッシュ値（メールアドレスで登録した場合）、Googleログイン時にGoogleから提供されるプロフィール情報。",
      },
      {
        label: "組織の情報:",
        text: "組織名、メンバーとロール、招待の記録、組織内で行われた操作の記録（監査ログ）。",
      },
      {
        label: "モデルと学習の情報:",
        text: "モデルの設定・説明文・価格、アップロードされた学習データ（chat形式のJSONL）、学習の設定と結果（LoRAの重み）、エンドポイントのアクセストークン（暗号化して保存します）。",
      },
      {
        label: "モデルの利用に関する情報:",
        text: "呼び出したモデル、日時、トークン数、応答時間、料金などの利用記録。モデルへの入力・出力の内容は、応答を返すためにモデルの実行先へ送りますが、運営者は原則としてその内容を保存しません。",
      },
      {
        label: "決済・支払いに関する情報:",
        text: "クレジット購入の履歴、学習とエンドポイントの計算資源の利用履歴、出金の履歴。カード番号や口座情報は決済代行会社（Stripe）が取得・管理し、運営者は保持しません。",
      },
      {
        label: "自動的に収集される情報:",
        text: "IPアドレス、ブラウザの種類、アクセス日時、Cookie、不正なアクセスを防ぐための確認（Cloudflare Turnstile）の結果など、サービスの提供・セキュリティ確保のための技術情報。",
      },
    ],
  },
  {
    heading: "2. 利用目的",
    paragraphs: [
      "運営者は、収集した情報を、本サービスの提供・運営、モデルの学習と推論の実行、料金の精算とクリエイターへの支払い、不正利用の検知と防止、お問い合わせへの対応、サービスの改善、法令に基づく対応のために利用します。運営者は、ユーザーの学習データやモデルへの入力を、運営者自身のモデルの学習には利用しません。",
    ],
  },
  {
    heading: "3. 組織での共有",
    paragraphs: [
      "モデル、学習データ、APIキー、クレジット、売上、利用記録は組織に属し、その組織のメンバーが閲覧・利用できます。課金・出金・APIキー・公開・削除の操作は、組織のオーナーと管理者に限られます。",
    ],
  },
  {
    heading: "4. 第三者への提供・業務委託",
    items: [
      {
        label: "計算資源の提供元（Nebius）:",
        text: "学習データとLoRAの重みはNebiusのObject Storageに保存され、学習と推論はNebiusのServerless AI（Jobs・Endpoints）で実行されます。モデルを呼び出した場合、入力内容は推論のためにNebius上のエンドポイントへ送信されます。",
      },
      {
        label: "その他の業務委託先:",
        text: "決済処理（Stripe）、ホスティングとセキュリティ確認（Cloudflare）、データベース（TiDB Cloud）、メール配信など、本サービスの提供に必要な業務を委託する事業者と情報を共有することがあります。",
      },
      {
        label: "クリエイターへの開示:",
        text: "クリエイターの組織には、自身のモデルの利用回数や売上などの集計情報を提供します。利用者を特定できる情報は提供しません。",
      },
      {
        label: "法令に基づく場合:",
        text: "法令に基づく開示請求があった場合、または人の生命・身体・財産の保護のために必要な場合には、情報を開示することがあります。",
      },
    ],
  },
  {
    heading: "5. 保存期間",
    paragraphs: [
      "学習データとLoRAの重みは、モデルまたは組織が削除されるまで保存します。利用記録と決済の記録は、会計・税務上必要な期間保存します。",
    ],
  },
  {
    heading: "6. 安全管理",
    paragraphs: [
      "運営者は、通信の暗号化、アクセストークン等の暗号化保存、APIキーのハッシュ化保存、組織とロールによるアクセス制御など、個人情報を適切に保護するための措置を講じます。",
    ],
  },
  {
    heading: "7. 年齢制限",
    paragraphs: [
      "本サービスは18歳未満の方を対象としていません。また、お住まいの国で個人データの処理に同意するために必要な年齢に達している必要があります。",
    ],
  },
  {
    heading: "8. 開示・訂正・削除の請求",
    paragraphs: [
      "ユーザーは、運営者が保有する自己の個人情報の開示・訂正・削除を請求できます。support@forkline.ai までご連絡ください。アカウントはコンソールから削除することもできます。",
    ],
  },
  {
    heading: "9. 本プライバシーポリシーの変更",
    paragraphs: [
      "運営者は、必要に応じて本プライバシーポリシーを改訂することがあります。最新版のポリシーが、常にユーザーの個人データの取り扱いに適用されます。",
    ],
  },
];

// 英語版は参考訳。日本語版と食い違うときは日本語版が優先する
const SECTIONS_EN: LegalSection[] = [
  {
    heading: "1. Information we collect",
    paragraphs: [
      "To use the Service you must sign in (create an account) with an email address and password or with a Google account. The information the operator (Soma Sekiguchi) collects is mainly the following.",
    ],
    items: [
      {
        label: "Account information:",
        text: "Your name, email address, a hash of your password (if you register with email), and the profile information Google provides when you sign in with Google.",
      },
      {
        label: "Organization information:",
        text: "Organization name, members and roles, invitation records, and records of actions taken within the organization (audit log).",
      },
      {
        label: "Model and training information:",
        text: "Model settings, descriptions and prices, uploaded training data (chat-format JSONL), training settings and results (LoRA weights), and endpoint access tokens (stored encrypted).",
      },
      {
        label: "Model usage information:",
        text: "Usage records such as the model called, time, token counts, response time and charges. Inputs to and outputs from a model are sent to where the model runs in order to return a response, but as a rule the operator does not store their content.",
      },
      {
        label: "Payment information:",
        text: "Credit purchase history, compute usage history for training and endpoints, and payout history. Card numbers and bank details are collected and managed by our payment processor (Stripe); the operator does not hold them.",
      },
      {
        label: "Information collected automatically:",
        text: "Technical information needed to provide and secure the Service, such as IP address, browser type, access time, cookies and the result of bot checks (Cloudflare Turnstile).",
      },
    ],
  },
  {
    heading: "2. How we use information",
    paragraphs: [
      "The operator uses the information collected to provide and operate the Service, run model training and inference, settle charges and pay creators, detect and prevent abuse, respond to inquiries, improve the Service, and comply with the law. The operator does not use your training data or model inputs to train the operator's own models.",
    ],
  },
  {
    heading: "3. Sharing within an organization",
    paragraphs: [
      "Models, training data, API keys, credits, earnings and usage records belong to an organization and can be viewed and used by its members. Billing, payouts, API keys, publishing and deletion are limited to the organization's owners and admins.",
    ],
  },
  {
    heading: "4. Disclosure to third parties and service providers",
    items: [
      {
        label: "Compute provider (Nebius):",
        text: "Training data and LoRA weights are stored in Nebius Object Storage, and training and inference run on Nebius Serverless AI (Jobs and Endpoints). When you call a model, your input is sent to the Nebius endpoint for inference.",
      },
      {
        label: "Other service providers:",
        text: "We may share information with providers we rely on to run the Service, such as payment processing (Stripe), hosting and bot checks (Cloudflare), the database (TiDB Cloud) and email delivery.",
      },
      {
        label: "Disclosure to creators:",
        text: "A creator's organization receives aggregate information such as the number of calls to and earnings from its own models. We do not provide information that identifies users.",
      },
      {
        label: "When required by law:",
        text: "We may disclose information in response to a request based on law, or when necessary to protect a person's life, body or property.",
      },
    ],
  },
  {
    heading: "5. Retention",
    paragraphs: [
      "Training data and LoRA weights are kept until the model or organization is deleted. Usage and payment records are kept for the period required for accounting and tax purposes.",
    ],
  },
  {
    heading: "6. Security",
    paragraphs: [
      "The operator takes measures to protect personal information appropriately, including encryption in transit, encrypted storage of access tokens and similar secrets, hashed storage of API keys, and access control by organization and role.",
    ],
  },
  {
    heading: "7. Age requirement",
    paragraphs: [
      "The Service is not intended for anyone under 18. You must also be old enough to consent to the processing of personal data in your country of residence.",
    ],
  },
  {
    heading: "8. Requests for disclosure, correction or deletion",
    paragraphs: [
      "You may ask the operator to disclose, correct or delete the personal information it holds about you. Contact support@forkline.ai. You can also delete your account from the console.",
    ],
  },
  {
    heading: "9. Changes to this policy",
    paragraphs: [
      "The operator may revise this privacy policy as needed. The latest version always applies to the handling of your personal data.",
    ],
  },
];

export default function Privacy() {
  const locale = useLocale();
  if (locale === "en") {
    return (
      <LegalPage title="Privacy Policy" notice={TRANSLATION_NOTICE}>
        <LegalSections sections={SECTIONS_EN} effectiveDate="Effective: October 24, 2026" />
      </LegalPage>
    );
  }
  return (
    <LegalPage title="プライバシーポリシー">
      <LegalSections sections={SECTIONS_JA} effectiveDate="発効日: 2026年10月24日" />
    </LegalPage>
  );
}
