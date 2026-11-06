import React from "react";

/**
 * Large Egyptian temple & pyramid decorative scene.
 * Kept as inline SVG so no external asset is required, and it stays
 * lightweight across all viewport sizes.
 */
export function EgyptianDecor() {
  const pyramidFootprint = "310,500 1130,500 720,150";
  const sidePyramidLeft = "170,430 280,190 390,430";
  const sidePyramidRight = "1250,450 1360,210 1470,450";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 560"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#020617" />
            <stop offset="1" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id="pyramidGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbbf24" />
            <stop offset="0.55" stopColor="#d97706" />
            <stop offset="1" stopColor="#78350f" />
          </linearGradient>
          <linearGradient id="templeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d97706" />
            <stop offset="1" stopColor="#78350f" />
          </linearGradient>
        </defs>

        <rect width="1440" height="560" fill="url(#bg)" />

        {/* Sun glow */}
        <circle cx="1180" cy="100" r="130" fill="#fbbf24" opacity="0.14" />
        <circle cx="1180" cy="100" r="60" fill="#fbbf24" opacity="0.4" />
        <circle cx="260" cy="80" r="80" fill="#fbbf24" opacity="0.1" />

        {/* Distant pyramids */}
        <polygon points={sidePyramidLeft} fill="url(#pyramidGrad)" opacity="0.2" />
        <polygon points={sidePyramidRight} fill="url(#pyramidGrad)" opacity="0.15" />

        {/* Central grand pyramid */}
        <polygon points={pyramidFootprint} fill="url(#pyramidGrad)" opacity="0.32" />
        <polygon points="720,190 1130,500 310,500" fill="#d97706" opacity="0.18" />
        <polygon points="720,170 1130,500 310,500" fill="#f59e0b" opacity="0.14" />

        {/* Temple cornice / plinth */}
        <rect x="470" y="396" width="500" height="34" rx="4" fill="#78350f" opacity="0.95" />
        <rect x="470" y="396" width="500" height="14" rx="2" fill="#f59e0b" opacity="0.65" />

        {/* Temple front columns */}
        {Array.from({ length: 7 }, (_, i) => (
          <rect
            key={i}
            x={540 + i * 56}
            y={470}
            width={28}
            height={160}
            rx={4}
            fill="#b45309"
            opacity={0.85}
          />
        ))}

        {/* Hieroglyphic inspired accents */}
        <polygon points="580,250 600,230 620,250 600,270" fill="#fbbf24" opacity="0.8" />
        <rect x="660" y="218" width="24" height="16" rx={3} fill="#b45309" opacity="0.95" />
        <ellipse cx="672" cy="215" rx={16} ry={8} fill="#fbbf24" opacity="0.95" />
        <circle cx="672" cy="215" r={3} fill="#78350f" />

        <ellipse cx="770" cy="170" rx={14} ry={20} fill="#d97706" opacity="0.75" />
        <circle cx="770" cy="170" r={7} fill="#ffffff" opacity="0.9" />

        <ellipse cx="860" cy="210" rx={14} ry={12} fill="#16a34a" opacity="0.8" />
        <circle cx="860" cy="210" r={5} fill="#fbbf24" opacity="0.85" />

        <polygon points="960,240 980,220 1000,240 980,260" fill="#fbbf24" opacity="0.7" />
      </svg>
    </div>
  );
}
