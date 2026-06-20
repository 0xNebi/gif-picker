import type { ReactNode } from "react";

import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

export interface OptionListItem {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  disabled?: boolean;
}

interface OptionListProps {
  title: string;
  items: OptionListItem[];
  onToggle: (id: string, checked: boolean) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  emptyNote?: ReactNode;
}

export function OptionList({
  title,
  items,
  onToggle,
  onSelectAll,
  onSelectNone,
  emptyNote,
}: OptionListProps) {
  return (
    <div className="ui-option-list">
      <div className="ui-option-list__header">
        <span className="ui-option-list__title">{title}</span>
        {(onSelectAll || onSelectNone) && (
          <div className="ui-option-list__actions">
            {onSelectAll && (
              <Button variant="ghost" size="sm" onClick={onSelectAll}>
                All
              </Button>
            )}
            {onSelectNone && (
              <Button variant="ghost" size="sm" onClick={onSelectNone}>
                None
              </Button>
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        emptyNote ?? (
          <p className="ui-option-list__empty">No folders available.</p>
        )
      ) : (
        <div className="ui-option-list__rows">
          {items.map((item) => (
            <div
              key={item.id}
              className={`ui-option-row${item.checked ? " is-checked" : ""}`}
            >
              <Checkbox
                checked={item.checked}
                disabled={item.disabled}
                onChange={(checked) => onToggle(item.id, checked)}
                label={item.label}
                className="ui-option-row__checkbox"
              />
              {item.count !== undefined && (
                <span className="ui-option-row__count">{item.count}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}