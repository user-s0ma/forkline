import type { Route } from "./+types/terms";
import {
  LegalPage,
  LegalSections,
  type LegalSection,
} from "@/components/landing/LegalPage";
import { PLATFORM_FEE_BPS } from "@/lib/billing/pricing";

// 注意: 以下の規約本文はたたき台です。公開前に必ず弁護士等の専門家による確認を受けること。

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Terms of Service | Forkline" },
    {
      name: "description",
      content: "The terms that govern use of Forkline, provided by Soma Sekiguchi.",
    },
  ];
}

const FEE_PERCENT = PLATFORM_FEE_BPS / 100;

const SECTIONS: LegalSection[] = [
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
  return (
    <LegalPage title="Terms of Service">
      <LegalSections sections={SECTIONS} effectiveDate="Effective: October 26, 2026" />
    </LegalPage>
  );
}
