'use client';

/**
 * Modal + confirmation dialog for destructive/financial admin actions
 * (Phase 17). Focus is trapped lightly (initial focus + Escape to close).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@tanvion-royale/ui';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // `onClose` is virtually always an inline arrow (`() => setX(...)`) so its
  // identity changes on every parent render — including every keystroke in a
  // controlled input inside the dialog. It must NOT be a `useEffect`
  // dependency, otherwise the effect below re-runs (and re-focuses the dialog
  // container, stealing focus out of the input) on every character typed.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    // Only move focus into the dialog once, on the closed -> open transition,
    // and never yank it away from an input/textarea/select the user is
    // already typing in (e.g. an `autoFocus` field inside the dialog, or a
    // re-render caused by typing in a controlled field).
    if (!wasOpenRef.current) {
      const active = document.activeElement;
      if (!ref.current?.contains(active ?? null)) {
        ref.current?.focus();
      }
    }
    wasOpenRef.current = true;
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[85vh] w-full overflow-y-auto rounded-lg border border-ink-600 bg-ink-900 shadow-2xl outline-none ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4 text-sm text-slate-300">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-600 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}
