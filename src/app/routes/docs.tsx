import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/docs";
import { gpuName } from "@/components/landing/gpu";
import { PageBand } from "@/components/landing/PageBand";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { CodeBlock } from "@/components/store/CodeBlock";
import { localeFromMatches, localeTag, translate, useLocale } from "@/lib/i18n";
import {
  PAYOUT_MIN_YEN,
  PLATFORM_FEE_BPS,
  TOPUP_MAX_YEN,
  TOPUP_MIN_YEN,
} from "@/lib/billing/pricing";
import {
  DEFAULT_ENDPOINT_IDLE_MINUTES,
  ENDPOINT_RETRY_AFTER_SECONDS,
  endpointIdleMinutes,
  TRAIN_HOLD_MULTIPLIER,
  TRAIN_MAX_SECONDS,
} from "@/lib/billing/compute";
import {
  DATASET_MAX_BYTES,
  DATASET_MAX_EXAMPLES,
  DATASET_MIN_EXAMPLES,
  DEFAULT_HYPERPARAMETERS,
  LORA_RANKS,
} from "@/lib/models/dataset";
import { listModels } from "@/lib/nebius/models";
import { appContext } from "@/lib/util/app-context";

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  const locale = localeFromMatches(matches);
  return [
    { title: translate(locale, "docs.metaTitle") },
    { name: "description", content: translate(locale, "docs.metaDescription") },
  ];
}

/** 自動停止までの分数は環境変数で変えられるので、サーバーで読んで文面に入れる */
export function loader({ context }: Route.LoaderArgs) {
  try {
    const { env } = context.get(appContext);
    return { idleMinutes: endpointIdleMinutes(env) };
  } catch {
    return { idleMinutes: DEFAULT_ENDPOINT_IDLE_MINUTES };
  }
}

const BASE_URL = "https://forkline.ai/v1";
// 例に使うモデルID。モデルIDの規則 (英小文字・数字・ハイフン) に合う、置き換える前提の名前
const MODEL = "your-model";

const CHAT_EXAMPLES = {
  curl: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $FORKLINE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
  python: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key=os.environ["FORKLINE_API_KEY"],
)

res = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(res.choices[0].message.content)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.FORKLINE_API_KEY,
});

const res = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(res.choices[0].message.content);`,
} as const;

const STREAM_EXAMPLE = `stream = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="")`;

const STREAM_TAIL = `data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":48,"total_tokens":60}}

data: [DONE]

: cost_jpy=…`;

const LIST_EXAMPLE = `curl ${BASE_URL}/models \\
  -H "Authorization: Bearer $FORKLINE_API_KEY"`;

const LIST_RESPONSE = `{
  "object": "list",
  "data": [
    { "id": "${MODEL}", "object": "model", "created": 1793000000, "owned_by": "your-org" }
  ]
}`;

const warmupExample = (retry: number) => `HTTP/1.1 503 Service Unavailable
Retry-After: ${retry}

{
  "error": {
    "message": "The model is starting up. Retry in about ${retry} seconds.",
    "type": "model_warming_up",
    "code": "model_warming_up"
  }
}`;

const RETRY_EXAMPLE = `client = OpenAI(
    base_url="${BASE_URL}",
    api_key=os.environ["FORKLINE_API_KEY"],
    max_retries=10,  # 503 + Retry-After
)`;

const ERROR_EXAMPLE = `{
  "error": {
    "message": "Insufficient credits. Top up your balance to continue.",
    "type": "insufficient_credits",
    "code": "insufficient_credits"
  }
}`;

const DATASET_EXAMPLE = `{"messages": [{"role": "system", "content": "You answer questions about our return policy."}, {"role": "user", "content": "How do I return an item?"}, {"role": "assistant", "content": "Send us your order number and …"}]}
{"messages": [{"role": "user", "content": "Who pays for return shipping?"}, {"role": "assistant", "content": "We do, if the item arrived damaged. …"}]}`;

const ERRORS: Array<[status: string, code: string, key: string]> = [
  ["400", "invalid_request", "invalidRequest"],
  ["401", "invalid_api_key", "invalidApiKey"],
  ["402", "insufficient_credits", "insufficientCredits"],
  ["403", "model_suspended", "modelSuspended"],
  ["404", "model_not_found", "modelNotFound"],
  ["409", "model_not_deployed", "modelNotDeployed"],
  ["429", "rate_limit_exceeded", "rateLimit"],
  ["502", "upstream_error", "upstream"],
  ["503", "model_warming_up", "warmingUp"],
  ["503", "model_unavailable", "unavailable"],
];

const GROUPS = [
  {
    key: "use",
    sections: ["quickstart", "auth", "chat", "streaming", "list", "pricing", "warmup", "errors"],
  },
  {
    key: "publish",
    sections: ["publish", "dataset", "hyperparameters", "baseModels", "compute", "payouts"],
  },
] as const;

type SectionId = (typeof GROUPS)[number]["sections"][number];
const SECTION_IDS: SectionId[] = GROUPS.flatMap((group) => [...group.sections]);

const prose = "max-w-[72ch] text-[15px] leading-[1.85] text-ink-soft";

/** エンドポイントの見出し: メソッドのピル + パス */
function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <p className="mt-5 inline-flex items-center gap-3 rounded-full border border-line bg-paper py-1 pr-4 pl-1 font-mono text-sm">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          method === "POST" ? "bg-brand text-on-brand" : "bg-line text-ink"
        }`}
      >
        {method}
      </span>
      {path}
    </p>
  );
}

function Section({
  id,
  vars,
  children,
}: {
  id: SectionId;
  vars?: Record<string, string | number>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={id} data-doc-section className="scroll-mt-28 border-t border-line pt-10">
      <h3 className="text-2xl font-semibold tracking-[-0.01em]">{t(`docs.${id}.title`)}</h3>
      <p className={`mt-3 ${prose}`}>{t(`docs.${id}.body`, vars)}</p>
      {children}
    </section>
  );
}

function Code({ label, code }: { label: string; code: string }) {
  return (
    <div className="mt-4">
      <CodeBlock label={label} code={code} highlight={code.includes(MODEL) ? MODEL : undefined} />
    </div>
  );
}

function BulletList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={`mt-4 space-y-2 pl-6 ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((item) => (
        <li key={item} className="text-[15px] leading-[1.85] text-ink-soft marker:text-ink-mute">
          {item}
        </li>
      ))}
    </List>
  );
}

function ChatExamples() {
  const [tab, setTab] = useState<keyof typeof CHAT_EXAMPLES>("curl");
  const keys = Object.keys(CHAT_EXAMPLES) as Array<keyof typeof CHAT_EXAMPLES>;
  return (
    <div className="mt-4">
      <div className="mb-2 flex gap-1" role="tablist" aria-label="language">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`chat-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="chat-panel"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
              tab === key ? "bg-ink font-semibold text-canvas" : "text-ink-soft hover:bg-paper hover:text-ink"
            }`}
          >
            {key}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="chat-panel" aria-labelledby={`chat-tab-${tab}`}>
        <CodeBlock label={tab} code={CHAT_EXAMPLES[tab]} highlight={MODEL} />
      </div>
    </div>
  );
}

/** 画面内に入っているセクションを目次で示す */
function useActiveSection() {
  const [active, setActive] = useState<string>(SECTION_IDS[0]);
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-section]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return active;
}

function GroupHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 pt-2 text-sm font-semibold text-brand-ink">
      {children}
    </h2>
  );
}

export default function Docs({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const tag = localeTag(useLocale());
  const active = useActiveSection();
  const idle = loaderData?.idleMinutes ?? DEFAULT_ENDPOINT_IDLE_MINUTES;
  const hp = DEFAULT_HYPERPARAMETERS;
  const yen = (value: number) => value.toLocaleString(tag);
  const models = listModels();

  return (
    <div className="site min-h-screen bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      <PageBand title={t("docs.title")} subline={t("docs.intro")}>
        <div className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-5 pl-1.5">
          <span className="rounded-full bg-paper px-3 py-1 text-xs text-ink-soft">
            {t("docs.baseUrl")}
          </span>
          <code className="font-mono text-sm break-all text-brand-ink">{BASE_URL}</code>
        </div>
      </PageBand>

      <div className="ui-container grid gap-12 pt-4 pb-24 lg:grid-cols-[14rem_1fr]">
        <nav className="hidden lg:block" aria-label={t("docs.toc")}>
          <div className="sticky top-24 space-y-6 pt-8">
            {GROUPS.map((group) => (
              <div key={group.key}>
                <p className="mb-2 text-xs font-semibold text-ink">{t(`docs.groups.${group.key}`)}</p>
                <div className="border-l border-line">
                  {group.sections.map((id) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      aria-current={active === id ? "true" : undefined}
                      className={`-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors ${
                        active === id
                          ? "border-brand-ink font-semibold text-ink"
                          : "border-transparent text-ink-mute hover:text-ink"
                      }`}
                    >
                      {t(`docs.${id}.title`)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-14 pt-8">
          <GroupHeading id="use">{t("docs.groups.use")}</GroupHeading>

          <Section id="quickstart">
            <BulletList
              ordered
              items={[
                t("docs.quickstart.steps.key"),
                t("docs.quickstart.steps.credits", { min: yen(TOPUP_MIN_YEN), max: yen(TOPUP_MAX_YEN) }),
                t("docs.quickstart.steps.call", { url: BASE_URL }),
              ]}
            />
          </Section>

          <Section id="auth">
            <Code label="header" code="Authorization: Bearer fk_..." />
          </Section>

          <Section id="chat">
            <Endpoint method="POST" path="/v1/chat/completions" />
            <ChatExamples />
            <p className="mt-3 text-sm leading-6 text-ink-mute">{t("docs.placeholder")}</p>
          </Section>

          <Section id="streaming">
            <Code label="python" code={STREAM_EXAMPLE} />
            <Code label="stream (end)" code={STREAM_TAIL} />
          </Section>

          <Section id="list">
            <Endpoint method="GET" path="/v1/models" />
            <Code label="request" code={LIST_EXAMPLE} />
            <Code label="response" code={LIST_RESPONSE} />
          </Section>

          <Section id="pricing">
            <BulletList
              items={[
                t("docs.pricing.units.tokens"),
                t("docs.pricing.units.request"),
                t("docs.pricing.units.hold"),
                t("docs.pricing.units.header"),
                t("docs.pricing.units.self"),
              ]}
            />
            <Code label="response header" code="X-Forkline-Cost-JPY: 0.0177" />
          </Section>

          <Section id="warmup" vars={{ idle, retry: ENDPOINT_RETRY_AFTER_SECONDS }}>
            <Code label="response" code={warmupExample(ENDPOINT_RETRY_AFTER_SECONDS)} />
            <p className={`mt-5 ${prose}`}>{t("docs.warmup.retry")}</p>
            <Code label="python" code={RETRY_EXAMPLE} />
          </Section>

          <Section id="errors">
            <Code label="response" code={ERROR_EXAMPLE} />
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
              <table className="console-table">
                <thead>
                  <tr>
                    <th scope="col">{t("docs.errors.status")}</th>
                    <th scope="col">{t("docs.errors.code")}</th>
                    <th scope="col">{t("docs.errors.meaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ERRORS.map(([status, code, key]) => (
                    <tr key={code}>
                      <td className="num font-mono text-xs font-semibold whitespace-nowrap">{status}</td>
                      <td className="font-mono text-xs whitespace-nowrap text-brand-ink">{code}</td>
                      <td className="min-w-56 text-ink-soft">{t(`docs.errors.${key}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <GroupHeading id="creators">{t("docs.groups.publish")}</GroupHeading>

          <Section id="publish">
            <BulletList
              ordered
              items={(["dataset", "train", "deploy", "test", "price"] as const).map((key) =>
                t(`docs.publish.steps.${key}`),
              )}
            />
          </Section>

          <Section id="dataset">
            <Code label="train.jsonl" code={DATASET_EXAMPLE} />
            <BulletList
              items={[
                t("docs.dataset.rules.user"),
                t("docs.dataset.rules.count", {
                  min: DATASET_MIN_EXAMPLES,
                  max: DATASET_MAX_EXAMPLES.toLocaleString(tag),
                }),
                t("docs.dataset.rules.size", {
                  mb: Math.round(DATASET_MAX_BYTES / 1024 / 1024),
                }),
                t("docs.dataset.rules.check"),
              ]}
            />
          </Section>

          <Section id="hyperparameters">
            <dl className="mt-6 divide-y divide-line rounded-2xl border border-line">
              {(
                [
                  ["epochs", hp.epochs],
                  ["learningRate", hp.learningRate],
                  ["loraRank", hp.loraRank],
                  ["loraAlpha", hp.loraAlpha],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="p-5">
                  <dt className="flex items-baseline justify-between gap-3 font-mono text-sm font-semibold text-ink">
                    {key}
                    <span className="num text-xs font-normal text-ink-mute">
                      {t("docs.baseModels.default")}: {String(value)}
                    </span>
                  </dt>
                  <dd className={`mt-1.5 ${prose}`}>
                    {t(`docs.hyperparameters.${key}`, { ranks: LORA_RANKS.join(", ") })}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="baseModels">
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
              <table className="console-table">
                <thead>
                  <tr>
                    <th scope="col">{t("docs.baseModels.model")}</th>
                    <th scope="col">{t("docs.baseModels.train")}</th>
                    <th scope="col">{t("docs.baseModels.serve")}</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model, index) => (
                    <tr key={model.id}>
                      <td className="min-w-56">
                        <span className="font-semibold">{model.label}</span>
                        {index === 0 && (
                          <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-xs text-brand-ink">
                            {t("docs.baseModels.default")}
                          </span>
                        )}
                        <span className="mt-0.5 block font-mono text-xs break-all text-ink-mute">
                          {model.id}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">{gpuName(model.trainPreset)}</td>
                      <td className="whitespace-nowrap">{gpuName(model.servePreset)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="compute">
            <BulletList
              items={[
                t("docs.compute.items.train", {
                  multiplier: TRAIN_HOLD_MULTIPLIER,
                  hours: TRAIN_MAX_SECONDS / 3600,
                }),
                t("docs.compute.items.endpoint"),
                t("docs.compute.items.idle", { idle }),
              ]}
            />
          </Section>

          <Section id="payouts">
            <BulletList
              items={[
                t("docs.payouts.items.price"),
                t("docs.payouts.items.fee", { fee: PLATFORM_FEE_BPS / 100 }),
                t("docs.payouts.items.payout", { min: yen(PAYOUT_MIN_YEN) }),
              ]}
            />
          </Section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
