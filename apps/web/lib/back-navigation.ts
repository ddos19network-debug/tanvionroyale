/* eslint-disable react-hooks/exhaustive-deps */

"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState, useEffect, useRef } from "react";

export interface BackNavigationOptions {
  forceFallback?: boolean;
  fallback?: string;
  closeModalFirst?: boolean;
}

export function useAppBack() {
  const router = useRouter();
  const pathname = usePathname();

  const isRootLevel = useCallback(() => {
    return pathname === "/" || pathname === "/home" || pathname === "";
  }, [pathname]);

  const handleBack = useCallback((options?: BackNavigationOptions) => {
    const { forceFallback = false, fallback = "/", closeModalFirst = false } = options ?? {};

    if (closeModalFirst) {
      window.dispatchEvent(new CustomEvent("app:close-modal-requested"));
      setTimeout(() => {
        executeBack(router, fallback, forceFallback);
      }, 100);
      return;
    }

    executeBack(router, fallback, forceFallback);
  }, [pathname]);

  return {
    handleBack,
    isRootLevel,
    canGoBack: typeof window !== "undefined" && window.history.length > 1,
  };
}

function executeBack(router: ReturnType<typeof useRouter>, fallback: string, forceFallback: boolean) {
  if (forceFallback) {
    router.push(fallback);
    return;
  }

  if (typeof window !== "undefined" && window.history.length > 1) {
    try {
      router.back();
      return;
    } catch {
      // fall through
    }
  }

  router.push(fallback);
}

export function useTwoBackExit({
  exitConfirmMessage = "Exit TANVION ROYALE?",
  exitConfirmTimeoutMs = 2500,
}: {
  exitConfirmMessage?: string;
  exitConfirmTimeoutMs?: number;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const firstBackTime = useRef<number | null>(null);
  const exitConfirmed = useRef(false);

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitMessage, setExitMessage] = useState(exitConfirmMessage);

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/home" && pathname !== "") {
      firstBackTime.current = null;
      exitConfirmed.current = false;
      setShowExitConfirm(false);
    }
  }, [pathname]);

  const handleRootBack = useCallback(() => {
    const now = Date.now();
    if (firstBackTime.current === null) {
      firstBackTime.current = now;
      return;
    }
    if (now - firstBackTime.current < exitConfirmTimeoutMs && !exitConfirmed.current) {
      setShowExitConfirm(true);
      setExitMessage(exitConfirmMessage);
      firstBackTime.current = now;
    } else {
      firstBackTime.current = now;
    }
  }, [exitConfirmMessage, exitConfirmTimeoutMs]);

  const confirmExit = useCallback(() => {
    exitConfirmed.current = true;
    setShowExitConfirm(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("app:exit-requested"));
      if (pathname !== "/") {
        router.push("/");
      }
    }
  }, [pathname]);

  const cancelExit = useCallback(() => {
    setShowExitConfirm(false);
    firstBackTime.current = null;
    exitConfirmed.current = false;
  }, []);

  return {
    showExitConfirm,
    exitMessage,
    confirmExit,
    cancelExit,
    handleRootBack,
    isAtRoot: pathname === "/" || pathname === "/home" || pathname === "",
  };
}
