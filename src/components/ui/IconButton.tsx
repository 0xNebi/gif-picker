import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  label: string;
  children: ReactNode;
  tone?: "default" | "danger";
}

export function IconButton({
  size = "md",
  label,
  children,
  tone = "default",
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`ui-icon-btn ui-icon-btn--${size} ui-icon-btn--${tone} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}