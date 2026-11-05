'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { WHEEL_NUMBERS, RED_NUMBERS } from '@/lib/api/roulette';

interface RouletteWheel3DProps {
  winningNumber: number | null;
  targetAngle?: number | null;
  isSpinning: boolean;
  spinDurationMs?: number;
  className?: string;
  isCompact?: boolean;
}

/**
 * High-definition Canvas Texture for European Roulette wheel with 37 distinct pockets.
 * European sequence: 0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
 */
function createWheelTexture(): THREE.CanvasTexture {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const center = size / 2;
  const outerR = size * 0.49;
  const innerR = size * 0.32;
  const numPockets = WHEEL_NUMBERS.length; // 37
  const pocketStep = (Math.PI * 2) / numPockets;

  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < numPockets; i++) {
    const num = WHEEL_NUMBERS[i];
    const isZero = num === 0;
    const isRed = RED_NUMBERS.has(num);

    const startAngle = i * pocketStep - pocketStep / 2 - Math.PI / 2;
    const endAngle = startAngle + pocketStep;

    // Pocket background wedge
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(startAngle) * innerR, center + Math.sin(startAngle) * innerR);
    ctx.arc(center, center, outerR, startAngle, endAngle);
    ctx.lineTo(center + Math.cos(endAngle) * innerR, center + Math.sin(endAngle) * innerR);
    ctx.arc(center, center, innerR, endAngle, startAngle, true);
    ctx.closePath();

    ctx.fillStyle = isZero ? '#059669' : isRed ? '#dc2626' : '#111827';
    ctx.fill();

    // Distinct pocket boundary lines
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 7;
    ctx.stroke();

    // Bold, crisp white number centered in pocket
    const midAngle = startAngle + pocketStep / 2;
    const textRadius = (outerR + innerR) * 0.51;
    const tx = center + Math.cos(midAngle) * textRadius;
    const ty = center + Math.sin(midAngle) * textRadius;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(midAngle + Math.PI / 2);

    ctx.font = '900 52px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(String(num), 0, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // Inner and outer brass rim borders
  ctx.beginPath();
  ctx.arc(center, center, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 14;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 12;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function RouletteWheel3D({
  winningNumber,
  isSpinning,
  spinDurationMs = 8000,
  className = '',
  isCompact = false,
}: RouletteWheel3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const wheelGroupRef = useRef<THREE.Group | null>(null);
  const ballMeshRef = useRef<THREE.Mesh | null>(null);
  const winnerGlowRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null>(null);

  /**
   * Single deterministic animation state.
   * All fields are precomputed at spin-start. The animate() loop only reads them.
   */
  const animStateRef = useRef<{
    isSpinning: boolean;
    hasSettled: boolean;
    spinStartTime: number;
    spinDuration: number;
    // Rotor
    rotorStartAngle: number;
    rotorDeltaAngle: number;
    currentRotorAngle: number;
    // Ball — absolute world-space angles
    ballCurrentAngle: number; // tracks ball position continuously
    ballStartAngle: number;
    ballTotalTravel: number;
    targetPocketIndex: number;
    // Final locked world angle (set at progress=1)
    finalBallAngle: number;
    finalRotorAngle: number;
  }>({
    isSpinning: false,
    hasSettled: false,
    spinStartTime: 0,
    spinDuration: spinDurationMs,
    rotorStartAngle: 0,
    rotorDeltaAngle: 0,
    currentRotorAngle: 0,
    ballCurrentAngle: -Math.PI / 2,
    ballStartAngle: -Math.PI / 2,
    ballTotalTravel: 0,
    targetPocketIndex: 0,
    finalBallAngle: -Math.PI / 2,
    finalRotorAngle: 0,
  });

  // Set up 3D scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 7.2, 5.8);
    camera.lookAt(0, -0.35, 0);
    cameraRef.current = camera;

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.replaceChildren(renderer.domElement);

    // 3. Bright Luxury Casino Lighting
    const ambientLight = new THREE.AmbientLight(0xfff8ee, 2.0);
    scene.add(ambientLight);

    const mainSpot = new THREE.SpotLight(0xffffff, 4.5);
    mainSpot.position.set(0, 15, 6);
    mainSpot.angle = Math.PI / 3.2;
    mainSpot.penumbra = 0.4;
    mainSpot.castShadow = true;
    scene.add(mainSpot);

    const goldFill = new THREE.PointLight(0xfbbf24, 2.8, 25);
    goldFill.position.set(-5, 6, 4);
    scene.add(goldFill);

    const cyanRim = new THREE.PointLight(0x38bdf8, 2.2, 25);
    cyanRim.position.set(5, 5, -4);
    scene.add(cyanRim);

    // 4. Materials
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x140e0a,
      roughness: 0.25,
      metalness: 0.2,
    });

    const brushedGoldMat = new THREE.MeshStandardMaterial({
      color: 0xdaa520,
      roughness: 0.2,
      metalness: 0.9,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.1,
      metalness: 0.98,
    });

    // 5. Stationary Outer Bowl
    const outerBowlGroup = new THREE.Group();

    // Mahogany outer ring
    const outerRimGeo = new THREE.CylinderGeometry(4.65, 4.35, 0.7, 64, 1, true);
    const outerRim = new THREE.Mesh(outerRimGeo, darkWoodMat);
    outerRim.position.y = 0.1;
    outerBowlGroup.add(outerRim);

    // Polished gold top rim
    const brassRimGeo = new THREE.TorusGeometry(4.6, 0.1, 16, 64);
    const brassRim = new THREE.Mesh(brassRimGeo, brushedGoldMat);
    brassRim.rotation.x = Math.PI / 2;
    brassRim.position.y = 0.45;
    outerBowlGroup.add(brassRim);

    // Sloping chrome ball track
    const ballTrackGeo = new THREE.ConeGeometry(4.38, 1.1, 64, 1, true);
    const ballTrack = new THREE.Mesh(ballTrackGeo, chromeMat);
    ballTrack.rotation.x = Math.PI;
    ballTrack.position.y = -0.15;
    outerBowlGroup.add(ballTrack);

    // Deflector diamonds
    const diamondGeo = new THREE.ConeGeometry(0.1, 0.22, 4);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI * 2) / 8;
      const diamond = new THREE.Mesh(diamondGeo, brushedGoldMat);
      diamond.position.set(Math.cos(angle) * 3.82, 0.18, Math.sin(angle) * 3.82);
      diamond.rotation.y = angle;
      outerBowlGroup.add(diamond);
    }

    scene.add(outerBowlGroup);

    // 6. Rotating Rotor Group
    const rotorGroup = new THREE.Group();
    wheelGroupRef.current = rotorGroup;

    // Metallic rotor bowl
    const rotorBowlGeo = new THREE.CylinderGeometry(3.25, 2.9, 0.38, 64);
    const rotorBowl = new THREE.Mesh(rotorBowlGeo, chromeMat);
    rotorBowl.position.y = -0.28;
    rotorGroup.add(rotorBowl);

    // Number Ring Texture (crisp 0-36)
    const numbersTexture = createWheelTexture();
    const numberRingGeo = new THREE.RingGeometry(2.15, 3.25, 64);
    const numberRingMat = new THREE.MeshBasicMaterial({
      map: numbersTexture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const numberRing = new THREE.Mesh(numberRingGeo, numberRingMat);
    numberRing.rotation.x = -Math.PI / 2;
    numberRing.position.y = -0.06;
    rotorGroup.add(numberRing);

    // 37 Radial Fret Dividers — the physical pocket boundaries
    const numPockets = WHEEL_NUMBERS.length;
    const pocketStep = (Math.PI * 2) / numPockets;
    const fretGeo = new THREE.BoxGeometry(0.025, 0.16, 1.1);

    for (let i = 0; i < numPockets; i++) {
      const fretAngle = i * pocketStep - Math.PI / 2;
      const fret = new THREE.Mesh(fretGeo, brushedGoldMat);
      fret.position.set(Math.cos(fretAngle) * 2.7, -0.02, Math.sin(fretAngle) * 2.7);
      fret.rotation.y = -fretAngle + Math.PI / 2;
      rotorGroup.add(fret);
    }

    // Inner gold cone
    const innerConeGeo = new THREE.ConeGeometry(2.12, 0.45, 48);
    const innerCone = new THREE.Mesh(innerConeGeo, brushedGoldMat);
    innerCone.position.y = -0.05;
    rotorGroup.add(innerCone);

    // Central Brass Turret
    const turretBaseGeo = new THREE.CylinderGeometry(0.55, 0.85, 0.55, 32);
    const turretBase = new THREE.Mesh(turretBaseGeo, brushedGoldMat);
    turretBase.position.y = 0.22;
    rotorGroup.add(turretBase);

    const turretSpireGeo = new THREE.ConeGeometry(0.42, 0.85, 32);
    const turretSpire = new THREE.Mesh(turretSpireGeo, brushedGoldMat);
    turretSpire.position.y = 0.82;
    rotorGroup.add(turretSpire);

    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.45, 16);
    for (let j = 0; j < 2; j++) {
      const arm = new THREE.Mesh(armGeo, brushedGoldMat);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = (j * Math.PI) / 2;
      arm.position.y = 0.55;
      rotorGroup.add(arm);
    }

    // Glowing circle beacon on winning pocket (child of rotorGroup so it rotates with rotor)
    const winnerGlowGeo = new THREE.RingGeometry(0.05, 0.28, 32);
    const winnerGlowMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const winnerGlow = new THREE.Mesh(winnerGlowGeo, winnerGlowMat);
    winnerGlow.rotation.x = -Math.PI / 2;
    winnerGlow.position.y = 0.02;
    rotorGroup.add(winnerGlow);
    winnerGlowRef.current = winnerGlow;

    scene.add(rotorGroup);

    // 7. Ivory Ball — rendered in WORLD SPACE (not child of rotor)
    const ballGeo = new THREE.SphereGeometry(0.14, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xf8f8f8,
      roughness: 0.08,
      metalness: 0.05,
      emissive: 0x444444,
      emissiveIntensity: 0.1,
    });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    ballMeshRef.current = ballMesh;

    // Initial ball world position: at angle 0 (top of wheel), resting in pocket
    const initAngle = animStateRef.current.ballCurrentAngle;
    ballMesh.position.set(Math.cos(initAngle) * 2.7, -0.04, Math.sin(initAngle) * 2.7);
    scene.add(ballMesh);

    // 8. Animation Loop
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const state = animStateRef.current;

      if (state.isSpinning) {
        // ── ACTIVE SPIN ──
        const elapsed = performance.now() - state.spinStartTime;
        const progress = Math.min(elapsed / state.spinDuration, 1.0);

        // Cubic ease-out for smooth deceleration
        const easeOut3 = 1 - Math.pow(1 - progress, 3);
        const easeOut2_7 = 1 - Math.pow(1 - progress, 2.7);

        // --- Rotor ---
        const newRotorAngle = state.rotorStartAngle + state.rotorDeltaAngle * easeOut3;
        state.currentRotorAngle = newRotorAngle;
        if (wheelGroupRef.current) {
          wheelGroupRef.current.rotation.y = newRotorAngle;
        }

        // --- Ball trajectory (world space, not relative to rotor) ---
        const rawBallAngle = state.ballStartAngle + state.ballTotalTravel * easeOut2_7;

        let ballRadius = 3.95;
        let ballY = 0.38;

        if (progress < 0.60) {
          // Phase 1: High-speed upper rim orbit
          ballRadius = 3.95;
          ballY = 0.38 + Math.sin(rawBallAngle * 5) * 0.012;
        } else if (progress < 0.88) {
          // Phase 2: Drop from track to pocket with fret bounces
          const dropP = (progress - 0.60) / 0.28;
          const dropEase = Math.pow(dropP, 1.3);
          ballRadius = THREE.MathUtils.lerp(3.95, 2.7, dropEase);
          ballY = THREE.MathUtils.lerp(0.38, -0.04, dropP);
          // Realistic rattle bounces
          const bounce = Math.abs(Math.sin(dropP * Math.PI * 5)) * (1 - dropP) * 0.14;
          ballY += bounce;
        } else {
          // Phase 3: Settle
          ballRadius = 2.7;
          ballY = -0.04;
        }

        // Track ball's current angle for use at start of next spin
        state.ballCurrentAngle = rawBallAngle;

        if (ballMeshRef.current) {
          ballMeshRef.current.position.set(
            Math.cos(rawBallAngle) * ballRadius,
            ballY,
            Math.sin(rawBallAngle) * ballRadius,
          );
        }

        // Hide highlight while spinning
        if (winnerGlowRef.current) {
          winnerGlowRef.current.material.opacity = 0;
        }

        // COMPLETE STOP at progress = 1
        if (progress >= 1.0) {
          state.isSpinning = false;
          state.hasSettled = true;

          // Final rotor angle
          state.finalRotorAngle = state.rotorStartAngle + state.rotorDeltaAngle;
          state.currentRotorAngle = state.finalRotorAngle;

          // Pocket position in rotor-local space
          const numP = WHEEL_NUMBERS.length;
          const pStep = (Math.PI * 2) / numP;
          const pocketLocalAngle = state.targetPocketIndex * pStep - Math.PI / 2;

          // World-space angle of this pocket = rotor angle + local pocket angle
          const pocketWorldAngle = state.finalRotorAngle + pocketLocalAngle;

          // Lock ball to exact pocket world position
          state.finalBallAngle = pocketWorldAngle;
          state.ballCurrentAngle = pocketWorldAngle;

          if (ballMeshRef.current) {
            ballMeshRef.current.position.set(
              Math.cos(pocketWorldAngle) * 2.7,
              -0.04,
              Math.sin(pocketWorldAngle) * 2.7,
            );
          }

          // Show winner glow at ROTOR-LOCAL position of winning pocket
          if (winnerGlowRef.current) {
            winnerGlowRef.current.position.set(
              Math.cos(pocketLocalAngle) * 2.7,
              0.02,
              Math.sin(pocketLocalAngle) * 2.7,
            );
            winnerGlowRef.current.material.opacity = 0.9;
          }

          if (wheelGroupRef.current) {
            wheelGroupRef.current.rotation.y = state.finalRotorAngle;
          }
        }

      } else if (!state.hasSettled) {
        // ── IDLE SPIN (between rounds) — wheel rotates gently, ball rides along ──
        state.currentRotorAngle += delta * 0.35;
        if (wheelGroupRef.current) {
          wheelGroupRef.current.rotation.y = state.currentRotorAngle;
        }

        // Ball stays in its current pocket — which is at a fixed pocket-local offset
        // relative to rotor. We track ballCurrentAngle in world space by adding rotor delta.
        state.ballCurrentAngle += delta * 0.35;

        if (ballMeshRef.current) {
          ballMeshRef.current.position.set(
            Math.cos(state.ballCurrentAngle) * 2.7,
            -0.04,
            Math.sin(state.ballCurrentAngle) * 2.7,
          );
        }

        // Glow hidden during idle
        if (winnerGlowRef.current) {
          winnerGlowRef.current.material.opacity = 0;
        }

      } else {
        // ── SETTLED — everything stopped ──
        if (winnerGlowRef.current) {
          // Pulse the glow gently
          const t = performance.now() / 1000;
          winnerGlowRef.current.material.opacity = 0.6 + 0.35 * Math.sin(t * 3);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.dispose();
      numbersTexture.dispose();
      outerBowlGroup.clear();
      rotorGroup.clear();
      scene.clear();
    };
  }, []);

  // Camera zoom when compact mode changes
  useEffect(() => {
    if (!cameraRef.current) return;
    if (isCompact) {
      cameraRef.current.position.set(0, 5.8, 4.4);
      cameraRef.current.lookAt(0, -0.2, 0);
    } else {
      cameraRef.current.position.set(0, 7.2, 5.8);
      cameraRef.current.lookAt(0, -0.35, 0);
    }
  }, [isCompact]);

  // Trigger Deterministic Spin upon WHEEL_SPIN event
  useEffect(() => {
    if (isSpinning && winningNumber !== null) {
      const pocketIdx = WHEEL_NUMBERS.indexOf(winningNumber);
      const targetPocket = pocketIdx >= 0 ? pocketIdx : 0;

      const numPockets = WHEEL_NUMBERS.length;
      const pocketStep = (Math.PI * 2) / numPockets;

      const currentRotor = animStateRef.current.currentRotorAngle;
      // Rotor spins clockwise 3 full revolutions
      const rotorSpins = 3 * Math.PI * 2;
      const finalRotorAngle = currentRotor + rotorSpins;

      // Target pocket world-space angle after spin:
      const pocketLocalAngle = targetPocket * pocketStep - Math.PI / 2;
      const targetPocketWorldAngle = finalRotorAngle + pocketLocalAngle;

      // Ball starts from its current world angle
      const currentBallAngle = animStateRef.current.ballCurrentAngle;

      // Ball needs to travel counter-clockwise (-) for ≈7 revolutions and land at targetPocketWorldAngle
      const baseTravel = -7 * Math.PI * 2;
      // Adjust to land exactly on target:
      // We want: currentBallAngle + totalTravel ≡ targetPocketWorldAngle (mod 2π)
      const diff = ((targetPocketWorldAngle - currentBallAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      // diff is [0, 2π). To travel counter-clockwise (negative) and cover ~7 revs:
      // travel = baseTravel + diff (this gives ~-7 revs + small positive correction)
      // But we must ensure |travel| >= 6*2π to look convincing
      let travel = baseTravel + diff;
      // If travel is somehow not negative enough (edge case), subtract another 2π
      if (travel > -5 * Math.PI * 2) {
        travel -= Math.PI * 2;
      }

      animStateRef.current = {
        isSpinning: true,
        hasSettled: false,
        spinStartTime: performance.now(),
        spinDuration: spinDurationMs,
        rotorStartAngle: currentRotor,
        rotorDeltaAngle: rotorSpins,
        currentRotorAngle: currentRotor,
        ballCurrentAngle: currentBallAngle,
        ballStartAngle: currentBallAngle,
        ballTotalTravel: travel,
        targetPocketIndex: targetPocket,
        finalBallAngle: targetPocketWorldAngle,
        finalRotorAngle,
      };
    }
  }, [isSpinning, winningNumber, spinDurationMs]);

  // Reset to idle when new round starts (winningNumber cleared)
  useEffect(() => {
    if (!isSpinning && winningNumber === null) {
      animStateRef.current.hasSettled = false;
      if (winnerGlowRef.current) {
        winnerGlowRef.current.material.opacity = 0;
      }
    }
  }, [isSpinning, winningNumber]);

  return (
    <div className={`relative h-full w-full select-none ${className}`}>
      <div ref={mountRef} className="h-full w-full" />
    </div>
  );
}
