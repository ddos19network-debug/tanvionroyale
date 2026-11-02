# Playing-cards credit (Royale Ace)

**Status: PACK NOT YET IN REPO — placeholders in use, nothing copied.**

When the deck lands, unzip it (originals untouched) to:

- `apps/web/public/games/royale-ace/cards-src/Playing Cards/SVG-cards-1.3/*.svg` (134 files)
- `apps/web/public/games/royale-ace/cards-src/Playing Cards/PNG-cards-1.3/*.png` (500×726)

Pack: **SVG-cards 1.3 (vector-playing-cards)** — the classic open deck.
Source URL found in the SVG header: <http://code.google.com/p/vector-playing-cards/>.
License: commonly distributed under **LGPL** — **VERIFY from the original
project before shipping** and keep the required notice in the repo. If the
license is unclear, STOP and confirm before release.

Used symbols (verified by `scripts/build-ace-card-art.mjs` at build time):

| symbol | source svg | note |
|---|---|---|
| ACE | `ace_of_spades.svg` | ornate big-spade ace |
| KING | `king_of_hearts2.svg` | court figure (verify: plain = `king_of_hearts.svg`) |
| QUEEN | `queen_of_spades2.svg` | court figure (verify: plain = `queen_of_spades.svg`) |
| JACK | `jack_of_clubs2.svg` | court figure (verify: plain = `jack_of_clubs.svg`) |
| spade | `ace_of_spades2.svg` | plain big suit, cropped |
| heart | `ace_of_hearts.svg` | plain big suit, cropped |
| diamond | `ace_of_diamonds.svg`/`2` | plain big suit, cropped |
| club | `ace_of_clubs.svg`/`2` | plain big suit, cropped |

Jokers are NOT used — our WILD is our own crown art, our SCATTER is our own
coin art. Our game name is "Royale Ace" with our own logo only.
