import { useEffect, useId, useRef, useState } from "react";
import { Plus, Tag } from "lucide-react";

import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

interface TagAssignDialogProps {
  open: boolean;
  mediaName?: string;
  allTags: string[];
  assignedTags: string[];
  onToggleTag: (tag: string) => void;
  onCreateTag: (tag: string) => void;
  onClose: () => void;
}

export function TagAssignDialog({
  open,
  mediaName,
  allTags,
  assignedTags,
  onToggleTag,
  onCreateTag,
  onClose,
}: TagAssignDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [newTag, setNewTag] = useState("");
  const assignedSet = new Set(assignedTags);

  useEffect(() => {
    if (!open) {
      setNewTag("");
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleCreate() {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    onCreateTag(trimmed);
    setNewTag("");
    inputRef.current?.focus();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="tag-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tag-assign-dialog__header">
          <div>
            <h3 id={titleId}>Assign tags</h3>
            {mediaName && (
              <p className="tag-assign-dialog__subtitle">{mediaName}</p>
            )}
          </div>
          <IconButton size="sm" label="Close dialog" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>

        <p className="tag-assign-dialog__hint">
          Click a tag to apply or remove it from this item.
        </p>

        {allTags.length > 0 ? (
          <div className="tag-assign-dialog__chips" role="listbox" aria-label="Tags">
            {allTags.map((tag) => {
              const isAssigned = assignedSet.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={isAssigned}
                  className={`tag-pick-chip${isAssigned ? " is-assigned" : ""}`}
                  onClick={() => onToggleTag(tag)}
                >
                  <Tag size={12} strokeWidth={1.5} />
                  {tag}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="tag-assign-dialog__empty">
            No tags yet. Create one below to get started.
          </p>
        )}

        <div className="tag-assign-dialog__create">
          <label className="tag-assign-dialog__create-label" htmlFor={`${titleId}-new`}>
            Create new tag
          </label>
          <div className="tag-assign-dialog__create-row">
            <input
              ref={inputRef}
              id={`${titleId}-new`}
              className="tag-assign-dialog__field"
              type="text"
              value={newTag}
              placeholder="e.g. reactions, memes"
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <Button
              variant="secondary"
              size="md"
              icon={<Plus size={14} strokeWidth={1.5} />}
              onClick={handleCreate}
              disabled={!newTag.trim()}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="tag-assign-dialog__actions">
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}