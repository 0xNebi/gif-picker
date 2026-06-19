interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  hint?: string;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}

export function Slider({
  value,
  min,
  max,
  step,
  label,
  hint,
  formatValue,
  onChange,
}: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="ui-slider-row">
      <div className="ui-slider-copy">
        <span className="ui-slider-label">{label}</span>
        {hint && <span className="ui-slider-hint">{hint}</span>}
      </div>
      <div className="ui-slider">
        <div className="ui-slider__track-wrap">
          <div className="ui-slider__track">
            <div className="ui-slider__fill" style={{ width: `${percent}%` }} />
          </div>
          <input
            type="range"
            className="ui-slider__input"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-label={label}
          />
        </div>
        <span className="ui-slider__value">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
    </div>
  );
}