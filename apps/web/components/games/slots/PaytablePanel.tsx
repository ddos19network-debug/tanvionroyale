'use client';

import React, { useEffect } from 'react';
import { SymbolView } from './SymbolView';
import type { SlotConfigView } from '@tanvion-royale/types';

interface PaytablePanelProps {
  config: SlotConfigView;
  isOpen: boolean;
  onClose: () => void;
}

export function PaytablePanel({ config, isOpen, onClose }: PaytablePanelProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/20 bg-slate-950 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-xl font-black text-amber-300">
            {config.title} — Paytable
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          All pays are shown in multiplier of line stake (or ways / cluster size). Free-play points only.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {config.paytable.map((pt) => {
            const sym = config.symbols.find((s) => s.id === pt.symbolId);
            return (
              <div
                key={pt.symbolId}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <SymbolView
                  symbolId={pt.symbolId}
                  symbolsMeta={config.symbols}
                  size={48}
                />
                <div className="flex-1">
                  <div className="font-bold text-sm text-white">
                    {sym?.name ?? pt.symbolId}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-300">
                    {pt.payBp
                      .map((bp, count) => {
                        if (bp <= 0 || count < 3) return null;
                        const mult = bp / 10000;
                        return (
                          <span
                            key={count}
                            className="rounded bg-black/40 px-1.5 py-0.5"
                          >
                            {count}×: <strong className="text-amber-300">{mult >= 1 ? `${mult.toFixed(1)}×` : `${mult.toFixed(2)}×`}</strong>
                          </span>
                        );
                      })
                      .filter(Boolean)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
