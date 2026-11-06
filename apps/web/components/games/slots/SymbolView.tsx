'use client';

import React from 'react';
import type { SlotSymbolMeta } from '@tanvion-royale/types';

interface SymbolViewProps {
  symbolId: string;
  symbolsMeta?: SlotSymbolMeta[];
  className?: string;
  size?: number;
}

export function SymbolView({
  symbolId,
  symbolsMeta,
  className = '',
  size = 56,
}: SymbolViewProps) {
  const meta = symbolsMeta?.find((s) => s.id === symbolId);
  const glyph = meta?.glyph ?? getGlyphFallback(symbolId);
  const name = meta?.name ?? symbolId.replace(/_/g, ' ');

  return (
    <div
      className={`relative flex items-center justify-center select-none rounded-xl bg-black/40 p-1.5 transition-transform hover:scale-105 ${className}`}
      style={{ width: size, height: size }}
      title={name}
      aria-label={name}
    >
      {meta?.asset ? (
        <img
          src={meta.asset}
          alt={name}
          className="max-h-full max-w-full object-contain"
          draggable={false}
          onError={(e) => {
            // hide broken image and fall back to text glyph
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      ) : null}
      <span
        className="text-2xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
        style={{ display: meta?.asset ? 'none' : 'block' }}
      >
        {glyph}
      </span>
    </div>
  );
}

function getGlyphFallback(id: string): string {
  if (id.includes('wild')) return '🌟';
  if (id.includes('scatter') || id.includes('gate') || id.includes('egg') || id.includes('station') || id.includes('castle') || id.includes('treasure') || id.includes('crown') || id.includes('airship')) return '⭐';
  if (id.includes('pharaoh') || id.includes('king') || id.includes('samurai') || id.includes('dragon') || id.includes('robot') || id.includes('queen')) return '👑';
  if (id.includes('ankh') || id.includes('eye') || id.includes('crystal') || id.includes('trident') || id.includes('gem')) return '💎';
  if (id.includes('coin') || id.includes('pearl') || id.includes('gold')) return '🪙';
  return '🔷';
}
