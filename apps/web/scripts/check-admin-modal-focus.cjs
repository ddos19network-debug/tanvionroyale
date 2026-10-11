/**
 * Regression guard for the admin-panel focus-loss bug.
 *
 * Root cause (fixed in `components/admin/modal.tsx`): the shared `Modal`
 * listed its `onClose` prop in a `useEffect` dependency array AND called
 * `dialogRef.current?.focus()` in that effect. Every admin page passes an
 * inline arrow (`onClose={() => setX(...)}`), so `onClose` is a new function
 * on every render — including every keystroke in a controlled input inside
 * the dialog. Typing therefore re-ran the effect and yanked focus out of the
 * input back onto the dialog container, forcing admins to click the field
 * again after every character.
 *
 * This script statically asserts the trap stays fixed: no `focus()` call may
 * live in an effect that depends on an unstable callback prop (`onClose`,
 * `onCancel`, `onConfirm`), and `SearchOverlay` gets the same guarantee.
 *
 * Run: `node scripts/check-admin-modal-focus.cjs` (exit 0 = pass).
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const modalPath = path.join(repoRoot, 'components', 'admin', 'modal.tsx');
const overlayPath = path.join(repoRoot, 'components', 'home', 'SearchOverlay.tsx');

let failures = 0;

function checkFile(filePath, label) {
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`FAIL [${label}]: cannot read ${filePath}: ${err.message}`);
    failures += 1;
    return;
  }

  // Core bug signature: a `focus()` call that lives in the SAME effect as an
  // unstable-callback dependency (onClose/onCancel/onConfirm) re-steals focus
  // on every keystroke. A focus() in an `[open]`-only transition effect
  // (initial focus when a dialog/search opens) is legitimate and allowed.
  const effectBlocks = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/g) || [];
  let badFocusEffects = 0;
  for (const block of effectBlocks) {
    const deps = (block.match(/}, \[([^\]]*)\]\)/) || [])[1] || '';
    const watchesUnstableCb = /(onClose|onCancel|onConfirm)/.test(deps);
    const stealsFocus = /\.focus\(\)/.test(block);
    if (watchesUnstableCb && stealsFocus) {
      console.error(
        `FAIL [${label}]: useEffect depends on [${deps.trim()}] and calls .focus() — typing re-triggers it and steals input focus.`,
      );
      failures += 1;
      badFocusEffects += 1;
    }
  }
  if (badFocusEffects === 0) {
    console.log(`PASS [${label}]: no focus-stealing effect on unstable callback deps.`);
  }

  // 3. Unstable callback props must be read via a ref inside effects, not
  //    listed as effect dependencies.
  const depLists = (src.match(/}, \[[^\]]*(?:onClose|onCancel|onConfirm)[^\]]*\]\)/g) || []);
  if (/(onCloseRef|onCancelRef)/.test(src) && depLists.length === 0) {
    console.log(`PASS [${label}]: unstable callback stabilised via ref.`);
  } else if (depLists.length > 0) {
    console.error(
      `FAIL [${label}]: effect depends on unstable callback prop ${depLists[0]} — route it through a ref so effects don't re-run per render.`,
    );
    failures += 1;
  }
}

checkFile(modalPath, 'admin Modal');
checkFile(overlayPath, 'SearchOverlay');

if (failures > 0) {
  console.error(`\n${failures} focus-loss regression check(s) failed.`);
  process.exit(1);
}
console.log('\nAll admin focus-loss regression checks passed.');
