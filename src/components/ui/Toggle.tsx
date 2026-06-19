interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}

export function Toggle({ checked, onChange, label, hint }: ToggleProps) {
  return (
    <div className="ui-toggle-row">
      <div className="ui-toggle-copy">
        <span className="ui-toggle-label">{label}</span>
        {hint && <span className="ui-toggle-hint">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`ui-toggle${checked ? " ui-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle__thumb" />
      </button>
    </div>
  );
}