'use client';

import React, { useState } from 'react';

interface AutoPlayProps {
  autoPlayCount: number;
  onStart: (count: number) => void;
  onStop: () => void;
  disabled?: boolean;
}

export function AutoPlay({
  autoPlayCount,
  onStart,
  onStop,
  disabled = false,
}: AutoPlayProps) {
  const [showOptions, setShowOptions] = useState(false);

  if (autoPlayCount > 0) {
    return (
      <button
        type="button"
        onClick={onStop}
        className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white shadow hover:bg-rose-500 transition animate-pulse"
      >
        Stop ({autoPlayCount})
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowOptions((s) => !s)}
        disabled={disabled}
        className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 transition disabled:opacity-40"
      >
        Auto
      </button>

      {showOptions && (
        <div className="absolute bottom-full mb-2 left-0 z-20 flex flex-col gap-1 rounded-xl border border-white/20 bg-slate-900 p-2 shadow-xl backdrop-blur">
          {[10, 25, 50].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onStart(n);
                setShowOptions(false);
              }}
              className="rounded-lg px-4 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/20 text-left transition"
            >
              {n} spins
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
