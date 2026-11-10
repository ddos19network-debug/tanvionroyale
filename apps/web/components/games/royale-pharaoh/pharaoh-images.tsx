import React, { useState } from 'react';
import { PHARAOH_SYMBOLS, normalizeSymbolKey } from './pharaoh-config';

/**
 * Public asset mapping for Royale Pharaoh symbols.
 * Pointing to /assets/image/royale pharaoh/[filename]
 */
export const PHARAOH_PUBLIC_IMAGES: Record<string, string> = {
  // Premium
  cleopatra: '/assets/image/royale pharaoh/cards/cleopatra.png',
  anubis: '/assets/image/royale pharaoh/cards/anubis.png',
  mask: '/assets/image/royale pharaoh/cards/mask.png',
  'pharaoh-mask': '/assets/image/royale pharaoh/cards/mask.png',
  scarab: '/assets/image/royale pharaoh/cards/scarab.png',
  'golden-scarab': '/assets/image/royale pharaoh/cards/scarab.png',
  sarcophagus: '/assets/image/royale pharaoh/cards/sarcophagus.png',

  // Regular
  ankh: '/assets/image/royale pharaoh/cards/ankh.png',
  horus: '/assets/image/royale pharaoh/cards/horus.png',
  'eye-of-horus': '/assets/image/royale pharaoh/cards/horus.png',
  coin: '/assets/image/royale pharaoh/cards/coin.png',
  'golden-coin': '/assets/image/royale pharaoh/cards/coin.png',
  papyrus: '/assets/image/royale pharaoh/cards/papyrus.png',

  // Special
  wild: '/assets/image/royale pharaoh/cards/wild.png',
  scatter: '/assets/image/royale pharaoh/cards/scatter.png',
};

export const PHARAOH_LOGO_IMAGE = '/assets/image/royale pharaoh/logo.png';
const FALLBACK_IMAGE = '/assets/image/royale pharaoh/cards/scatter.png';

export function getSymbolImage(symId: string): string {
  const norm = normalizeSymbolKey(symId);
  return PHARAOH_PUBLIC_IMAGES[symId] ?? PHARAOH_PUBLIC_IMAGES[norm] ?? FALLBACK_IMAGE;
}

interface SymbolTileProps {
  symId: string;
  isWinning?: boolean;
  isSpinning?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
}

/**
 * Premium 3D Casino Symbol Tile
 * Transparent container showcasing authentic Egyptian gold-bezeled cards
 */
export const SymbolTile: React.FC<SymbolTileProps> = ({
  symId,
  isWinning = false,
  isSpinning = false,
  size = 'md',
  showBadge = false,
}) => {
  const [imgError, setImgError] = useState(false);
  const symConfig = PHARAOH_SYMBOLS[symId] || PHARAOH_SYMBOLS[normalizeSymbolKey(symId)];
  const imgSrc = imgError ? FALLBACK_IMAGE : getSymbolImage(symId);

  const isWild = symId === 'wild';
  const isScatter = symId === 'scatter';
  const isPremium = symConfig?.type === 'premium';

  return (
    <div
      className={`relative w-full h-full aspect-[3/5] flex items-center justify-center select-none transition-transform duration-200 ${
        isWinning ? 'scale-105 z-20 drop-shadow-[0_0_15px_#F5C451]' : ''
      }`}
    >
      {/* Symbol Card Image */}
      <img
        src={imgSrc}
        alt={symConfig?.name ?? symId}
        onError={() => setImgError(true)}
        draggable={false}
        className={`w-full h-full object-fill rounded-lg drop-shadow-[0_4px_10px_rgba(0,0,0,0.7)] transition-transform duration-200 ${
          isWinning && isWild
            ? 'animate-bounce drop-shadow-[0_0_15px_#F5C451]'
            : isWinning && isScatter
            ? 'scale-105 drop-shadow-[0_0_15px_#19C6C2]'
            : isWinning
            ? 'scale-105'
            : ''
        }`}
      />

      {/* Winning Glow Overlay */}
      {isWinning && (
        <div className="absolute inset-0 rounded-lg ring-2 ring-[#F5C451] shadow-[0_0_20px_#F5C451] pointer-events-none animate-pulse" />
      )}

      {/* Type Badge (Optional for Paytable or high-value symbols) */}
      {showBadge && symConfig && (
        <div
          className={`absolute bottom-1 px-1.5 py-0.5 rounded text-[8px] md:text-[9px] font-black uppercase tracking-wider backdrop-blur-sm ${
            isWild
              ? 'bg-[#F5C451] text-black shadow-[0_0_8px_#F5C451]'
              : isScatter
              ? 'bg-[#19C6C2] text-black shadow-[0_0_8px_#19C6C2]'
              : isPremium
              ? 'bg-[#A66B16] text-[#FFF2A3] border border-[#F5C451]/50'
              : 'bg-black/80 text-gray-300'
          }`}
        >
          {symConfig.tierLabel ?? symConfig.type}
        </div>
      )}
    </div>
  );
};
