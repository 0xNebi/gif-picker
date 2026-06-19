import { useEffect, useState } from "react";

interface ToastProps {
  message: string | null;
  onClear: () => void;
}

export function Toast({ message, onClear }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onClear, 220);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [message, onClear]);

  return (
    <div
      className={`ui-toast${visible ? " ui-toast--visible" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="ui-toast__dot" aria-hidden />
      <span>{message}</span>
    </div>
  );
}