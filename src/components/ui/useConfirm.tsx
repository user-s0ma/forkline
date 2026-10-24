import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

type Pending = { message: string; danger: boolean; resolve: (ok: boolean) => void };

/**
 * window.confirm の代わりに、画面の中で確かめる (ブラウザの小窓は見た目が揃わず、開いている間は自動操作も止まる)。
 * confirm(message) は押されたボタンで true / false に解決する。返す dialog を描画しておくこと。
 */
export function useConfirm() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (message: string, options: { danger?: boolean } = {}) =>
      new Promise<boolean>((resolve) => setPending({ message, danger: Boolean(options.danger), resolve })),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = pending && (
    <Modal title={t("common.confirmTitle")} onClose={() => close(false)}>
      <p className="px-5 py-4 text-sm leading-6 whitespace-pre-line text-ink-soft">{pending.message}</p>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button className="console-button-secondary" type="button" onClick={() => close(false)}>
          {t("common.cancel")}
        </button>
        <button
          className={pending.danger ? "console-button-danger" : "console-button-primary"}
          type="button"
          autoFocus
          onClick={() => close(true)}
        >
          {t("common.continue")}
        </button>
      </div>
    </Modal>
  );

  return [confirm, dialog] as const;
}
