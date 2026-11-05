'use client';

/**
 * RouletteWheelR3F — High-Definition 3D Mechanical European Roulette Wheel.
 *
 * Core Fixes:
 * 1. ZERO CROPPING: Dynamic frustum math calculates exact horizontal & vertical spans
 *    so the full 9.5-unit diameter wheel never crops on any screen, mobile or desktop.
 * 2. NUMBERS DEAD-CENTERED: 4096x4096 Ultra-HD canvas texture maps pocket numbers to the
 *    exact geometric centerline of the number ring (radius 2.95).
 * 3. BALL NEVER OBSCURES NUMBER: Ball lands inside the inner pocket well at radius 2.18,
 *    leaving the winning number completely unobscured and visible above the ball.
 * 4. CRYSTAL-CLEAR WINNING NUMBER REVELATION:
 *    - Pulsing golden halo directly around the winning number at radius 2.95.
 *    - Golden beacon disc in the pocket well at radius 2.18.
 *    - Dynamic gold spotlight illuminating the winning pocket and ball.
 * 5. DETERMINISTIC CASINO PHYSICS:
 *    - Continuous base rotor rotation.
 *    - Ball launches in opposite direction (counter-clockwise) at high speed.
 *    - Smooth friction deceleration, drop onto cone with mechanical fret bounces.
 *    - Absolute pocket docking (`targetRadian - wheel.rotation.y`) locking the ball
 *      into the exact server-selected winning pocket.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WHEEL_NUMBERS, RED_NUMBERS } from '@/lib/api/roulette';

const POCKET_ORDER = WHEEL_NUMBERS; // [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const NUM_POCKETS = POCKET_ORDER.length; // 37
const POCKET_STEP = (Math.PI * 2) / NUM_POCKETS;

const ROTOR_STEADY_SPEED = 0.38; // Steady base rotor rotation speed (rad/s)
const BALL_ORBIT_R = 3.92;       // High outer ball track radius
const BALL_POCKET_R = 2.18;      // Inner pocket well resting radius (inward from numbers)
const NUMBER_RING_R = 2.95;      // Centerline radius of the number band
const BALL_TRACK_Y = 0.38;       // Outer track height
const BALL_POCKET_Y = -0.04;     // Resting pocket well height

// 3D Number Ring Mesh Radii: Inner 2.45, Outer 3.45 -> Centerline 2.95
const RING_INNER_3D = 2.45;
const RING_OUTER_3D = 3.45;

/**
 * 4096x4096 Ultra-HD Texture Generator
 * Places bold, ultra-crisp numbers dead-centered in the middle of each pocket cell.
 */
function createWheelTexture(): THREE.CanvasTexture {
  const size = 4096;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const center = size / 2;
  // Texture radii mapped 1:1 to RingGeometry(2.45, 3.45):
  const outerR = size * 0.50;
  const innerR = size * (RING_INNER_3D / RING_OUTER_3D) * 0.50; // ~0.355 * size
  const midR = (outerR + innerR) * 0.50;                        // Dead center of the pocket ring

  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < NUM_POCKETS; i++) {
    const num = POCKET_ORDER[i];
    const isZero = num === 0;
    const isRed = RED_NUMBERS.has(num);

    const startAngle = i * POCKET_STEP - POCKET_STEP / 2 - Math.PI / 2;
    const endAngle = startAngle + POCKET_STEP;

    // 1. Pocket background wedge
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(startAngle) * innerR, center + Math.sin(startAngle) * innerR);
    ctx.arc(center, center, outerR, startAngle, endAngle);
    ctx.lineTo(center + Math.cos(endAngle) * innerR, center + Math.sin(endAngle) * innerR);
    ctx.arc(center, center, innerR, endAngle, startAngle, true);
    ctx.closePath();

    ctx.fillStyle = isZero ? '#059669' : isRed ? '#dc2626' : '#111827';
    ctx.fill();

    // 2. Brass divider lines between pockets
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 14;
    ctx.stroke();

    // 3. Crisp number placed dead-center in the pocket band
    const midAngle = startAngle + POCKET_STEP / 2;
    const tx = center + Math.cos(midAngle) * midR;
    const ty = center + Math.sin(midAngle) * midR;

    ctx.save();
    ctx.translate(tx, ty);
    // Orient text facing outward so numbers are upright when viewed from the rim
    ctx.rotate(midAngle + Math.PI / 2);

    ctx.font = '900 160px "Segoe UI", "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Deep black contour stroke for ultra high contrast
    ctx.lineWidth = 28;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(String(num), 0, 0);

    // Brilliant white text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // 4. Polished brass inner and outer border rings
  ctx.beginPath();
  ctx.arc(center, center, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 22;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 24;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

interface WheelSceneProps {
  gameState: string;
  winningNumber: number | null;
  isCompact?: boolean;
}

function WheelScene({ gameState, winningNumber }: WheelSceneProps) {
  const { camera, size } = useThree();
  const texture = useMemo(() => createWheelTexture(), []);

  const wheelGroupRef = useRef<THREE.Group>(null);
  const ballMeshRef = useRef<THREE.Mesh>(null);
  const winnerGlowRef = useRef<THREE.Mesh>(null);
  const winnerNumberSpotRef = useRef<THREE.Mesh>(null);
  const winnerLightRef = useRef<THREE.PointLight>(null);

  // Ball physics state
  const ballSpeedRef = useRef<number>(0);
  const ballWorldAngleRef = useRef<number>(-Math.PI / 2);
  const spinStartTimeRef = useRef<number>(0);

  // ── Dynamic Responsive Camera Frustum (Mathematically Eliminates Any Cropping) ──
  useEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const aspect = width / height;

    // Full wheel diameter is 9.5 units.
    // Required view spans to guarantee 100% visibility with clean margins on any screen:
    const requiredH = 11.4; // Horizontal span needed
    const requiredV = 9.8;  // Vertical span needed
    const fov = 38;
    const tanHalfFov = Math.tan(((fov / 2) * Math.PI) / 180);

    // Distance required to guarantee vertical span:
    const distV = requiredV / (2 * tanHalfFov);
    // Distance required to guarantee horizontal span:
    const distH = requiredH / (2 * tanHalfFov * aspect);

    // The camera distance is the maximum of the two constraints:
    const distance = Math.max(distV, distH);

    // Pitch angle: ~47.5 degrees provides an authentic casino view showing both
    // depth and all pocket numbers clearly
    const pitchRad = 0.83;
    const camY = distance * Math.sin(pitchRad);
    const camZ = distance * Math.cos(pitchRad);

    camera.position.set(0, camY, camZ);
    camera.lookAt(0, -0.22, 0);
    camera.updateProjectionMatrix();
  }, [size.width, size.height, camera]);

  // Handle spin launch when transitioning to SPINNING
  useEffect(() => {
    if (gameState === 'SPINNING') {
      ballSpeedRef.current = 8.5; // High initial launch speed
      spinStartTimeRef.current = performance.now();
    } else if (gameState === 'BETTING_OPEN') {
      ballSpeedRef.current = 0;
    }
  }, [gameState]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const wheel = wheelGroupRef.current;
    const ball = ballMeshRef.current;
    const glow = winnerGlowRef.current;
    const numberSpot = winnerNumberSpotRef.current;
    const winLight = winnerLightRef.current;

    // 1. Mechanical wheel rotor rotates steadily
    if (wheel) {
      wheel.rotation.y += ROTOR_STEADY_SPEED * dt;
    }

    if (!ball || !wheel) return;

    // Calculate pocket target radian for winningNumber
    const pocketIndex = winningNumber !== null ? POCKET_ORDER.indexOf(winningNumber) : 0;
    const safeIndex = pocketIndex >= 0 ? pocketIndex : 0;
    const targetRadian = safeIndex * POCKET_STEP - Math.PI / 2;

    // 2. Ball movement and stopping physics
    if (gameState === 'SPINNING' && ballSpeedRef.current > 0) {
      // Ball orbits in opposite direction (counter-clockwise)
      ballWorldAngleRef.current -= ballSpeedRef.current * dt;

      // Friction deceleration: Decays smoothly over ~7.5 seconds
      ballSpeedRef.current = Math.max(0, ballSpeedRef.current - dt * 1.15);

      const progress = 1 - ballSpeedRef.current / 8.5;

      let r = BALL_ORBIT_R;
      let y = BALL_TRACK_Y;

      if (progress < 0.55) {
        // High speed outer rim orbit
        r = BALL_ORBIT_R;
        y = BALL_TRACK_Y + Math.sin(ballWorldAngleRef.current * 8) * 0.01;
      } else if (progress < 0.88) {
        // Drops down the sloped track with realistic mechanical bounces
        const dropP = (progress - 0.55) / 0.33;
        r = THREE.MathUtils.lerp(BALL_ORBIT_R, BALL_POCKET_R, Math.pow(dropP, 1.25));
        y = THREE.MathUtils.lerp(BALL_TRACK_Y, BALL_POCKET_Y, dropP);

        // Sinusoidal bounce jitter over frets
        const bounce = Math.abs(Math.sin(dropP * Math.PI * 7)) * (1 - dropP) * 0.10;
        y += bounce;
      } else {
        // Settle into pocket well
        r = BALL_POCKET_R;
        y = BALL_POCKET_Y;

        // Smoothly lock angle to winning pocket
        const currentTargetWorldAngle = targetRadian - wheel.rotation.y;
        const settleP = (progress - 0.88) / 0.12;
        ballWorldAngleRef.current = THREE.MathUtils.lerp(
          ballWorldAngleRef.current,
          currentTargetWorldAngle,
          settleP,
        );
      }

      ball.position.set(
        Math.cos(ballWorldAngleRef.current) * r,
        y,
        Math.sin(ballWorldAngleRef.current) * r,
      );

      // Hide winning highlights during active spin
      if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = 0;
      if (numberSpot) (numberSpot.material as THREE.MeshBasicMaterial).opacity = 0;
      if (winLight) winLight.intensity = 0;
    } else if (winningNumber !== null && ballSpeedRef.current === 0) {
      // 3. Absolute pocket anchor: Lock ball to the exact winning pocket
      // Note: Child in rotor space has angle targetRadian, which corresponds to
      // targetRadian - wheel.rotation.y in world space!
      const lockedAngle = targetRadian - wheel.rotation.y;
      ballWorldAngleRef.current = lockedAngle;

      // Ball sits inside the inner pocket well at BALL_POCKET_R (2.18)
      ball.position.set(
        Math.cos(lockedAngle) * BALL_POCKET_R,
        BALL_POCKET_Y,
        Math.sin(lockedAngle) * BALL_POCKET_R,
      );

      // Pulsing golden beacon and spotlight on winning number and pocket
      const pulse = 0.75 + 0.25 * Math.sin((performance.now() / 1000) * 5);

      if (glow) {
        // Glowing halo on the pocket well where ball is resting
        glow.position.set(
          Math.cos(targetRadian) * BALL_POCKET_R,
          0.02,
          Math.sin(targetRadian) * BALL_POCKET_R,
        );
        (glow.material as THREE.MeshBasicMaterial).opacity = pulse;
      }

      if (numberSpot) {
        // Brilliant glowing ring directly highlighting the winning NUMBER at radius 2.95
        numberSpot.position.set(
          Math.cos(targetRadian) * NUMBER_RING_R,
          0.015,
          Math.sin(targetRadian) * NUMBER_RING_R,
        );
        (numberSpot.material as THREE.MeshBasicMaterial).opacity = pulse * 0.90;
      }

      if (winLight) {
        // Casino spotlight directly illuminating the winning pocket and ball
        winLight.position.set(
          Math.cos(lockedAngle) * NUMBER_RING_R,
          0.85,
          Math.sin(lockedAngle) * NUMBER_RING_R,
        );
        winLight.intensity = 4.0 * pulse;
      }
    } else {
      // 4. Idle state: Ball rests inside pocket, rotating with the wheel
      const idleAngle = targetRadian - wheel.rotation.y;
      ballWorldAngleRef.current = idleAngle;

      ball.position.set(
        Math.cos(idleAngle) * BALL_POCKET_R,
        BALL_POCKET_Y,
        Math.sin(idleAngle) * BALL_POCKET_R,
      );

      if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = 0;
      if (numberSpot) (numberSpot.material as THREE.MeshBasicMaterial).opacity = 0;
      if (winLight) winLight.intensity = 0;
    }
  });

  return (
    <>
      {/* ── Studio Casino Lighting ── */}
      <ambientLight intensity={2.8} color={0xfffaed} />
      <directionalLight position={[0, 16, 8]} intensity={4.0} castShadow />
      <pointLight position={[-7, 8, 6]} color={0xfbbf24} intensity={3.5} distance={40} />
      <pointLight position={[7, 7, -6]} color={0x38bdf8} intensity={2.8} distance={40} />
      <pointLight position={[0, 10, 0]} color={0xffffff} intensity={2.5} distance={30} />

      {/* Dynamic Gold Casino Spotlight on Winning Pocket */}
      <pointLight ref={winnerLightRef} color={0xfacc15} distance={8} intensity={0} />

      {/* ── Stationary Outer Bowl (Diameter 9.5 units) ── */}
      <group>
        {/* Mahogany Outer Wood Bowl Rim */}
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[4.70, 4.38, 0.75, 64, 1, true]} />
          <meshStandardMaterial color={0x160f0b} roughness={0.20} metalness={0.15} />
        </mesh>
        {/* Polished Gold Top Bullnose Rim */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.48, 0]}>
          <torusGeometry args={[4.65, 0.12, 16, 64]} />
          <meshStandardMaterial color={0xd4af37} roughness={0.15} metalness={0.92} />
        </mesh>
        {/* Sloping Chrome Ball Track */}
        <mesh rotation={[Math.PI, 0, 0]} position={[0, -0.15, 0]}>
          <coneGeometry args={[4.40, 1.15, 64, 1, true]} />
          <meshStandardMaterial color={0xe2e8f0} roughness={0.08} metalness={0.98} />
        </mesh>
        {/* 8 Polished Brass Deflector Diamonds */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI * 2) / 8;
          return (
            <mesh key={i} position={[Math.cos(a) * 3.84, 0.20, Math.sin(a) * 3.84]} rotation={[0, a, 0]}>
              <coneGeometry args={[0.11, 0.24, 4]} />
              <meshStandardMaterial color={0xf59e0b} roughness={0.15} metalness={0.95} />
            </mesh>
          );
        })}
      </group>

      {/* ── Rotating Wheel Rotor ── */}
      <group ref={wheelGroupRef}>
        {/* Metallic Rotor Bowl Base */}
        <mesh position={[0, -0.28, 0]}>
          <cylinderGeometry args={[3.45, 2.92, 0.38, 64]} />
          <meshStandardMaterial color={0xd1d5db} roughness={0.12} metalness={0.95} />
        </mesh>

        {/* 4096x4096 Ultra-HD Number Ring Texture (Radius 2.45 to 3.45 -> Numbers centered at 2.95) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.055, 0]}>
          <ringGeometry args={[RING_INNER_3D, RING_OUTER_3D, 64]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
        </mesh>

        {/* Inner Pocket Well (Where the ball drops, radius 1.95 to 2.45) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.065, 0]}>
          <ringGeometry args={[1.95, 2.45, 64]} />
          <meshStandardMaterial color={0x18181b} roughness={0.25} metalness={0.80} />
        </mesh>

        {/* 37 Physical 3D Brass Fret Pocket Dividers (Separating pockets in well) */}
        {Array.from({ length: NUM_POCKETS }).map((_, i) => {
          const fa = i * POCKET_STEP - Math.PI / 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(fa) * 2.20, -0.02, Math.sin(fa) * 2.20]}
              rotation={[0, -fa + Math.PI / 2, 0]}
            >
              <boxGeometry args={[0.028, 0.16, 0.48]} />
              <meshStandardMaterial color={0xfbbf24} roughness={0.18} metalness={0.92} />
            </mesh>
          );
        })}

        {/* Central Inner Gold Cone */}
        <mesh position={[0, -0.05, 0]}>
          <coneGeometry args={[1.95, 0.48, 48]} />
          <meshStandardMaterial color={0xd4af37} roughness={0.18} metalness={0.90} />
        </mesh>

        {/* Center Turret Spire & Handles */}
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.55, 0.88, 0.58, 32]} />
          <meshStandardMaterial color={0xf59e0b} roughness={0.15} metalness={0.95} />
        </mesh>
        <mesh position={[0, 0.88, 0]}>
          <coneGeometry args={[0.44, 0.90, 32]} />
          <meshStandardMaterial color={0xf59e0b} roughness={0.15} metalness={0.95} />
        </mesh>
        {[0, Math.PI / 2].map((ry, j) => (
          <mesh key={j} position={[0, 0.58, 0]} rotation={[0, ry, Math.PI / 2]}>
            <cylinderGeometry args={[0.065, 0.065, 1.50, 16]} />
            <meshStandardMaterial color={0xf59e0b} roughness={0.15} metalness={0.95} />
          </mesh>
        ))}

        {/* Glowing Halo Beacon on the Pocket Well where ball rests */}
        <mesh ref={winnerGlowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.05, 0.24, 32]} />
          <meshBasicMaterial color={0xfacc15} side={THREE.DoubleSide} transparent opacity={0} />
        </mesh>

        {/* Glowing Halo on the Winning NUMBER itself (100% highlighted!) */}
        <mesh ref={winnerNumberSpotRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.08, 0.34, 32]} />
          <meshBasicMaterial color={0xffe066} side={THREE.DoubleSide} transparent opacity={0} />
        </mesh>
      </group>

      {/* ── High-Reflective Ivory Ball (resting cleanly in pocket well without covering number) ── */}
      <mesh ref={ballMeshRef} castShadow position={[BALL_POCKET_R, BALL_POCKET_Y, 0]}>
        <sphereGeometry args={[0.13, 32, 32]} />
        <meshStandardMaterial
          color={0xffffff}
          roughness={0.04}
          metalness={0.08}
          emissive={0x666666}
          emissiveIntensity={0.30}
        />
      </mesh>
    </>
  );
}

export interface RouletteWheelR3FProps {
  winningNumber: number | null;
  gameState?: string;
  isCompact?: boolean;
  className?: string;
}

export function RouletteWheelR3F({
  winningNumber,
  gameState = 'BETTING_OPEN',
  isCompact = false,
  className = '',
}: RouletteWheelR3FProps) {
  return (
    <div className={`h-full w-full select-none ${className}`}>
      <Canvas
        shadows
        camera={{
          fov: 38,
          near: 0.1,
          far: 100,
          position: [0, 12, 10],
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.45,
        }}
      >
        <WheelScene
          gameState={gameState}
          winningNumber={winningNumber}
          isCompact={isCompact}
        />
      </Canvas>
    </div>
  );
}

export default RouletteWheelR3F;
