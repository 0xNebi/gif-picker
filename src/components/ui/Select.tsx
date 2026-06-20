import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  count?: number;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function Select({
  value,
  options,
  placeholder = "Choose…",
  onChange,
  label,
  id,
  disabled = false,
  fullWidth = false,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number }>(
    { top: 0, left: 0, width: 0 },
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  const handleMenuWheel = (event: WheelEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = menu;
    const delta = event.deltaY;
    const atTop = scrollTop <= 0 && delta < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight && delta > 0;
    if (!atTop && !atBottom) {
      event.stopPropagation();
    }
  };

  useLayoutEffect(() => {
    if (!open) return;

    const trigger = rootRef.current?.querySelector(".ui-select__trigger");
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const viewportPadding = 8;
    const fitsBelow =
      rect.bottom + menuHeight + viewportPadding <= window.innerHeight;
    const top = fitsBelow
      ? rect.bottom + 4
      : Math.max(viewportPadding, rect.top - menuHeight - 4);

    setMenuStyle({
      top,
      left: rect.left,
      width: rect.width,
    });
  }, [open, options.length, value]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setOpen(false);
        return;
      }
      if (
        menuRef.current?.contains(target) ||
        rootRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`ui-select${fullWidth ? " ui-select--full" : ""}${open ? " is-open" : ""}`}
    >
      {label && (
        <span className="ui-select__label" id={`${controlId}-label`}>
          {label}
        </span>
      )}
      <button
        type="button"
        id={controlId}
        className="ui-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={label ? `${controlId}-label` : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ui-select__value">
          {selected ? (
            <>
              <span className="ui-select__value-label">{selected.label}</span>
              {selected.count !== undefined && (
                <span className="ui-select__value-count">{selected.count}</span>
              )}
            </>
          ) : (
            <span className="ui-select__placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className="ui-select__chevron"
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="ui-select__menu ui-select__menu--portal"
            role="listbox"
            aria-labelledby={label ? `${controlId}-label` : controlId}
            onWheel={handleMenuWheel}
            style={{
              top: menuStyle.top,
              left: menuStyle.left,
              width: menuStyle.width,
            }}
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`ui-select__option${isSelected ? " is-selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="ui-select__option-body">
                    <span className="ui-select__option-label">{option.label}</span>
                    {option.hint && (
                      <span className="ui-select__option-hint">{option.hint}</span>
                    )}
                  </span>
                  {option.count !== undefined && (
                    <span className="ui-select__option-count">{option.count}</span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}