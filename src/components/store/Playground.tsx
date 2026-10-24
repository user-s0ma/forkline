import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  playgroundChatStream,
  type ChatMessage,
} from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import { formatYen, yenToMicros } from "@/lib/billing/pricing";
import { AssistantReply } from "./AssistantReply";
import { appendDelta, type Reply } from "./reply";

type PlaygroundProps = {
  slug: string;
  /** 料金を払う組織 */
  organizationId: string;
};

/** message が null のときは、エンドポイントの起動待ち */
type ErrorState = { message: string | null; insufficient: boolean } | null;

function toErrorState(error: unknown, fallback: string): ErrorState {
  if (error instanceof ApiError) {
    return {
      message: error.code === "model_warming_up" ? null : error.message,
      insufficient:
        error.code === "insufficient_credits" || error.status === 402,
    };
  }
  return { message: fallback, insufficient: false };
}

function PlaygroundError({
  error,
  organizationId,
}: {
  error: NonNullable<ErrorState>;
  organizationId: string;
}) {
  const { t } = useTranslation();
  // 止まっていたエンドポイントは起こしたところなので、エラーではなく「起動中」として伝える
  if (error.message === null) {
    return (
      <div
        role="status"
        className="rounded-(--radius-control) bg-signal-tint px-3 py-2.5 text-sm text-signal"
      >
        {t("store.playground.warmingUp")}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-(--radius-control) bg-danger-tint px-3 py-2.5 text-sm text-danger"
    >
      {error.insufficient
        ? t("store.playground.insufficientCredits")
        : error.message}
      {error.insufficient && (
        <a
          href={`/app/${encodeURIComponent(organizationId)}/billing`}
          className="ml-2 font-semibold underline"
        >
          {t("store.playground.topUp")}
        </a>
      )}
    </div>
  );
}

function useCostFormatter() {
  const locale = useLocale();
  return (costYen: number | null) =>
    costYen === null
      ? null
      : formatYen(yenToMicros(costYen), localeTag(locale));
}

/** 思考は表示だけに使い、次の送信には本文だけを載せる */
type Turn = ChatMessage & { cost?: string | null; reasoning?: string };

function ChatPlayground({ slug, organizationId }: PlaygroundProps) {
  const { t } = useTranslation();
  const formatCost = useCostFormatter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pending]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    const history: Turn[] = [...turns, { role: "user", content }];
    setTurns(history);
    setDraft("");
    setPending(true);
    setError(null);
    // 返答は届いたそばから末尾の吹き出しに足していく
    let stream = { raw: "", reasoning: "" };
    let reply: Reply = { content: "", reasoning: "" };
    try {
      const { costYen } = await playgroundChatStream(
        organizationId,
        {
          model: slug,
          messages: history.map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        },
        (delta) => {
          ({ state: stream, reply } = appendDelta(stream, delta));
          setTurns([...history, { role: "assistant", ...reply }]);
        },
      );
      setTurns([
        ...history,
        { role: "assistant", ...reply, cost: formatCost(costYen) },
      ]);
    } catch (caught) {
      setError(toErrorState(caught, t("store.playground.failed")));
      // 途中まで届いていればそのまま残し、何も届いていなければ送信前に戻す
      if (!reply.content && !reply.reasoning) {
        setTurns(turns);
        setDraft(content);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={scrollRef}
        className="h-80 space-y-4 overflow-y-auto rounded-2xl border border-line bg-surface/60 p-3"
        aria-live="polite"
      >
        {turns.length === 0 && !pending && (
          <p className="flex h-full items-center justify-center text-center text-sm text-ink-mute">
            {t("store.playground.emptyChat")}
          </p>
        )}
        {turns.map((turn, index) => (
          <div
            key={index}
            className={`flex flex-col ${turn.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink ${
                turn.role === "user" ? "bg-brand-tint" : "bg-paper"
              }`}
            >
              <span className="sr-only">
                {turn.role === "user"
                  ? t("store.playground.you")
                  : t("store.playground.assistant")}
                :{" "}
              </span>
              {turn.role === "assistant" ? (
                <AssistantReply
                  reply={{ content: turn.content, reasoning: turn.reasoning ?? "" }}
                  streaming={pending && index === turns.length - 1}
                />
              ) : (
                turn.content
              )}
            </div>
            {turn.cost && (
              <span className="num mt-1 text-xs text-ink-mute">
                {t("store.playground.cost", { cost: turn.cost })}
              </span>
            )}
          </div>
        ))}
        {pending && turns.at(-1)?.role !== "assistant" && (
          <p className="animate-pulse text-sm text-ink-mute">
            {t("store.playground.sending")}
          </p>
        )}
      </div>
      {error && <PlaygroundError error={error} organizationId={organizationId} />}
      <form className="flex gap-2" onSubmit={send}>
        <textarea
          className="console-input h-auto! min-h-10 flex-1 resize-none py-2 leading-6"
          rows={2}
          value={draft}
          maxLength={20_000}
          placeholder={t("store.playground.messagePlaceholder")}
          aria-label={t("store.playground.messagePlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-col gap-2">
          <button
            className="console-button-primary"
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label={t("store.playground.send")}
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            className="console-button-secondary px-3!"
            type="button"
            disabled={pending || turns.length === 0}
            aria-label={t("store.playground.clear")}
            title={t("store.playground.clear")}
            onClick={() => {
              setTurns([]);
              setError(null);
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * モデルを試すためのプレイグラウンド。料金は選んでいる組織のクレジットから引き落とされる。
 * コンソールのモデル画面と公開ページの両方で使う。
 */
export function Playground({ slug, organizationId }: PlaygroundProps) {
  // モデルや組織が変わったら会話をリセットする
  return (
    <ChatPlayground
      key={`${organizationId}:${slug}`}
      slug={slug}
      organizationId={organizationId}
    />
  );
}
