# Sky Rocket — original art & presentation notes

Sky Rocket is an ORIGINAL crash-game implementation (the "crash game" format:
a rising multiplier; cash out before it flies away). All artwork is our own.

## Art
- Rocket: our own inline SVG (`apps/web/components/games/sky-rocket-ship.tsx`) —
  our shape, our colours, spinning propeller, tail flame via `--sr-ship-thrust`.
- Scene: dark radial-ray crash scene with subtle grid, own CSS gradients.
- No asset from any third-party game, video or recording is used. The previously
  referenced `sky-rocket-reference-jet.png` (extracted from a reference video),
  plus the derived `sky-rocket-plane.png`, `sky-rocket-plane-trim.png` and the
  unowned `sky-bg.jpg` backdrop, have been DELETED and their references removed.

## Crash presentation ("flies away")
- A live crash plays a 600ms fly-off to the upper right (`sr-fly-away`, pure
  transform/opacity; instant removal under `prefers-reduced-motion`), then the
  plane is removed entirely. The curve and HUD freeze at the server crash value
  and the HUD shows "FLEW AWAY!" in red.
- A mount that arrives at an already-crashed round (refresh / reconnect /
  route change) shows no plane and never replays the beat.
- Geometry (multiplier→position, arc-length parametrisation, flight path) is the
  pure module `apps/web/lib/crash-curve.ts`, shared by the scene and tests.

## Server authority (unchanged)
- The round engine, provably-fair crash points and the multiplier timeline are
  server-authoritative (`apps/api/src/modules/crash`); the client only draws
  what the server says. FREE_PLAY only; the real-money gate is untouched.
