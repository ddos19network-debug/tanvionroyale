/**
 * TANVIONROYALE — demo provider catalog.
 * These are original placeholder provider names — no real third-party branding.
 */

export interface Provider {
  id: string;
  name: string;
  gameCount: number;
  /** CSS gradient class used as a logo placeholder tile. */
  logo: string;
}

export const providers: Provider[] = [
  { id: 'provider-one', name: 'Provider One', gameCount: 84, logo: 'from-teal-500 to-emerald-700' },
  { id: 'provider-two', name: 'Provider Two', gameCount: 62, logo: 'from-cyan-500 to-teal-800' },
  { id: 'provider-three', name: 'Provider Three', gameCount: 57, logo: 'from-sky-500 to-blue-800' },
  { id: 'provider-four', name: 'Provider Four', gameCount: 45, logo: 'from-indigo-500 to-violet-800' },
  { id: 'provider-five', name: 'Provider Five', gameCount: 38, logo: 'from-fuchsia-500 to-purple-800' },
  { id: 'provider-six', name: 'Provider Six', gameCount: 29, logo: 'from-emerald-500 to-green-800' },
];