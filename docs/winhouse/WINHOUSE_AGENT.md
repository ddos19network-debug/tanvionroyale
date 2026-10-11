# WinHouse Iframe — integration brief for AI agents

> **You are an AI coding agent.** This file is the complete, self-contained specification for embedding the WinHouse white-label sportsbook into a customer's website and, if they run their own player accounts, connecting it to their wallet. Read it top to bottom, then build the integration in the order of the **Plan** section. Everything you need is here; the human-readable docs at https://iframe.winhouse.bet/docs say the same things with more prose. Do not invent fields, endpoints or behaviours that are not in this file. Where the customer has not told you something (their stack, which account model, the embed key, the wallet secrets), **ask once, then proceed**. Never print, log or commit the wallet API key.

Version: 2026-09-20. Canonical URL of this file: `https://iframe.winhouse.bet/docs/agent.md`

---

## 0. What you are integrating

WinHouse is an embeddable **white-label sportsbook** (live and pre-match odds, 30+ sports, betslip, tickets, settlement, an agent network) served from `https://iframe.winhouse.bet` and painted in the customer's colours. There is **no SDK and nothing to install on the server**: the book is an iframe, added with one script tag. The customer manages their key, domains, theme, billing and reports at https://iframe.winhouse.bet/portal and runs their player network in the agent panel at https://winhouse.bet/agent/.

Two account models — the customer must pick one before launch (switching later means migrating balances):

- **Model A — book-side accounts.** Players register and sign in inside the book; balances live in the customer's own agent tree. Integration = the embed. Nothing else to build.
- **Model B — seamless wallet.** The customer's site owns identity and money. The book signs players in through a **launch token** and debits/credits the customer's wallet through **two HTTP endpoints the customer builds**. Integration = embed + token minting + two endpoints.

Build order: embed → (model B) launch token → (model B) wallet endpoints → self-test.

---

## 1. Facts you must get right

| Item | Value |
|---|---|
| Book origin | `https://iframe.winhouse.bet` |
| Embed key | `ifr_` + 40 hex chars. **Public by construction** — it sits in page source, selects the customer's skin and grants nothing. Rotating it in the portal invalidates the old one immediately. |
| What actually gates embedding | the **domain allow-list** on the key (one origin per key by default; more on request) enforced by a `Content-Security-Policy: frame-ancestors` header on the book, **plus** the customer's own CSP `frame-src` must allow `https://iframe.winhouse.bet`. **Exception:** a key with a **server IP** whitelisted (portal → My Book → Server IP) is not domain-locked at all — no `frame-ancestors` header, the book loads on any domain; the IP check on `POST /tenant/session` protects the key instead. |
| Sandbox | a new account works for preview but refuses to load inside any site until a domain is added. |
| Wallet secrets (model B) | two different secrets: the **callback token** (travels in `?token=` on calls *to* the customer, proves the call came from WinHouse) and the **wallet API key** (never travels; HMAC key for signatures and launch tokens, Bearer for `/tenant/session`). Mixing them up is the #1 integration failure. |
| Money | 2-decimal numbers in the customer's book currency. Negative `amount` = stake, positive = payout. |
| Server IP (optional, model B) | if set in the portal, `POST /tenant/session` must come from that address or is `403` before the secret is checked. Players are never IP-checked. |
| Billing | no setup fee; prepaid USDT credit (min 50, never expires) and a monthly % of GGR (Starter 7.5% live / 4.5% prematch; Business 6.5/3.5 at 899 USDT funded; Scale 5.5/2.5 at 2,499 USDT funded). Not part of the code you write. |

---

## 2. Embedding

### 2.1 The loader (recommended)
```html
<div id="winhouse-book"></div>
<script src="https://iframe.winhouse.bet/embed.js"
        data-key="ifr_your_key"
        data-target="#winhouse-book"></script>
```
`embed.js` (4 KB, no dependencies) builds the iframe and **keeps it the height that is actually on screen on phones**. This matters: the book pins its bottom tab bar, betslip button and betslip sheet with `position:fixed` *inside* the frame, so a frame taller than the phone screen parks all three below the fold and the page can never scroll to them.

| Attribute | Meaning |
|---|---|
| `data-key` | required — the embed key |
| `data-target` | CSS selector of the container; omit to insert where the script tag sits |
| `data-width` | default `100%` |
| `data-height` | desktop height, any CSS length or `calc()`; default `900px`; phones ignore it |
| `data-bottom-gap` | px height of the customer's own fixed bottom nav, subtracted on phones |
| `data-embed` | `1` (default) hides the book's own top bar and left rail; `0` keeps them |
| `data-lang`, `data-theme` | UI language (`en sq de it fr es el tr pt bg ar fa`), `dark` or `light` |
| `data-launch` | a signed launch token if one exists at render time (model B) |
| `data-launch-url` | an endpoint on the customer's origin that mints one, called with credentials, expected to answer `{"launch":"…"}`; on failure the book loads signed out |

It exposes `window.WinHouseEmbed = { frame, refit(), setLaunch(token) }` — call `refit()` after layout changes that move the frame, `setLaunch()` after a player signs in without a reload.

### 2.2 Raw iframe (only if the loader cannot be used)
`<iframe src="https://iframe.winhouse.bet/book?key=ifr_your_key&embed=1" allow="fullscreen"></iframe>` and size it yourself:
```css
.sportsbook iframe { display:block; width:100%; height:calc(100dvh - 70px); min-height:560px; border:0; }
@media (max-width:900px) { .sportsbook iframe { height:calc(100dvh - 132px); min-height:0; } }  /* header + bottom nav; a min-height taller than the screen IS the bug */
```
URL parameters: `key` (if missing, the brand is resolved from the embedding domain against the allow-list — still branded on a listed domain; the launch token always needs the key), `lang`, `embed=1`, `launch=<url-encoded token>` (model B), `preview_theme=<url-encoded JSON>` (styling preview only).

### 2.3 Customer-side CSP
If the customer's site sends a `Content-Security-Policy`, add `frame-src 'self' https://iframe.winhouse.bet;` or the browser refuses the frame with `Refused to frame 'https://iframe.winhouse.bet/' …`.

### 2.4 Read-only tenant endpoints (unauthenticated, key is public)
- `GET /tenant/config?key=ifr_…` → `{ "ok": true, "name": "Acme Bet", "theme": { "accent": "#FF8A00", … } }`; `404` when the key is unknown or suspended (uncached on purpose — a kill switch).
- `GET /tenant/frame-policy?key=ifr_…` → `{ "header": "frame-ancestors 'self' https://example.com https://www.example.com" }`; for a key opened by its server IP → `{ "header": null, "open_by_server_ip": true }`.
Theme tokens (31, set in the portal, not in code): a token must be a hex colour or a short length (`px rem em %`); anything else is dropped. Groups: brand (`accent accent-ink brand green blue`), surfaces (`bg surface surface-2 surface-3 hover border track disabled`), shell (`shell shell-line nav-txt nav-sub`), text (`text text-2 text-dim text-faint`), status (`live up down win-green hl-pink`), layout (`radius row-h odd-w sidebar-w slip-w`).

---

## 3. Model B — signing players in (launch token)

Being signed in on the customer's site does not sign a player into the book (separate origins, separate databases). The hand-off is a short-lived token the **customer's server** mints and puts in the iframe URL; the book redeems it itself.

```
launch    = <player_id>.<expiry>.<session>.<signature>
signature = HMAC_SHA256( "<player_id>|<expiry>|<session>", wallet_api_key ).hex()
```
- `player_id` — the customer's own stable id for the player; the same value the wallet calls quote back as `username`.
- `expiry` — epoch **milliseconds**, in the future and **no more than 10 minutes ahead**; mint per page load, not per session.
- `session` — the customer's session id for this login; stored against the player and quoted back on every wallet call (ending the session on the customer's side lets them stop bets). May be empty, at the cost of that control.
- Fields joined with `|`, HMAC-SHA256, lowercase hex, keyed with the **wallet API key** (not the callback token).

Put it in the URL: `…/book?key=ifr_…&embed=1&launch=<url-encoded token>` (or `data-launch` / `data-launch-url` on the loader). The book then calls `POST /tenant/sso { "key": "ifr_…", "launch": "<token>" }` → `{ "ok": true, "token": "<book session>", "username": "acme_5512", "tenant": "acme" }`, provisioning a shell player `<slug>_<player_id>` under the customer's tree on first sight; that player carries no balance — every stake and payout goes to the wallet endpoints. A missing, expired or malformed token is **not** an error: the book loads signed out.

Server-to-server alternative (same provisioning, same response):
```
POST https://iframe.winhouse.bet/tenant/session
Authorization: Bearer <wallet_api_key>
X-WH-Domain: example.com            # optional — the site the player is on, for per-site reports
{ "customer_key": "ifr_…", "player_id": "5512" }
```
Errors: `400` malformed key or token without four fields · `401` expired, dated too far ahead, or bad signature (wrong secret, or fields not joined with `|`) · `404` unknown / suspended key · `409` no wallet configured (model B only).

Node example:
```js
const crypto = require('crypto');
function mintLaunch(playerId, sessionId, walletApiKey) {
  const expiry = Date.now() + 5 * 60 * 1000;
  const base = `${playerId}|${expiry}|${sessionId}`;
  const sig = crypto.createHmac('sha256', walletApiKey).update(base).digest('hex');
  return `${playerId}.${expiry}.${sessionId}.${sig}`;
}
```

---

## 4. Model B — the seamless wallet (two endpoints the customer builds)

The customer registers **one base URL** in the portal (Manage Account → General → Seamless wallet) plus a callback token; the wallet API key is generated on first save and shown there with Copy / Rotate. WinHouse appends two paths: `<base>/user-data` and `<base>/balance-change`. Both are called server-to-server over HTTPS and must be public.

### 4.1 `GET <base>/user-data?token=<callback_token>&username=<player_id>`
Reply `{ "username": "5512", "balance": "250.00", "currency": "EUR" }`. A reply that cannot be read as a number is treated as "balance unknown" — WinHouse never assumes zero.

### 4.2 `POST <base>/balance-change?token=<callback_token>` (JSON)
```json
{ "username": "5512",
  "session": "<session id from the launch token>",
  "transaction_id": "bet_88213",     // idempotency key, stable across retries
  "amount": -25.00,                  // negative = stake, positive = payout
  "action": "bet",                   // "bet" | "win"
  "ticket_id": "88213",              // may be empty
  "signature": "<hmac>" }
```
Reply `{ "status": "ok", "balance": "225.00" }`.

### 4.3 Signature — verify on every `balance-change`
```
signature = HMAC_SHA256( username + amount + action + ticket_id + transaction_id, wallet_api_key ).hex()
```
Five fields concatenated **with no separator, in exactly this order**; an absent field contributes an empty string; `amount` is stringified **as sent on the wire** (`-25`, not `-25.00`, when that is what arrived). Reconstruct the base from the parsed body values, not from the raw JSON text (field order in the document is not part of the contract). Compare with a constant-time comparison.

### 4.4 Rules the endpoint must follow
1. **Verify** the signature and compare `?token=` with the callback token in constant time on every call.
2. **Idempotent** on `transaction_id`: same id + same payload → return the original result unchanged; same id + different payload → `409`.
3. **Atomic**: lock the player row and apply the change in one DB transaction; a retry must never double-debit.
4. **Reject overdraft**: a debit larger than the balance → `422`, nothing changes.
5. **Answer promptly**: a slow reply is indistinguishable from a lost one and is retried.

### 4.5 How WinHouse treats the reply
| Reply | Effect |
|---|---|
| HTTP `200` with `"status": "ok"` | applied; `balance` read if present. Any other 2xx, or a 200 without `status: ok`, is treated as in doubt and retried |
| `401 403 404 409 422` | deliberate refusal — final; the bet is rejected and **not** retried |
| timeout, `5xx`, unreachable | in doubt, not failed — stays pending and is **retried later with the same `transaction_id`** (possibly out of order) |

### 4.6 Reference implementation (Node/Express) — port it, don't copy blindly
```js
const crypto = require('crypto');
const CB = process.env.WINHOUSE_CALLBACK_TOKEN, KEY = process.env.WINHOUSE_WALLET_API_KEY;
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const tokenOk = req => typeof req.query.token === 'string' && safeEq(req.query.token, CB);

app.get('/api/winhouse/user-data', async (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'bad token' });
  const p = await players.byId(req.query.username);
  if (!p) return res.status(404).json({ error: 'unknown player' });
  res.json({ username: String(p.id), balance: p.balance.toFixed(2), currency: p.currency });
});

app.post('/api/winhouse/balance-change', express.json(), async (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'bad token' });
  const b = req.body || {};
  const base = String(b.username ?? '') + String(b.amount ?? '') + String(b.action ?? '') + String(b.ticket_id ?? '') + String(b.transaction_id ?? '');
  const expect = crypto.createHmac('sha256', KEY).update(base).digest('hex');
  if (!b.signature || !safeEq(String(b.signature), expect)) return res.status(401).json({ error: 'bad signature' });
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'bad amount' });
  const r = await db.tx(async t => {
    const prev = await t.ledger.byTx(b.transaction_id);                 // idempotency
    if (prev) return prev.payload === JSON.stringify(b) ? { ok: true, balance: prev.balanceAfter } : { conflict: true };
    const p = await t.players.lockById(b.username);                     // SELECT … FOR UPDATE
    if (!p) return { notFound: true };
    if (amount < 0 && p.balance + amount < 0) return { overdraft: true };
    const balance = +(p.balance + amount).toFixed(2);
    await t.players.setBalance(p.id, balance);
    await t.ledger.insert({ tx: b.transaction_id, player: p.id, amount, action: b.action, ticket: b.ticket_id, session: b.session, balanceAfter: balance, payload: JSON.stringify(b) });
    return { ok: true, balance };
  });
  if (r.conflict)  return res.status(409).json({ error: 'transaction_id reused with a different payload' });
  if (r.notFound)  return res.status(404).json({ error: 'unknown player' });
  if (r.overdraft) return res.status(422).json({ error: 'insufficient balance' });
  res.json({ status: 'ok', balance: r.balance.toFixed(2) });
});
```

---

## 5. Plan — do this, in this order

1. **Ask once**: model A or B; the embed key; for model B the callback token and wallet API key (from the portal) and the base URL they will register; whether the site has a fixed bottom nav (its height) and a CSP.
2. **Config**: `WINHOUSE_EMBED_KEY` (public), and for model B `WINHOUSE_CALLBACK_TOKEN` and `WINHOUSE_WALLET_API_KEY` (secrets, server-only).
3. **Embed**: the loader snippet in the page where the book goes, with `data-bottom-gap` if there is a fixed bottom nav and `data-lang`/`data-theme` from the site's settings; break the container out of any width-constraining wrapper; add `frame-src https://iframe.winhouse.bet` to the site's CSP if it has one. Tell the customer to add the site's origin under My Book → Domain in the portal.
4. **Model A stops here.** Verify `GET /tenant/config?key=…` answers `ok: true` and the frame renders on the allow-listed domain.
5. **Model B — launch**: a server-side route (or the page render) that mints the launch token for the logged-in player (§3) and hands it to the loader via `data-launch` or `data-launch-url`; call `WinHouseEmbed.setLaunch()` after an in-page login.
6. **Model B — wallet**: implement `user-data` and `balance-change` exactly as §4, with a ledger table keyed on `transaction_id` and a row lock per player. Deploy them publicly over HTTPS; give the customer the base URL to register in the portal and, if they lock the server IP, the address `/tenant/session` calls come from.
7. **Self-test** (model B): (a) `POST /tenant/sso` with a freshly minted token returns `ok: true` and a `username` of `<slug>_<player_id>`; a token with `expiry` 11 minutes ahead returns `401`; (b) a `balance-change` with a valid signature debits once; the same request replayed returns the same balance and changes nothing; the same `transaction_id` with a different amount returns `409`; (c) a debit larger than the balance returns `422` and the balance is unchanged; (d) a wrong `?token=` returns `401` before any DB work; (e) `user-data` answers well under a second. Then place a real bet in the book on the customer's domain and watch the ledger.

## 6. Gotchas that break real integrations
- Signing with the callback token, or comparing `?token=` against the wallet API key — two secrets, two jobs.
- Joining the launch fields with anything but `|`, using seconds instead of milliseconds for `expiry`, or dating it more than 10 minutes ahead → `401` and a book that quietly loads signed out.
- Building the signature base with a separator, in a different field order, or from `-25.00` when the wire said `-25`.
- Non-idempotent `balance-change` → a retried timeout double-debits the player.
- Returning `5xx`, timing out, or answering `200` without `"status":"ok"` for a deliberate refusal → the stake is retried; refuse with `401/403/404/409/422`.
- A fixed frame height taller than a phone screen, or a `min-height` on phones → no tab bar and no betslip on mobile. Use the loader.
- A CSP without `frame-src https://iframe.winhouse.bet`, or a domain missing from the allow-list → empty frame.
- Registering a wildcard or a second domain on a single-domain key → refused on save; ask WinHouse to raise the limit.


## 7. TANVION verified deployment notes (2026-09-24)

- Production frontend origin verified from repository and live headers: `https://tanvionroyale.vercel.app` (non-www). Register that exact origin; do not add wildcard or assume the `www` host.
- Production callback base verified from `render.yaml` and the live health deployment: `https://tanvionroyale.onrender.com/api/v1/winhouse`. WinHouse appends `/user-data` and `/balance-change`.
- The official specification linked above defines only `bet` and `win` financial actions. It defines no refund, rollback, void, reversal, or webhook event contract. TANVION therefore does not implement those operations or the screenshot-only event names `session.started`, `round.completed`, or `session.ended`.
- Server IP is optional and applies only to the provider's server-to-server `POST /tenant/session` mode. The official specification documents an address check but does not document CIDR or multiple-value syntax, so TANVION accepts only one exact public IP and leaves the field unset by default. Render's normal outbound addresses are not a guaranteed dedicated address; if server-to-server mode is adopted, configure only the verified Render Dedicated Outbound IP—never invent an address.
- The embed key is public client configuration. The callback token and wallet API key are secrets. Any exposed live/test secret should be rotated in the provider portal and then saved through Admin → Partner providers (or Render environment secrets) without printing it.

---

Human docs: https://iframe.winhouse.bet/docs · Portal (key, domains, theme, wallet secrets, billing): https://iframe.winhouse.bet/portal · Agent panel: https://winhouse.bet/agent/ · Support: sales@winhouse.bet
