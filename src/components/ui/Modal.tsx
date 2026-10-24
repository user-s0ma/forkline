import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

const SIZE_CLASSES = {
  md: "max-w-md",
  "3xl": "max-w-3xl",
} as const;

type ModalProps = {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  size?: keyof typeof SIZE_CLASSES;
  onClose: () => void;
  children: React.ReactNode;
};

export function Modal({
  title,
  eyebrow,
  size = "md",
  onClose,
  children,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-raised sm:rounded-2xl ${SIZE_CLASSES[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs text-ink-mute">{eyebrow}</p>}
            <h2
              id={titleId}
              className={`truncate text-base font-semibold text-ink ${eyebrow ? "mt-1" : ""}`}
            >
              {title}
            </h2>
          </div>
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-mute hover:bg-paper"
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
