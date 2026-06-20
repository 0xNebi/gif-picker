import { Check } from "lucide-react";
import { useId, type ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  id,
  className = "",
}: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  return (
    <label
      className={`ui-checkbox${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      htmlFor={controlId}
    >
      <input
        id={controlId}
        type="checkbox"
        className="ui-checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-checkbox__box" aria-hidden>
        {checked && <Check size={12} strokeWidth={2.5} />}
      </span>
      {(label || hint) && (
        <span className="ui-checkbox__copy">
          {label && <span className="ui-checkbox__label">{label}</span>}
          {hint && <span className="ui-checkbox__hint">{hint}</span>}
        </span>
      )}
    </label>
  );
}