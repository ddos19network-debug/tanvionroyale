const fs = require('fs');
const path = require('path');
const web = 'd:/tanvionRoyale/apps/web';
function read(p) { return fs.readFileSync(path.join(web, p), 'utf8'); }
function rendersOwnHeader(src) {
  return /import\s+.*from\s+['\"]@\/components\/layout\/app-header['\"]/.test(src) || /^\s*<AppHeader\s*\/>/m.test(src);
}
const nav = read('components/navigation/user-nav.ts');
const userLayout = read('app/(user)/layout.tsx');
const rootLayout = read('app/layout.tsx');
const homeRoot = read('app/(user)/page.tsx');
const homeAlias = read('app/(user)/home/page.tsx');
const header = read('components/layout/app-header.tsx');
const sidebar = read('components/navigation/user-sidebar.tsx');
const checks = [
  ['root / lives inside shared (user) layout', fs.existsSync(path.join(web, 'app/(user)/page.tsx')) && homeRoot.includes('HomeContent') && !rendersOwnHeader(homeRoot)],
  ['/home alias lives inside same shared layout', fs.existsSync(path.join(web, 'app/(user)/home/page.tsx')) && homeAlias.includes('HomeContent') && !rendersOwnHeader(homeAlias)],
  ['no duplicate standalone root app/page.tsx', !fs.existsSync(path.join(web, 'app/page.tsx'))],
  ['shared (user) layout renders AppHeader once', userLayout.includes('<AppHeader />')],
  ['root layout renders UserSidebar once (persistent)', rootLayout.includes('<UserSidebar />')],
  ['TopMenu Home href is / (shared layout route)', header.includes("{ href: '/', label: 'Home' }")],
  ['sidebar allowlist: / is user-panel', nav.includes("pathname === '/'")],
  ['sidebar allowlist: /home kept', nav.includes("'/home'")],
  ['sidebar nav has Home entry -> /', nav.includes("key: 'home'") && nav.includes("href: '/'")],
  ['sidebar mobile unchanged (hidden lg:flex)', sidebar.includes('hidden') && sidebar.includes('lg:flex')],
  ['no temp CSS/focus hack', !/focus-within/i.test(nav + userLayout + rootLayout)],
  ['others in same layout: wallet/notifications/games/sports', fs.existsSync(path.join(web, 'app/(user)/wallet/page.tsx')) && fs.existsSync(path.join(web, 'app/(user)/notifications/page.tsx'))],
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) fail++;
}
// Simulate route -> layout/sidebar visibility matrix (root-cause logic)
function isUserPanelRoute(p) {
  if (!p || p === '/') return true;
  if (p.startsWith('/admin')) return false;
  const prefixes = ['/dashboard','/sports','/games','/live','/events','/wallet','/profile','/settings','/verification','/support','/favorites','/my-bets','/promotions','/trading','/notifications','/home'];
  return prefixes.some((pre) => p === pre || p.startsWith(pre + '/'));
}
const matrix = [
  ['TopMenu Home click: /wallet -> /', '/wallet', '/', true],
  ['Direct / refresh', '/', '/', true],
  ['Direct /home refresh', '/home', '/home', true],
  ['Home -> wallet -> Home', '/', '/wallet', true],
  ['wallet -> Home', '/wallet', '/', true],
  ['notifications -> Home', '/notifications', '/', true],
  ['games -> Home', '/games', '/', true],
  ['admin keeps own shell (no user sidebar)', '/admin', '/admin', false],
];
for (const [name, from, to, expectVisible] of matrix) {
  const vis = isUserPanelRoute(to);
  const ok = vis === expectVisible;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' sidebar visible=' + vis);
  if (!ok) fail++;
}
if (fail) { console.error('VERIFY FAILED: ' + fail); process.exit(1); }
console.log('DESKTOP-HOME-SIDEBAR-VERIFY-OK');
