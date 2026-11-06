"use client";

import { SlotShell } from '@/components/games/slots/SlotShell';

export default function PharaohGame() {
  // SlotShell handles all server‑authoritative logic, UI, and visual effects.
  return <SlotShell slug="royale-pharaoh" />;
}
