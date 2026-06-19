import { useState } from "react";

import { Button } from "./Button";

interface ActionButtonProps {
  onAction: () => Promise<void>;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

export function ActionButton({
  onAction,
  icon,
  children,
  variant = "secondary",
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setSuccess(false);
    try {
      await onAction();
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 1600);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      size="md"
      icon={icon}
      loading={loading}
      success={success}
      onClick={() => void handleClick()}
    >
      {children}
    </Button>
  );
}