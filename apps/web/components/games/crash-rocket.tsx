'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CrashHistoryEntry } from '@/lib/api/crash';
import {
  scenePoint,
  curveTangentAt,
  flightPath,
  rocketProgress,
  rocketPosition,
  type ScenePoint,
} from '@/lib/crash-curve';

export { rocketProgress, rocketPosition };

export type RocketPhase = 'IDLE' | 'BETTING' | 'RUNNING' | 'CRASHED' | 'CASHED_OUT';

export interface CrashRocketSceneProps {
  displayMultiplier: number;
  targetMultiplier?: number;
  crashMultiplier: number | null;
  roundId?: string | null;
  phase: RocketPhase;
  bettingCloseAtMs: number | null;
  currency?: string;
  history?: CrashHistoryEntry[];
}

// ─── Particle for realistic engine smoke & spark trail ────────────────────────
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

// ─── Atmospheric sky clouds & wind streaks ──────────────────────────────────
interface SkyCloud {
  x: number;
  y: number;
  radius: number;
  speed: number;
  opacity: number;
}

interface WindStreak {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
}

// ─── Detailed Aviator Red Aerobatic Plane ─────────────────────────────────────
function drawAviatorPlane(
  ctx: CanvasRenderingContext2D,
  scale: number,
  propAngle: number,
  isCrashed: boolean,
  vibrationY: number,
) {
  const s = scale;
  ctx.save();
  ctx.translate(0, vibrationY);

  // 1. Red Glow / Halo
  ctx.shadowColor = isCrashed ? 'rgba(239,68,68,0.95)' : 'rgba(225,29,72,0.85)';
  ctx.shadowBlur = 20 * s;

  // 2. Landing Gear (Lower strut + Wheel — Iconic Aviator feature)
  ctx.save();
  // Strut
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(0, 4 * s);
  ctx.lineTo(-4 * s, 14 * s);
  ctx.stroke();

  // Wheel Wheel-pant / Tire
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(-4 * s, 14 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Chrome Hub
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(-4 * s, 14 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3. Lower Wing
  ctx.save();
  const lowerWingGrad = ctx.createLinearGradient(-10 * s, 0, 10 * s, 26 * s);
  lowerWingGrad.addColorStop(0, '#991b1b');
  lowerWingGrad.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = lowerWingGrad;
  ctx.beginPath();
  ctx.moveTo(4 * s, 3 * s);
  ctx.lineTo(-2 * s, 24 * s);
  ctx.lineTo(-12 * s, 23 * s);
  ctx.lineTo(-8 * s, 3 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 4. Tail Assembly
  // Horizontal stabilizer (lower)
  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.moveTo(-18 * s, 2 * s);
  ctx.lineTo(-26 * s, 11 * s);
  ctx.lineTo(-30 * s, 10 * s);
  ctx.lineTo(-23 * s, 2 * s);
  ctx.closePath();
  ctx.fill();

  // Horizontal stabilizer (upper)
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  ctx.moveTo(-18 * s, -2 * s);
  ctx.lineTo(-26 * s, -11 * s);
  ctx.lineTo(-30 * s, -10 * s);
  ctx.lineTo(-23 * s, -2 * s);
  ctx.closePath();
  ctx.fill();

  // Vertical Tail Fin & Rudder
  const finGrad = ctx.createLinearGradient(-25 * s, -20 * s, -15 * s, 0);
  finGrad.addColorStop(0, '#ef4444');
  finGrad.addColorStop(1, '#b91c1c');
  ctx.fillStyle = finGrad;
  ctx.beginPath();
  ctx.moveTo(-16 * s, -3 * s);
  ctx.lineTo(-26 * s, -20 * s);
  ctx.lineTo(-20 * s, -20 * s);
  ctx.lineTo(-12 * s, -3 * s);
  ctx.closePath();
  ctx.fill();

  // White rudder racing stripe
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-23 * s, -18 * s);
  ctx.lineTo(-21 * s, -18 * s);
  ctx.lineTo(-15 * s, -4 * s);
  ctx.lineTo(-17 * s, -4 * s);
  ctx.closePath();
  ctx.fill();

  // 5. Main Fuselage Body (Aerodynamic racing monoplane)
  const bodyGrad = ctx.createLinearGradient(0, -9 * s, 0, 9 * s);
  bodyGrad.addColorStop(0, '#ff334b');   // specular top highlight
  bodyGrad.addColorStop(0.35, '#e11d48'); // rich Aviator crimson
  bodyGrad.addColorStop(0.85, '#be123c'); // deep ruby core
  bodyGrad.addColorStop(1, '#881337');    // bottom shadow
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-24 * s, 0);          // tail end
  ctx.quadraticCurveTo(-20 * s, -7 * s, -4 * s, -8 * s); // spine
  ctx.lineTo(12 * s, -7 * s);      // upper nose taper
  ctx.quadraticCurveTo(24 * s, -4 * s, 26 * s, 0);      // nose cone
  ctx.quadraticCurveTo(24 * s, 5 * s, 12 * s, 7 * s);   // lower nose
  ctx.lineTo(-4 * s, 7 * s);       // belly
  ctx.quadraticCurveTo(-20 * s, 6 * s, -24 * s, 0);     // tail bottom
  ctx.closePath();
  ctx.fill();

  // 6. Fuselage Racing Decal (White stripe / Aviator detail)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(-6 * s, -2 * s);
  ctx.lineTo(8 * s, -2 * s);
  ctx.lineTo(6 * s, 1.5 * s);
  ctx.lineTo(-8 * s, 1.5 * s);
  ctx.closePath();
  ctx.fill();

  // 7. Cockpit Canopy (Tinted Bubble with glass reflection)
  // Canopy frame
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(4 * s, -5 * s, 9 * s, 4.5 * s, -0.08, 0, Math.PI * 2);
  ctx.fill();
  // Glass blue tint
  const glassGrad = ctx.createLinearGradient(0, -9 * s, 8 * s, -2 * s);
  glassGrad.addColorStop(0, 'rgba(56, 189, 248, 0.7)');
  glassGrad.addColorStop(0.6, 'rgba(14, 165, 233, 0.3)');
  glassGrad.addColorStop(1, 'rgba(15, 23, 42, 0.9)');
  ctx.fillStyle = glassGrad;
  ctx.beginPath();
  ctx.ellipse(4 * s, -5 * s, 7.5 * s, 3.5 * s, -0.08, 0, Math.PI * 2);
  ctx.fill();
  // White glass specular glint
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.ellipse(6 * s, -6.5 * s, 4 * s, 1.2 * s, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // 8. Upper Main Wing
  const upperWingGrad = ctx.createLinearGradient(-10 * s, -26 * s, 10 * s, 0);
  upperWingGrad.addColorStop(0, '#f43f5e');
  upperWingGrad.addColorStop(0.5, '#e11d48');
  upperWingGrad.addColorStop(1, '#9f1239');
  ctx.fillStyle = upperWingGrad;
  ctx.beginPath();
  ctx.moveTo(4 * s, -3 * s);
  ctx.lineTo(-2 * s, -25 * s);
  ctx.lineTo(-12 * s, -24 * s);
  ctx.lineTo(-8 * s, -3 * s);
  ctx.closePath();
  ctx.fill();
  // Wing leading edge highlight
  ctx.strokeStyle = 'rgba(255, 200, 210, 0.6)';
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(4 * s, -3 * s);
  ctx.lineTo(-2 * s, -25 * s);
  ctx.stroke();

  // 9. Engine Nose Cowling & Spinner
  ctx.fillStyle = '#be123c';
  ctx.beginPath();
  ctx.ellipse(22 * s, 0, 4 * s, 6.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 10. Propeller with High-Speed Motion Blur Disc
  ctx.save();
  ctx.translate(26 * s, 0);

  // Spinning motion blur disc
  const blurDisc = ctx.createRadialGradient(0, 0, 0, 0, 0, 16 * s);
  blurDisc.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
  blurDisc.addColorStop(0.6, 'rgba(255, 255, 255, 0.08)');
  blurDisc.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = blurDisc;
  ctx.beginPath();
  ctx.arc(0, 0, 16 * s, 0, Math.PI * 2);
  ctx.fill();

  // Rotating Propeller Blades
  ctx.rotate(propAngle);
  for (let b = 0; b < 2; b++) {
    ctx.save();
    ctx.rotate((b * Math.PI));
    // Blade
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.moveTo(-1.8 * s, 0);
    ctx.lineTo(-2.2 * s, -14 * s);
    ctx.quadraticCurveTo(0, -16 * s, 2.2 * s, -14 * s);
    ctx.lineTo(1.8 * s, 0);
    ctx.closePath();
    ctx.fill();
    // Yellow blade tips
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-2.2 * s, -12 * s);
    ctx.lineTo(-2.2 * s, -14 * s);
    ctx.quadraticCurveTo(0, -16 * s, 2.2 * s, -14 * s);
    ctx.lineTo(2.2 * s, -12 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Silver Chrome Hub Spinner
  const hubGrad = ctx.createLinearGradient(-3 * s, -3 * s, 3 * s, 3 * s);
  hubGrad.addColorStop(0, '#ffffff');
  hubGrad.addColorStop(0.5, '#cbd5e1');
  hubGrad.addColorStop(1, '#64748b');
  ctx.fillStyle = hubGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 3.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// ─── Exhaust Spark & Smoke Spawner ───────────────────────────────────────────
function spawnExhaust(
  particles: Particle[],
  tailX: number,
  tailY: number,
  tiltRad: number,
) {
  const count = 3;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.35;
    const speed = 1.4 + Math.random() * 1.6;
    particles.push({
      x: tailX + (Math.random() - 0.5) * 4,
      y: tailY + (Math.random() - 0.5) * 4,
      vx: -Math.cos(tiltRad + spread) * speed,
      vy: -Math.sin(tiltRad + spread) * speed,
      life: 1,
      maxLife: 1,
      size: 3.5 + Math.random() * 4,
      r: 235 + Math.floor(Math.random() * 20),
      g: 30 + Math.floor(Math.random() * 60),
      b: 30 + Math.floor(Math.random() * 30),
    });
  }
  if (particles.length > 100) {
    particles.splice(0, particles.length - 100);
  }
}

export function CrashRocketScene({
  displayMultiplier,
  crashMultiplier,
  roundId,
  phase,
  bettingCloseAtMs,
}: CrashRocketSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const multTextRef = useRef<HTMLSpanElement | null>(null);

  const [bettingCountdown, setBettingCountdown] = useState<number>(0);

  // Custom Plane PNG sprite loader (loads /assets/image/plane.png from public folder)
  const processedPlaneRef = useRef<HTMLCanvasElement | null>(null);
  const logicalSizeRef = useRef({ w: 800, h: 400, dpr: 1 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const img = new Image();
    const candidatePaths = [
      '/assets/image/plane.png',
      '/assets/image/royale-fly-plane.png',
      '/assets/image/royale-fly.png',
      '/assets/image/airplane.png',
    ];
    let candidateIndex = 0;
    const tryNextImage = () => {
      if (candidateIndex >= candidatePaths.length) return;
      img.src = candidatePaths[candidateIndex];
      img.onload = () => {
        try {
          const offscreen = document.createElement('canvas');
          // Content bounding box in plane.png: minX=95, maxX=1340, minY=190, maxY=810
          const pad = 100;
          const sx = 95;
          const sy = 190;
          const sw = 1245;
          const sh = 620;
          offscreen.width = sw + pad * 2;
          offscreen.height = sh + pad * 2;
          const octx = offscreen.getContext('2d');
          if (octx) {
            // Source plane.png has nose on LEFT and is tilted upward by ~7.8°.
            // Flip horizontally so the nose points forward (RIGHT),
            // and apply a counter-rotation of -0.136 rad so the fuselage and wheels are 100% horizontal (parallel to ground)!
            octx.translate((sw + pad * 2) / 2, (sh + pad * 2) / 2);
            octx.scale(-1, 1);
            octx.rotate(-0.136);
            octx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
            processedPlaneRef.current = offscreen;
          }
        } catch {
          // Fallback handled automatically
        }
      };
      img.onerror = () => {
        candidateIndex++;
        tryNextImage();
      };
    };
    tryNextImage();
  }, []);

  // Smooth interpolated continuous multiplier for 60fps butter motion
  const smoothMultRef = useRef<number>(1.0);
  const flyAwayRef = useRef<{ x: number; y: number; vx: number; vy: number }>({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  });
  const prevRoundRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<RocketPhase>('IDLE');
  const particlesRef = useRef<Particle[]>([]);
  const cloudsRef = useRef<SkyCloud[]>([]);
  const windStreaksRef = useRef<WindStreak[]>([]);
  const propAngleRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  // Accumulated wave angle — lets wave speed change dynamically without any jump/jerk
  const waveAngleRef = useRef<number>(0);

  // Initialize atmospheric clouds & wind streaks once
  useEffect(() => {
    const clouds: SkyCloud[] = [];
    for (let i = 0; i < 8; i++) {
      clouds.push({
        x: Math.random() * 900,
        y: 30 + Math.random() * 260,
        radius: 35 + Math.random() * 55,
        speed: 0.3 + Math.random() * 0.45,
        opacity: 0.03 + Math.random() * 0.04,
      });
    }
    cloudsRef.current = clouds;

    const streaks: WindStreak[] = [];
    for (let i = 0; i < 15; i++) {
      streaks.push({
        x: Math.random() * 900,
        y: 20 + Math.random() * 320,
        length: 25 + Math.random() * 65,
        speed: 2.2 + Math.random() * 2.8,
        opacity: 0.035 + Math.random() * 0.065,
      });
    }
    windStreaksRef.current = streaks;
  }, []);

  const phaseRef = useRef<RocketPhase>(phase);
  const multRef = useRef<number>(displayMultiplier);
  const crashMultRef = useRef<number | null>(crashMultiplier);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    multRef.current = displayMultiplier;
  }, [displayMultiplier]);
  useEffect(() => {
    crashMultRef.current = crashMultiplier;
  }, [crashMultiplier]);

  // Countdown timer for BETTING phase
  useEffect(() => {
    if (phase !== 'BETTING' || !bettingCloseAtMs) {
      setBettingCountdown(0);
      return;
    }
    const interval = setInterval(() => {
      const remaining = Math.max(0, (bettingCloseAtMs - Date.now()) / 1000);
      setBettingCountdown(remaining);
    }, 50);
    return () => clearInterval(interval);
  }, [phase, bettingCloseAtMs]);

  // Reset fly-away + particles when a new round starts
  useEffect(() => {
    if (roundId !== prevRoundRef.current) {
      prevRoundRef.current = roundId ?? null;
      particlesRef.current = [];
      flyAwayRef.current = { x: 0, y: 0, vx: 0, vy: 0 };
      smoothMultRef.current = 1.0;
      frameRef.current = 0; // Reset frame counter so wave always starts from sin(0)=0 — clean, smooth
      waveAngleRef.current = 0; // Reset accumulated wave angle for clean start each round
    }
  }, [roundId]);

  // ─── Main canvas RAF render loop ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const { w: W, h: H, dpr } = logicalSizeRef.current;
      if (!W || !H) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Synchronize HiDPI scaling cleanly every frame
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      frameRef.current++;
      const currentPhase = phaseRef.current;
      const targetMult = multRef.current;
      const crashMult = crashMultRef.current;
      const isRunning = currentPhase === 'RUNNING';
      const isCrashed = currentPhase === 'CRASHED';
      const isBetting = currentPhase === 'BETTING' || currentPhase === 'IDLE';

      // ── 60fps Multiplier Interpolation (Smooth Glide) ──
      if (isRunning) {
        // Continuous smooth convergence towards server target
        smoothMultRef.current += (targetMult - smoothMultRef.current) * 0.16;
        if (smoothMultRef.current < 1.0) smoothMultRef.current = 1.0;
      } else if (isCrashed) {
        smoothMultRef.current = crashMult ?? targetMult;
      } else {
        smoothMultRef.current = 1.0;
      }
      const activeMult = isRunning ? smoothMultRef.current : (crashMult ?? targetMult);

      // Keep the live multiplier HUD updating smoothly at 60fps
      if (isRunning && multTextRef.current) {
        multTextRef.current.textContent = `${activeMult.toFixed(2)}x`;
      }

      // ── 1. Sky Background (Deep high-altitude atmosphere with procedural drifting clouds) ──
      ctx.clearRect(0, 0, W, H);
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, '#090b10');
      skyGrad.addColorStop(0.55, '#0e1118');
      skyGrad.addColorStop(1, '#170c15');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Subtle radiating sunburst rays from bottom-left
      ctx.save();
      ctx.translate(W * 0.04, H * 0.94);
      const fanRays = 26;
      for (let i = 0; i < fanRays; i++) {
        const a = -Math.PI * 0.05 + (i / (fanRays - 1)) * (Math.PI * 0.65);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.006)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        const da = (Math.PI * 0.65) / (fanRays - 1) / 2;
        ctx.arc(0, 0, Math.max(W, H) * 2, a - da, a + da);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Render drifting sky clouds (আকাশে ভাসমান মেঘ)
      ctx.save();
      for (const cloud of cloudsRef.current) {
        if (isRunning) {
          cloud.x -= cloud.speed * (1.2 + (activeMult > 2 ? 1.0 : 0.3));
        } else {
          cloud.x -= cloud.speed * 0.2;
        }
        if (cloud.x < -cloud.radius * 2) {
          cloud.x = W + cloud.radius * 2;
          cloud.y = 25 + Math.random() * (H * 0.6);
        }

        const cloudGrad = ctx.createRadialGradient(
          cloud.x,
          cloud.y,
          0,
          cloud.x,
          cloud.y,
          cloud.radius,
        );
        cloudGrad.addColorStop(0, `rgba(255, 255, 255, ${cloud.opacity})`);
        cloudGrad.addColorStop(0.7, `rgba(255, 255, 255, ${cloud.opacity * 0.35})`);
        cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = cloudGrad;
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Render aerodynamic wind streaks whistling past in high flight
      if (isRunning) {
        ctx.save();
        for (const streak of windStreaksRef.current) {
          streak.x -= streak.speed * (1.5 + (activeMult > 2 ? 1.5 : 0.5));
          if (streak.x < -streak.length) {
            streak.x = W + Math.random() * 80;
            streak.y = 20 + Math.random() * (H * 0.7);
          }
          ctx.strokeStyle = `rgba(255, 255, 255, ${streak.opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(streak.x, streak.y);
          ctx.lineTo(streak.x + streak.length, streak.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // High-altitude atmospheric radial crimson glow
      const atmGlow = ctx.createRadialGradient(
        W * 0.5,
        H * 0.45,
        20,
        W * 0.5,
        H * 0.45,
        Math.max(W, H) * 0.7,
      );
      atmGlow.addColorStop(0, 'rgba(159, 18, 57, 0.16)');
      atmGlow.addColorStop(0.5, 'rgba(88, 28, 135, 0.08)');
      atmGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = atmGlow;
      ctx.fillRect(0, 0, W, H);

      // ── 2. Coordinate Geometry & Runway Baseline ──
      const PAD_X = 8;                                    // minimal left padding — plane starts near edge
      const PAD_BOTTOM = H - 38;
      const scale = Math.max(0.72, Math.min(1.05, W / 560));

      // Bottom-left runway start point — right at the left edge (0px offset)
      const startX = PAD_X;                               // plane rests at left edge on start
      const startY = PAD_BOTTOM - 12 * scale;
      const maxX = W * 0.85;
      const maxY = H * 0.16;
      const graphW = maxX - startX;
      const graphH = startY - maxY;

      // Bottom runway baseline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_X, PAD_BOTTOM);
      ctx.lineTo(W - 16, PAD_BOTTOM);
      ctx.stroke();

      // ── 3. Real-Time Flight Curve Calculations ──
      // Stage 1 (1.00x→1.05x): ground roll on runway
      // Stage 2 (1.05x+):  liftoff → smooth climb → continuous slow wave
      const runwayRollW = graphW * 0.06;                  // short runway roll before liftoff

      let headX = startX;
      let headY = startY;

      if (activeMult < 1.05) {
        // Stage 1: Ground Roll along the runway
        const groundP = Math.max(0, (activeMult - 1.00) / 0.05);
        headX = startX + groundP * runwayRollW;
        headY = startY;
      } else {
        // Stage 2: Airborne (1.05x+)
        const fm = activeMult - 1.05;
        // flightP: 0→0.92 as multiplier goes 1.05x → ∞
        const flightP = Math.min(0.92, fm / (fm + 4.2));
        headX = startX + runwayRollW + flightP * (graphW - runwayRollW);

        // ── Altitude & Wave: Smooth takeoff → 98% height → 20% height → continuous 20% to 98% wave
        //
        // 1. Advance accumulated waveAngleRef dynamically (speeds up with multiplier/flying time)
        const dynamicWaveSpeed = 0.014 + Math.min(fm * 0.0018, 0.026);
        waveAngleRef.current += dynamicWaveSpeed;
        const theta = waveAngleRef.current;

        // 2. Continuous two-phase harmonic motion:
        //    Phase A (Takeoff): theta in [0, π/2]
        //      Smooth climb from runway (0%) to 98% ceiling with zero-derivative endpoints.
        //    Phase B (Continuous Wave): theta >= π/2
        //      Smooth oscillation between 20% valley and 98% crest (mid=59%, amp=39%).
        //      At theta = π/2, both position (98%) and velocity (0) match perfectly!
        const T1 = Math.PI / 2; // ~1.5708 rad
        let altitudeFactor = 0;

        if (theta < T1) {
          // Takeoff: lifts off runway smoothly and eases into 98% height at theta = T1
          const progress = theta / T1; // 0 → 1
          altitudeFactor = 0.98 * Math.pow(Math.sin((Math.PI / 2) * progress), 2);
        } else {
          // Wave: smoothly undulates between 20% and 98% of graph height
          const phi = theta - T1; // starts at 0 at the top crest
          // cos(0) = 1 → 0.59 + 0.39 = 0.98 (top)
          // cos(π) = -1 → 0.59 - 0.39 = 0.20 (bottom)
          altitudeFactor = 0.59 + 0.39 * Math.cos(phi);
        }

        // Apply altitude to canvas Y coordinate
        const targetY = startY - altitudeFactor * graphH;
        headY = Math.min(startY, Math.max(maxY + 4, targetY));
      }

      if (isRunning || isCrashed) {
        // Bezier control points for the dynamic red glowing curve
        // ctrl2Y tracks closer to headY so the curve follows the wave dip/rise naturally
        const ctrl1X = startX + (headX - startX) * 0.30;
        const ctrl1Y = startY;
        const ctrl2X = startX + (headX - startX) * 0.72;
        const ctrl2Y = startY - (startY - headY) * 0.65;

        // 3a. Area Gradient Fill under the Curve (Anchored right at startX)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startX, PAD_BOTTOM);
        ctx.lineTo(startX, startY);
        if (activeMult < 1.05) {
          ctx.lineTo(headX, startY);
        } else {
          ctx.bezierCurveTo(ctrl1X, ctrl1Y, ctrl2X, ctrl2Y, headX, headY);
        }
        ctx.lineTo(headX, PAD_BOTTOM);
        ctx.closePath();

        const areaGrad = ctx.createLinearGradient(startX, maxY, startX, PAD_BOTTOM);
        if (isCrashed) {
          areaGrad.addColorStop(0, 'rgba(239, 68, 68, 0.38)');
          areaGrad.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
        } else {
          areaGrad.addColorStop(0, 'rgba(225, 29, 72, 0.42)');
          areaGrad.addColorStop(1, 'rgba(225, 29, 72, 0.0)');
        }
        ctx.fillStyle = areaGrad;
        ctx.fill();
        ctx.restore();

        // 3b. Glowing Red Curve Line (Aviator Crimson — Connects from startX directly to the plane)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        if (activeMult < 1.05) {
          ctx.lineTo(headX, startY);
        } else {
          ctx.bezierCurveTo(ctrl1X, ctrl1Y, ctrl2X, ctrl2Y, headX, headY);
        }
        ctx.strokeStyle = isCrashed ? '#ef4444' : '#e11d48';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = isCrashed ? 'rgba(239, 68, 68, 0.9)' : 'rgba(225, 29, 72, 0.85)';
        ctx.shadowBlur = 16;
        ctx.stroke();

        // Core bright highlight line
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isCrashed ? '#fca5a5' : '#fda4af';
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();

        // 3d. Propeller Rotation (Smooth continuous spinning)
        propAngleRef.current = (propAngleRef.current + 0.35) % (Math.PI * 2);

        // 3g. Plane Position & Crash Fly-Away Animation (Rock steady and smooth, no jitter)
        let planeX = headX;
        let planeY = headY;

        // Perfectly horizontal / parallel flight (সমান্তরালভাবে সোজা থাকবে ও উড়বে, zero tilt)
        let planeAngle = 0;

        if (isCrashed) {
          if (prevPhaseRef.current === 'RUNNING') {
            flyAwayRef.current.vx = 8;
            flyAwayRef.current.vy = -5.5;
          }
          flyAwayRef.current.x += flyAwayRef.current.vx;
          flyAwayRef.current.y += flyAwayRef.current.vy;
          flyAwayRef.current.vy -= 0.18; // upward escape arc
          flyAwayRef.current.vx += 0.38;
          planeX = headX + flyAwayRef.current.x;
          planeY = headY + flyAwayRef.current.y;
          planeAngle = Math.max(-0.35, Math.atan2(flyAwayRef.current.vy, flyAwayRef.current.vx) * 0.45);
        }
        prevPhaseRef.current = currentPhase;

        // 3e. Particle Exhaust Spawn (Horizontally trailing straight behind the plane, only when airborne)
        if (isRunning && activeMult >= 1.05) {
          const tailX = planeX - 32 * scale;
          const tailY = planeY;
          spawnExhaust(particlesRef.current, tailX, tailY, 0);
        }

        // 3f. Update & Render Particles
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.035;
          if (p.life <= 0) {
            particlesRef.current.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = p.life * 0.85;
          ctx.fillStyle = `rgb(${p.r}, ${p.g}, ${p.b})`;
          ctx.shadowColor = `rgba(${p.r}, ${p.g}, ${p.b}, 0.7)`;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 3h. Draw the Aviator Red Plane (PNG sprite if provided, or high-detail canvas vector)
        if (planeX < W + 150 && planeY > -150 && planeX > -150) {
          const scale = Math.max(0.75, Math.min(1.25, W / 560));
          const sprite = processedPlaneRef.current;

          ctx.save();
          ctx.translate(planeX, planeY);
          ctx.rotate(planeAngle);

          if (sprite) {
            const targetWidth = 86 * scale;
            const targetHeight =
              (sprite.height / sprite.width) * targetWidth;
            ctx.shadowColor = isCrashed
              ? 'rgba(239, 68, 68, 0.95)'
              : 'rgba(225, 29, 72, 0.85)';
            ctx.shadowBlur = 18 * scale;
            ctx.drawImage(
              sprite,
              -targetWidth * 0.45,
              -targetHeight * 0.5,
              targetWidth,
              targetHeight,
            );
          } else {
            drawAviatorPlane(ctx, scale, propAngleRef.current, isCrashed, 0);
          }
          ctx.restore();
        }
      }

      // ── 4. Waiting / Idle State (Plane resting on runway at bottom-left start point) ──
      if (isBetting) {
        particlesRef.current = [];
        prevPhaseRef.current = currentPhase;
        flyAwayRef.current = { x: 0, y: 0, vx: 0, vy: 0 };

        // Exactly at the bottom-left runway start point (resting steady on the ground)
        const idleX = startX;
        const idleY = startY;
        propAngleRef.current = (propAngleRef.current + 0.15) % (Math.PI * 2);

        const sprite = processedPlaneRef.current;
        ctx.save();
        ctx.translate(idleX, idleY);
        if (sprite) {
          const targetWidth = 84 * scale;
          const targetHeight =
            (sprite.height / sprite.width) * targetWidth;
          ctx.drawImage(
            sprite,
            -targetWidth * 0.45,
            -targetHeight * 0.5,
            targetWidth,
            targetHeight,
          );
        } else {
          drawAviatorPlane(ctx, scale, propAngleRef.current, false, 0);
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ─── Responsive ResizeObserver (Synchronized Logical CSS Pixels & HiDPI) ────
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      logicalSizeRef.current = { w, h, dpr };
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const isRunning = phase === 'RUNNING';
  const isCrashed = phase === 'CRASHED';
  const isBetting = phase === 'BETTING';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[240px] sm:min-h-[290px] bg-[#0e1015] rounded-2xl overflow-hidden select-none border border-slate-800/80 shadow-2xl"
    >
      {/* HTML5 Dynamic Canvas for Exponential Curve & Flying Aviator Plane */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* ── Right-Side Live Multiplier HUD (Matches User's Marked Red Box) ── */}
      {isRunning && (
        <div className="absolute right-4 sm:right-8 bottom-4 sm:bottom-7 z-20 pointer-events-none flex flex-col items-end">
          <div className="flex items-center gap-1.5 bg-[#090b10]/80 border border-rose-500/30 rounded-2xl px-4 py-2 sm:px-6 sm:py-2.5 backdrop-blur-md shadow-[0_0_25px_rgba(225,29,72,0.25)]">
            <span
              ref={multTextRef}
              className="font-black font-sans tracking-tight text-white"
              style={{
                fontSize: 'clamp(2.2rem, 5.5vw, 3.8rem)',
                lineHeight: 1,
                textShadow: '0 0 30px rgba(225,29,72,0.7), 0 2px 10px rgba(0,0,0,0.9)',
              }}
            >
              {displayMultiplier.toFixed(2)}x
            </span>
          </div>
        </div>
      )}

      {/* ── Right-Side Crashed Multiplier HUD ── */}
      {isCrashed && (
        <div className="absolute right-4 sm:right-8 bottom-4 sm:bottom-7 z-20 pointer-events-none flex flex-col items-end animate-fade-in">
          <div className="flex flex-col items-end gap-1 bg-[#16080d]/90 border border-red-500/60 rounded-2xl px-4 py-2 sm:px-6 sm:py-2.5 backdrop-blur-md shadow-[0_0_35px_rgba(239,68,68,0.45)]">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-[#ef4444] animate-pulse">
              FLEW AWAY!
            </span>
            <span
              className="font-black font-sans text-[#ef4444]"
              style={{
                fontSize: 'clamp(2.2rem, 5.5vw, 3.8rem)',
                lineHeight: 1,
                textShadow: '0 0 30px rgba(239,68,68,0.85)',
              }}
            >
              {(crashMultiplier ?? displayMultiplier).toFixed(2)}x
            </span>
          </div>
        </div>
      )}

      {/* ── Central Overlay: Waiting for next round countdown ── */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none text-center">
        {isBetting && (
          <div className="flex flex-col items-center gap-3">
            {/* Royale Fly Official Game Watermark */}
            <div className="flex flex-col items-center opacity-45 select-none pointer-events-none mb-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/image/royale-fly-logo.png"
                alt="Royale Fly"
                className="h-10 sm:h-12 w-auto object-contain drop-shadow mb-1"
              />
              <span className="text-xl sm:text-2xl font-black italic tracking-tighter text-white">
                ROYALE <span className="text-[#e11d48]">FLY</span>
              </span>
              <span className="text-[10px] tracking-widest uppercase text-slate-300 font-bold">
                Official Game • TANVION ROYALE
              </span>
            </div>

            <div className="flex flex-col items-center bg-[#151922]/90 border border-slate-700/60 rounded-2xl px-6 py-4 backdrop-blur-md shadow-2xl">
              <span className="text-slate-300 font-bold text-xs sm:text-sm tracking-wider uppercase mb-2">
                Waiting for next round
              </span>
              <div className="w-48 sm:w-64 h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-red-600 to-amber-500 rounded-full transition-all duration-100"
                  style={{
                    width: `${Math.min(100, Math.max(0, (bettingCountdown / 5) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-red-400 font-mono font-bold text-sm mt-2">
                {bettingCountdown > 0 ? `${bettingCountdown.toFixed(1)}s` : 'Starting...'}
              </span>
            </div>
          </div>
        )}

        {phase === 'IDLE' && (
          <div className="text-slate-400 font-bold text-sm sm:text-base animate-pulse">
            Connecting to Royale Fly engine...
          </div>
        )}
      </div>

      {/* Brand Watermark Badge */}
      <div className="absolute left-3.5 bottom-3 z-10 pointer-events-none opacity-50">
        <span className="text-[10px] uppercase tracking-widest font-mono text-slate-400">
          Royale Fly • Provably Fair
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CrashRocket — Adapter used by crash-game.tsx
// ─────────────────────────────────────────────────────────────────────────────

export interface CrashRocketProps {
  currentMultiplier: number;
  gameState: 'WAITING' | 'FLYING' | 'CRASHED';
  crashMultiplier?: number | null;
  roundId?: string | null;
  bettingCloseAtMs?: number | null;
}

export function CrashRocket({
  currentMultiplier,
  gameState,
  crashMultiplier = null,
  roundId,
  bettingCloseAtMs = null,
}: CrashRocketProps) {
  const phase: RocketPhase =
    gameState === 'FLYING'
      ? 'RUNNING'
      : gameState === 'CRASHED'
        ? 'CRASHED'
        : 'BETTING';

  return (
    <CrashRocketScene
      displayMultiplier={currentMultiplier}
      crashMultiplier={crashMultiplier}
      roundId={roundId}
      phase={phase}
      bettingCloseAtMs={bettingCloseAtMs}
    />
  );
}
