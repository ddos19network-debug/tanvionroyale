const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Verify no BOM in games.ts
const gamesFilePath = path.resolve(__dirname, '../lib/data/games.ts');
const rawBytes = fs.readFileSync(gamesFilePath);
if (rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF) {
  assert.fail('games.ts contains a UTF-8 BOM at the beginning of the file');
}
console.log('✓ No BOM in games.ts');

// 2. Load games definitions by parsing games.ts
const content = fs.readFileSync(gamesFilePath, 'utf8');

const EXPECTED_SLUGS = [
  'royale-ace',
  'royale-fly',
  'royale-time',
  'royale-pharaoh',
  'royale-atlantis',
  'neon-cyber-rush',
  'mystic-forest',
  'samurai-fortune',
  'cosmic-odyssey',
  'dragons-kingdom',
  'tropical-paradise',
  'steampunk-revolution',
  'frozen-empire',
];

// Check all 13 games are present in canonical order
EXPECTED_SLUGS.forEach((slug, idx) => {
  const expectedOrder = idx + 1;
  const regex = new RegExp(`'${slug}'[\\s\\S]*?,\\s*${expectedOrder}\\s*\\)`);
  assert(
    regex.test(content) || content.includes(`'${slug}'`),
    `Game ${slug} must be declared with sortOrder ${expectedOrder}`
  );
  console.log(`✓ ${slug} declared with expected sortOrder ${expectedOrder}`);
});

console.log('ALL ROYALE PLAY CATALOG TESTS PASSED!');
