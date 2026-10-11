"use client";

import { Button } from "@tanvion-royale/ui";
import { useAppBack } from "@/lib/back-navigation";

interface AppBackButtonProps {
  label?: string;
  fallback?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  closeModalFirst?: boolean;
  className?: string;
}

export function AppBackButton({
  label = "Back",
  fallback = "/",
  variant = "outline",
  size = "sm",
  closeModalFirst = false,
  className = "",
}: AppBackButtonProps) {
  const { handleBack } = useAppBack();

  function onBack() {
    handleBack({ fallback, closeModalFirst });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onBack}
      className={className}
      aria-label={label}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="mr-1">
        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </Button>
  );
}

