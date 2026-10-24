import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type IconComponent = ComponentType<{ className?: string }>;

type ConsoleSelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconComponent;
  group?: string;
};

type ConsoleSelectProps<T extends string> = {
  value: T;
  options: ConsoleSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

export function ConsoleSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  ariaLabel,
  className = "",
}: ConsoleSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{
    up: boolean;
    maxHeight: number;
    left: number;
    width: number;
    edge: number;
  }>({ up: false, maxHeight: 224, left: 0, width: 0, edge: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((option) => option.value === value);
  const ButtonIcon = selected?.icon;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const updateMenuPlacement = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const up = below < 176 && above > below;
    const space = up ? above : below;
    setMenu({
      up,
      maxHeight: space,
      left: rect.left,
      width: rect.width,
      edge: up ? window.innerHeight - rect.top + 4 : rect.bottom + 4,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open, updateMenuPlacement]);

  return (
    <div
      className={`relative ${className}`}
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        className="console-panel flex h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-paper disabled:cursor-wait disabled:opacity-50"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
      >
        {ButtonIcon && <ButtonIcon className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open &&
        createPortal(
          // モーダルのスクロール領域で切られないよう、画面の最前面に描く
          <div
            className="console-panel fixed z-60 overflow-hidden"
            ref={menuRef}
            role="menu"
            style={{
              left: menu.left,
              width: menu.width,
              ...(menu.up ? { bottom: menu.edge } : { top: menu.edge }),
            }}
          >
            <div
              className="overflow-y-auto"
              style={{ maxHeight: menu.maxHeight }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                const OptionIcon = option.icon;
                const heading =
                  option.group && option.group !== options[index - 1]?.group
                    ? option.group
                    : null;
                return (
                  <div key={option.value}>
                    {heading && (
                      <div className="border-t border-line px-2.5 pt-2 pb-1 text-[10px] text-ink-mute first:border-t-0">
                        {heading}
                      </div>
                    )}
                    <button
                      className="flex min-h-9 w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-paper"
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      onClick={() => {
                        setOpen(false);
                        onChange(option.value);
                      }}
                    >
                      {OptionIcon && (
                        <OptionIcon className="h-4 w-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      {isSelected && <Check className="h-4 w-4 text-brand-ink" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
