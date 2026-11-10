import React from 'react';

/**
 * Responsive Borders, Ornate Golden Corners & Turquoise Neon Accents
 * Matching the premium 3D Egyptian Pharaoh slot art style.
 */
export const PharaohDecoration: React.FC = () => {
  return (
    <>
      {/* Heavy Ornate Gold Corner Ornaments - Responsive Sizing */}
      {/* Top Left */}
      <div className="absolute top-0 left-0 w-8 h-8 sm:w-11 sm:h-11 md:w-14 md:h-14 pointer-events-none z-20">
        <svg viewBox="0 0 64 64" className="w-full h-full drop-shadow-[0_0_6px_rgba(245,196,81,0.6)]">
          <path
            d="M2 2 L38 2 L38 10 L10 10 L10 38 L2 38 Z"
            fill="url(#goldGrad)"
            stroke="#F5C451"
            strokeWidth="1"
          />
          <path
            d="M6 6 L26 6 L26 12 L12 12 L12 26 L6 26 Z"
            fill="#19C6C2"
            opacity="0.8"
          />
          <circle cx="8" cy="8" r="3" fill="#F5C451" />
          <defs>
            <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFF2A3" />
              <stop offset="40%" stopColor="#F5C451" />
              <stop offset="100%" stopColor="#8A5A0A" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Top Right */}
      <div className="absolute top-0 right-0 w-8 h-8 sm:w-11 sm:h-11 md:w-14 md:h-14 pointer-events-none z-20 transform scale-x-[-1]">
        <svg viewBox="0 0 64 64" className="w-full h-full drop-shadow-[0_0_6px_rgba(245,196,81,0.6)]">
          <path
            d="M2 2 L38 2 L38 10 L10 10 L10 38 L2 38 Z"
            fill="url(#goldGrad)"
            stroke="#F5C451"
            strokeWidth="1"
          />
          <path
            d="M6 6 L26 6 L26 12 L12 12 L12 26 L6 26 Z"
            fill="#19C6C2"
            opacity="0.8"
          />
          <circle cx="8" cy="8" r="3" fill="#F5C451" />
        </svg>
      </div>

      {/* Bottom Left */}
      <div className="absolute bottom-0 left-0 w-8 h-8 sm:w-11 sm:h-11 md:w-14 md:h-14 pointer-events-none z-20 transform scale-y-[-1]">
        <svg viewBox="0 0 64 64" className="w-full h-full drop-shadow-[0_0_6px_rgba(245,196,81,0.6)]">
          <path
            d="M2 2 L38 2 L38 10 L10 10 L10 38 L2 38 Z"
            fill="url(#goldGrad)"
            stroke="#F5C451"
            strokeWidth="1"
          />
          <path
            d="M6 6 L26 6 L26 12 L12 12 L12 26 L6 26 Z"
            fill="#19C6C2"
            opacity="0.8"
          />
          <circle cx="8" cy="8" r="3" fill="#F5C451" />
        </svg>
      </div>

      {/* Bottom Right */}
      <div className="absolute bottom-0 right-0 w-8 h-8 sm:w-11 sm:h-11 md:w-14 md:h-14 pointer-events-none z-20 transform scale-x-[-1] scale-y-[-1]">
        <svg viewBox="0 0 64 64" className="w-full h-full drop-shadow-[0_0_6px_rgba(245,196,81,0.6)]">
          <path
            d="M2 2 L38 2 L38 10 L10 10 L10 38 L2 38 Z"
            fill="url(#goldGrad)"
            stroke="#F5C451"
            strokeWidth="1"
          />
          <path
            d="M6 6 L26 6 L26 12 L12 12 L12 26 L6 26 Z"
            fill="#19C6C2"
            opacity="0.8"
          />
          <circle cx="8" cy="8" r="3" fill="#F5C451" />
        </svg>
      </div>

      {/* Top Temple Arch Ornament */}
      <div className="hidden sm:flex absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center justify-center pointer-events-none z-20">
        <div className="relative px-3 sm:px-5 py-0.5 sm:py-1 bg-gradient-to-r from-transparent via-[#F5C451] to-transparent rounded-full shadow-[0_0_15px_#F5C451]">
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <span className="text-[#19C6C2] text-[10px] sm:text-xs drop-shadow-[0_0_6px_#19C6C2]">𓁹</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#19C6C2] animate-ping" />
            <span className="text-[8px] sm:text-[10px] uppercase font-black tracking-widest text-[#080E24]">
              ROYALE PHARAOH
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#19C6C2] animate-ping" />
            <span className="text-[#19C6C2] text-[10px] sm:text-xs drop-shadow-[0_0_6px_#19C6C2]">𓁹</span>
          </div>
        </div>
      </div>

      {/* Ambient Turquoise and Golden Volumetric Light Glow */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#19C6C2]/10 via-transparent to-[#F5C451]/10 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-0.5 sm:h-1 bg-gradient-to-r from-transparent via-[#19C6C2] to-transparent opacity-60 shadow-[0_0_8px_#19C6C2] pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-0.5 sm:h-1 bg-gradient-to-r from-transparent via-[#F5C451] to-transparent opacity-60 shadow-[0_0_8px_#F5C451] pointer-events-none" />
    </>
  );
};

/**
 * Background Egyptian Temple & Pyramid Scene with Pyramids, Anubis Statues & Torches
 * High-definition asset located at /assets/image/royale pharaoh/background.png
 */
export const TempleBackground: React.FC = () => {
  return (
    <div className="pointer-events-none absolute inset-0 w-full h-full overflow-hidden select-none z-0">
      {/* High-res Egyptian Pharaoh Temple Art — background.png */}
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat scale-[1.01]"
        style={{
          backgroundImage: `url('/assets/image/royale pharaoh/background.png')`,
        }}
      />

      {/* Subtle gentle lighting overlay keeping temple vivid while maintaining high contrast for cards */}
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
};
