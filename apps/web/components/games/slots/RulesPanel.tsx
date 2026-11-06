'use client';

import React, { useEffect } from 'react';
import type { SlotConfigView } from '@tanvion-royale/types';

interface RulesPanelProps {
  config: SlotConfigView;
  isOpen: boolean;
  onClose: () => void;
}

export function RulesPanel({ config, isOpen, onClose }: RulesPanelProps) {
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
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/20 bg-slate-950 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-xl font-black text-amber-300">
            {config.title} — Game Rules
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <div>
            <h3 className="font-bold text-white mb-1">Win Model</h3>
            <p>
              {config.winModel === 'paylines' &&
                `Played with ${config.lineCount ?? 25} fixed paylines across a ${config.reels}×${config.rows} grid. Wins pay left-to-right on adjacent reels.`}
              {config.winModel === 'ways' &&
                `Played with ${config.reels} reels and ${config.rows} rows (ways-to-win). Matching symbols on consecutive reels from left to right award a win.`}
              {config.winModel === 'cluster' &&
                `Played on a ${config.reels}×${config.rows} grid. Winning clusters form from 5 or more horizontally or vertically adjacent matching symbols.`}
            </p>
          </div>

          <div>
            <h3 className="font-bold text-white mb-1">Wild & Scatter</h3>
            <p>
              Wild symbols substitute for all paying symbols to help complete wins, but never substitute for Scatters or bonus symbols. Scatters pay or trigger features anywhere on the board.
            </p>
          </div>

          {config.freeSpins && (
            <div>
              <h3 className="font-bold text-white mb-1">Free Spins Feature</h3>
              <p>
                Landing {config.freeSpins.triggerCount}+ Scatter symbols triggers {config.freeSpins.awarded} Free Spins.
                {config.freeSpins.retriggerCount &&
                  ` Landing ${config.freeSpins.retriggerCount}+ Scatters during the feature awards +${config.freeSpins.retriggerAwarded} additional spins.`}
              </p>
            </div>
          )}

          <div>
            <h3 className="font-bold text-white mb-1">Features</h3>
            <ul className="list-disc list-inside space-y-1">
              {config.features.map((f) => (
                <li key={f.id}>
                  <strong className="text-amber-200">{f.name}</strong>: {f.description}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
            <strong>Free-Play Only:</strong> This game uses virtual points. No real money or real wallet transactions are involved. Max win is capped at {(config.maxWinBp / 10000).toLocaleString()}× stake per round.
          </div>
        </div>
      </div>
    </div>
  );
}
