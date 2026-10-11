/** Free-play state sanitizer.

 * Engines may keep server-only fields in their internal state (e.g. the crash
 * engine tracks startTime/crashPoint). Those fields must never be persisted in
 * the public-facing `state` JSONB (GameSession.state), because the frontend
 * mirrors that state back to clients. This removes a safe default allow-list of
 * known internal keys plus any key starting with '_' so engine authors do not
 * need to think about exposure.
 */
function stripEngineState(
  state: Record<string, unknown>,
  keep: ReadonlyArray<string> = [],
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (key.startsWith('_')) continue;
    if (!keep.includes(key)) {
      switch (key) {
        // Known server-only keys used by TANVIONROYALE engines.
        case 'crashPoint':
        case 'startedAt':
        case 'multiplier':
        case 'segments':
        case 'secret':
        case 'next':
        case 'cpuMove':
        case 'hint':
        case 'lastGuess':
        case 'dealerCard':
        case 'playerCard':
          continue;
        default:
          next[key] = state[key];
      }
    } else {
      next[key] = state[key];
    }
  }
  return next;
}

export { stripEngineState };
