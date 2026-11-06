import React from "react";
import { PharaohSymbolId } from "./pharaoh-types";

/**
 * Public image map for Royale Pharaoh symbols.
 *
 * Pointing at the curated assets in /public/assets/image/royale pharaoh/*.jpg|png
 * so the reel board actually renders artwork instead of broken placeholders.
 */
export const PHARAOH_PUBLIC_IMAGES: Record<PharaohSymbolId, string> = {
  "pharaoh-mask": "/assets/image/royale pharaoh/Pharaoh Mask.jpg",
  anubis: "/assets/image/royale pharaoh/Anubis.jpg",
  cleopatra: "/assets/image/royale pharaoh/Cleopatra.jpg",
  "golden-scarab": "/assets/image/royale pharaoh/Golden Scarab.jpg",
  sarcophagus: "/assets/image/royale pharaoh/Sarcophagus.jpg",
  ankh: "/assets/image/royale pharaoh/Ankh.jpg",
  "eye-of-horus": "/assets/image/royale pharaoh/Eye of Horus.jpg",
  "golden-coin": "/assets/image/royale pharaoh/Golden Coin.jpg",
  papyrus: "/assets/image/royale pharaoh/Ancient Papyrus.jpg",
  wild: "/assets/image/royale pharaoh/Ancient Wild.jpg",
  scatter: "/assets/image/royale pharaoh/Golden Scatter.png",
};

const FALLBACK = "/assets/image/royale pharaoh/Golden Scatter.png";

/** Small symbol tile used inside the reel board. */
export function SymbolCell({ symId }: { symId: PharaohSymbolId }) {
  const src = PHARAOH_PUBLIC_IMAGES[symId] ?? FALLBACK;
  return (
    <div
      className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded bg-black/40 shadow-inner"
    >
      <img
        src={src}
        alt="symbol"
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />
    </div>
  );
}


