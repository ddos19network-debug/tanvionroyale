import React from "react";
import { PHARAOH_SYMBOLS, type PharaohSymbolId } from "./pharaoh-types";
import { PHARAOH_PUBLIC_IMAGES } from "./pharaoh-images";

function debounce() {
  return (e: React.MouseEvent) => e.stopPropagation();
}

export function PaytablePanel({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-400/50 bg-slate-900 p-5 shadow-2xl"
        onClick={debounce()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black tracking-wide text-amber-300">
            Paytable
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 transition hover:text-white"
            aria-label="Close paytable"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {PHARAOH_SYMBOLS.map((sym) => {
            const src = PHARAOH_PUBLIC_IMAGES[sym.id];
            return (
              <div
                key={sym.id}
                className="flex items-center gap-2 rounded-xl bg-black/40 p-2"
              >
                <img
                  src={src}
                  alt={sym.name}
                  className="h-10 w-10 rounded object-contain sm:h-12 sm:w-12"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-amber-200">
                    {sym.name}
                  </div>
                  <div
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      sym.type === "wild"
                        ? "text-amber-400"
                        : sym.type === "scatter"
                        ? "text-cyan-400"
                        : "text-slate-500"
                    }`}
                  >
                    {sym.type}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl bg-black/40 p-3 text-xs text-slate-400">
          <p className="font-semibold text-amber-300">Wild</p>
          <p className="mt-1">Substitutes for every symbol except Scatter.</p>
        </div>

        <div className="mt-2 rounded-xl bg-black/40 p-3 text-xs text-slate-400">
          <p className="font-semibold text-cyan-400">Scatter</p>
          <p className="mt-1">
            Landing 3 or more triggers the Golden Tomb Bonus round.
          </p>
        </div>
      </div>
    </div>
  );
}

export function GameRulesPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const rules = [
    {
      label: "Board",
      text: "5 reels × 4 rows gameplay grid. Cash in on matching symbols.",
    },
    {
      label: "Paylines",
      text: "All 5 reels are active. Higher matching clusters pay more.",
    },
    {
      label: "Wild",
      text: "Ancient Wild substitutes for every symbol except Scatter.",
    },
    {
      label: "Scatter",
      text: "Three or more Golden Scatter payasters trigger Free Spins.",
    },
    {
      label: "Cascade",
      text: "Matching symbols disappear and new reels fall into place.",
    },
    {
      label: "Bonus",
      text: "Free Spins sometimes produce the Golden Tomb Bonus.",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-400/50 bg-slate-900 p-5 shadow-2xl"
        onClick={debounce()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black tracking-wide text-amber-300">
            Game Rules
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 transition hover:text-white"
            aria-label="Close rules"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-3">
          {rules.map((rule, i) => (
            <li
              key={i}
              className="rounded-xl bg-black/40 p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                {rule.label}
              </p>
              <p className="mt-1 text-sm text-slate-300">{rule.text}</p>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl bg-amber-950/40 p-3 text-xs text-slate-400">
          <p className="font-semibold text-amber-300">Balance</p>
          <p className="mt-1">Free-play currency. No real money is involved.</p>
        </div>
      </div>
    </div>
  );
}
