/**
 * TANVION ROYALE — Responsible-gambling configuration (Task 2 / audit F3).
 *
 * Only ONE knob is needed here: the COOLING-OFF DELAY that a player must wait
 * before a limit RAISE or an exclusion END becomes effective. Lowering a limit
 * and self-excluding are always IMMEDIATE (they only ever restrict play).
 *
 * The delay defaults to 24 hours and can be tuned per deployment. Setting it to
 * 0 disables the delay (development only — production should keep it >= 1).
 */

export interface ResponsibleGamblingConfig {
  /** Cooling-off delay, in milliseconds, for limit raises + exclusion ends. */
  coolingOffMs: number;
  /** The same delay expressed in hours (kept for logs/status output). */
  coolingOffHours: number;
}

const HOUR_MS = 3_600_000;

export function loadResponsibleGamblingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResponsibleGamblingConfig {
  const raw = env.ROYALE_RG_COOLING_OFF_HOURS;
  let coolingOffHours = 24; // default 24h
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    // Only a non-negative integer is accepted; anything else keeps the default
    // so a malformed value can never silently zero the delay.
    if (Number.isInteger(parsed) && parsed >= 0) coolingOffHours = parsed;
  }
  return { coolingOffHours, coolingOffMs: coolingOffHours * HOUR_MS };
}
