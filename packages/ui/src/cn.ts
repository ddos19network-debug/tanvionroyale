/**
 * Minimal class-name combiner. A full `clsx`/`tailwind-merge` equivalent
 * can replace this later without changing call sites.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}