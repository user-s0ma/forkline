import type { Route } from "./+types/privacy";
import {
  LegalPage,
  LegalSections,
  type LegalSection,
} from "@/components/landing/LegalPage";

// 注意: 以下のポリシー本文はたたき台です。公開前に必ず弁護士等の専門家による確認を受けること。

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Privacy Policy | Forkline" },
    {
      name: "description",
      content:
        "How Forkline handles personal information, training data and model usage data.",
    },
  ];
}

const SECTIONS: LegalSection[] = [
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
    heading: "3. Information that is made public",
    paragraphs: [
      "Models, training data, API keys, credits, earnings and usage records are kept per account and cannot be viewed by other users. Models published to the store show your account name as the creator.",
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
        text: "We may share information with providers we rely on to run the Service, such as payment processing (Stripe), compute and hosting (Nebius), bot checks and email delivery (Cloudflare) and the database (TiDB Cloud).",
      },
      {
        label: "Disclosure to creators:",
        text: "A creator receives aggregate information such as the number of calls to and earnings from its own models. We do not provide information that identifies users.",
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
      "Training data and LoRA weights are kept until the model or account is deleted. Usage and payment records are kept for the period required for accounting and tax purposes.",
    ],
  },
  {
    heading: "6. Security",
    paragraphs: [
      "The operator takes measures to protect personal information appropriately, including encryption in transit, encrypted storage of access tokens and similar secrets, hashed storage of API keys, and access control per account.",
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
  return (
    <LegalPage title="Privacy Policy">
      <LegalSections sections={SECTIONS} effectiveDate="Effective: October 26, 2026" />
    </LegalPage>
  );
}
