# BigBang Casino API — integration brief for AI agents

> **You are an AI coding agent.** This file is the complete, self-contained specification for integrating the BigBang Casino Games API into an operator's platform. Read it top to bottom, then build the integration in the order of the **Plan** section. Everything you need is here; the human-readable docs at https://api.bigbangcasino.bet/docs/ say the same things with more prose. Do not invent fields, endpoints or behaviours that are not in this file. Where the operator has not told you something (their language, framework, database, which wallet model they want), **ask once, then proceed**. Never print, log or commit the API key.

Version: docs **v1.10** (2026-09-20). Canonical URL of this file: `https://api.bigbangcasino.bet/docs/agent.md`

---

## 0. What you are integrating

BigBang is a B2B casino game aggregator: **45+ providers, 6,000+ games**, one REST API. Two tiers: **Standard** (in-house / emulated engines) and **Premium** (real-money providers via the Reeltrix aggregator). Money can live either **with BigBang** (managed wallet — you deposit/withdraw) or **with the operator** (seamless wallet — BigBang calls two HTTP endpoints you build, for every bet and win).

The integration has four parts. Build them in this order:

1. **Catalog** — pull the games and providers visible to the key, store them, show them.
2. **Players** — create a player per user, or let the seamless `user_data` endpoint auto-provision them.
3. **Launch** — get a signed `game_url` and embed it in an iframe.
4. **Money** — managed wallet (two calls) **or** seamless wallet (two endpoints on the operator's side). Most real operators want **seamless**.

---

## 1. Facts you must get right

| Item | Value |
|---|---|
| Base URL | `https://api.bigbangcasino.bet/api/v1` |
| Auth | header `X-API-Key: <API_KEY>` on every request (fallback: `?api_key=` query param). Server-to-server only — **never in browser code**. |
| Content type | JSON in, JSON out. `Content-Type: application/json` on POST. |
| Envelope | every response has `"success": true|false`; on error an `error` object `{ "code": <http status>, "message": "…" }`. |
| Money | numbers with 2 decimals, in the **player's account currency** (set at player creation, default `EUR`; not passed per launch). |
| Keys | **Live** = opaque token (no prefix). **Sandbox** = prefixed `ek_test_` — Standard providers only, Premium returns 403, players get a synthetic 100,000 balance, callbacks carry `"sandbox": true`. Same endpoints, no code change between sandbox and live. |
| The key is also the HMAC secret | for the signed `game_url` and for verifying seamless callbacks. Store it as a secret (`BIGBANG_API_KEY` env var). |
| Rate limit | per-key per-minute / per-hour throttle → `429`. No per-launch quota; billing is a % of monthly GGR per provider. |
| Timeouts | BigBang gives your seamless endpoints **10 s** per call. |

HTTP status meanings: `200` OK (`201` on player creation) · `400` validation / game or user not found / insufficient balance · `401` bad or missing key · `403` key lacks permission, IP/domain blocked, or Premium game on a sandbox key · `404` not found · `429` throttled · `500` server error.

---

## 2. Endpoints

### 2.1 `GET /games` — catalog
Query: `category` (provider slug, e.g. `Pragmatic`), `provider` (alias), `search` (substring of name), `type`/`mode` = `standard` | `premium`, `limit` (default 100, max 5000), `offset` (default 0). Requires key permission `can_read_games`.

```json
{ "success": true,
  "data": [ { "id": 4821, "name": "SGHotHotFruit", "title": "Hot Hot Fruit", "provider": "Habanero",
              "category": "Habanero", "category_title": "Habanero",
              "thumbnail": "https://bigbangcasino.bet/frontend/Vegas/ico/Habanero/SGHotHotFruit.webp?v=1699999999",
              "mode": "standard", "is_premium": false, "game_type": "slot", "is_demo": false } ],
  "pagination": { "total": 1420, "limit": 20, "offset": 0 } }
```

Rules:
- `id` is what you launch with and what the wallet reports back as `game_id`. Store it.
- `name` is the launch slug — **not for display** (some providers are all-lowercase, e.g. `alibabascaveoffortune`). Display `title`.
- `game_type` ∈ `slot` | `live` | `crash`. Filter client-side; there is no separate live-games endpoint.
- `thumbnail` is a full URL or `null`.
- With no filter the order is shuffled by a daily seed (pagination stays stable within the day). To sync the whole catalog, page with `limit=5000` and `offset` until `offset >= pagination.total`.
- Never hard-code the catalog or the provider list — both depend on the key's plan and shop. Re-sync periodically (daily is fine).

### 2.2 `GET /games/:id` — one game
Same fields plus `description`. `404` if the game does not exist for the shop, `403` if not enabled for the key.

### 2.3 `GET /categories` — providers
```json
{ "success": true, "data": [ { "id": 38, "name": "Pragmatic", "slug": "Pragmatic", "premium": false },
                             { "id": 91, "name": "Pragmatic Play", "slug": "PragmaticPlay", "premium": true } ] }
```
`slug` is the value for `?category=` / `?provider=` on `/games`, and is what the wallet reports back as `provider_id`. There is **no numeric provider id** anywhere else — the slug is the id. Sandbox keys never see Premium categories.

### 2.4 `POST /games/launch` — signed game URL
Requires `can_launch_games`. Body:

| Field | Req | Meaning |
|---|---|---|
| `game_id` | yes | numeric id from `/games` |
| `user_token` | yes for real money | **your** unique player id (string, max 255). Use `"demo"` / `"guest"` or `demo: true` for fun mode. |
| `demo` | no | `true` = fun mode, virtual balance, no wallet involved |
| `language` | no | ISO 639-1 (`en` default; `pt-BR` → `pt`). Missing translations fall back to English, never fail. |
| `return_url` | no | where to send the player on exit |
| `device` | no | Premium only: `desktop` (default) \| `mobile` |
| `home_url` | no | Premium only: lobby URL for the in-game home button |

```json
{ "success": true,
  "game_url": "https://bigbangcasino.bet/api/game/Habanero/SGHotHotFruit/1481/player_42/1699999999/ab12cd…",
  "session_id": "9f8e7d6c5b4a…", "game_id": 4821, "game_name": "SGHotHotFruit" }
```
Premium launches return `game_url` + `provider`, no `session_id`. Demo launches return `"demo": true`.

Rules:
- Embed with `<iframe src="{game_url}" allow="autoplay; fullscreen">`. Call `/launch` **from your backend** at the moment the player opens a game; do not cache URLs.
- A real-money launch for an unknown `user_token` returns `400 "User not found"` — **unless** the key has a seamless `user_data` endpoint, in which case the player is auto-provisioned from it. With a managed wallet, call `POST /users/create` first.
- Alias: `POST /launch` proxies to the same endpoint.

### 2.5 Players (managed wallet, and optional for seamless)
- `POST /users/create` `{ user_token, username?, country? }` → `201` new, `200` `"message": "User already exists"` (idempotent). Response `data`: `user_token, username, balance, currency`.
- `GET /users/:user_token` → `user_token, username, balance, currency, status, country`.
- `GET /users/:user_token/history?from&to&game_id&limit` (max 200; needs `can_view_stats`) → rows `{ id, game, bet, win, date_time }`.

### 2.6 Managed wallet (only if the operator chooses it)
- `GET /balance/:user_token` → `{ user_token, balance, currency }`
- `POST /balance/deposit` `{ user_token, amount ≥ 0.01, transaction_id }` (needs `can_manage_balance`; `transaction_id` must be unique — idempotency/audit) → `{ user_token, balance_before, balance_after, amount, transaction_id }`
- `POST /balance/withdraw` — same body/response; `400 "Insufficient balance"` if too much.

---

## 3. Seamless wallet — the two endpoints you build

The operator registers two URLs on the API key **in the Dashboard** (https://api.bigbangcasino.bet/portal → API Keys). They are not passed per launch and there is no API to set them. Tell the operator to do this, and which URLs to enter.

### 3.1 `user_data` — balance read (HTTP GET)
```
GET {user_data_url}?username=player_42
→ 200 { "username": "player_42", "balance": "1250.00", "currency": "EUR" }
```
Called when a session needs the balance/identity (on launch, and as a fallback). `balance` may be a string or number; keys accepted: `balance` / `Balance`, top-level or under `data`. Return `404` for an unknown player. Keep it fast (< 500 ms): it sits in the player's game-open path. Timeout: 10 s.

### 3.2 `balance_change` — every bet, win and refund (HTTP POST, JSON)
```json
{ "username": "player_42",
  "amount": -2.5,
  "game": "SGHotHotFruit",
  "game_category": "Habanero",
  "transaction_id": "66a3f1b2c…",
  "signature": "hmac_sha256_hex…",
  "round_id": "66a3f1b2c…",
  "type": "round",
  "round_end": true,
  "game_id": 214529,
  "provider_id": "Habanero",
  "sandbox": true }
```
`amount` < 0 is a debit (bet), > 0 a credit (win/refund), and **may be exactly `0`** (a round close — see §3.4). `sandbox` is present (and `true`) only for sandbox-key traffic — never move real money when it is set.

Your response: `200` with the new balance — `{ "status": "ok", "balance": "1247.50" }` (same accepted keys as `user_data`).

**Refusing a bet:** answer **`400 { "error": "insufficient balance" }`** (any 4xx refuses the round; the word *insufficient* in `error` is what makes Premium games show the proper "insufficient funds" dialog instead of a generic error) and BigBang **refuses the round** — nothing is dealt, nothing is queued, no retry. This is the only correct way to say "no money". Never answer 2xx without a balance.

### 3.3 Signature — verify on every `balance_change`
```
signature = HMAC_SHA256( username + amount + game + game_category + transaction_id , API_KEY )   // hex, lowercase
```
Concatenate the five fields as strings, in this order, no separators. **`amount` must be rendered exactly as the JSON number's shortest form** — the way JavaScript `String(n)` or PHP `(string)$float` render it: `-2.5` (not `-2.50`), `0` (not `0.0` / `0.00`), `100` (not `100.0`), `1.25`. If your language formats floats differently (Python `str(0.0)` = `"0.0"`, Go, Java…), normalise first:

```js
// JS / TS — String(p.amount) is already correct
const base = String(p.username) + String(p.amount) + String(p.game) + String(p.game_category) + String(p.transaction_id);
```
```python
def js_num(n):                       # Python: match JS String(n)
    f = float(n); return str(int(f)) if f == int(f) else repr(f).rstrip('0').rstrip('.')
base = p['username'] + js_num(p['amount']) + p['game'] + p['game_category'] + p['transaction_id']
```
Compare with a constant-time comparison. `round_id`, `type`, `round_end`, `game_id`, `provider_id`, `sandbox` are **not** in the signature (they are informational and may be added to over time — ignore unknown fields, never reject them).

### 3.4 Rounds — link bets to wins, close rounds
Every movement carries `round_id`, `type` and `round_end`:

| Source | `type` | Shape |
|---|---|---|
| Standard games, most providers | `round` | one self-contained movement per round: `amount` = net (bet − win), `round_id` = `transaction_id`, `round_end: true` |
| Standard — PG Soft, JILI, Endorphina, Fugaso, Gamzix, Amusnet, Iconic21 | `bet`, `win`, `refund` | linked movements under one `round_id`: a `bet` (`round_end: false`), zero or more `win`s (a PG Soft feature pays each free spin as it lands, `round_end: false` while it continues), then a final movement with `round_end: true` — a `win` (**0 on a loss**) or a `refund`. Live tables may open a round with several `bet`s before closing once. |
| Premium games | `bet`, `win`, `refund` | `bet` (`round_end: false`) then exactly one `win` (may be 0, `round_end: true`); a `refund` reverses a cancelled bet under the same `round_id` and closes it |

**`round_end: true` = no further movement will follow for this `round_id`.** Close the round in your ledger on that movement. Design the ledger as: one row per `transaction_id` (unique), grouped by `round_id`; never assume one bet + one win. **Accept `amount: 0`** — it is how a lost round is closed. (If your endpoint rejects a 0 amount, BigBang notices, stops sending zero closes to you for an hour and reads `user_data` instead, and you get no close for losing rounds.)

### 3.5 Idempotency, failures, retries
- A movement that fails (non-2xx on a **win**, timeout > 10 s, or 2xx without a usable balance) is retried **3× immediately** (100/200/400 ms), then stored and **replayed hourly up to 12 times** — always with the **same `transaction_id`**. So: on a duplicate `transaction_id`, do **not** apply it again — return the balance you returned the first time (`{ "status": "ok", "balance": "…", "duplicate": true }`).
- A failed **bet** is not retried: the round is refused (see §3.2). Replayed movements arrive later with their original `round_id`/`type`/`round_end`.
- Apply the balance change and the ledger insert in **one database transaction**, with the player row locked (`SELECT … FOR UPDATE`): rounds fire debits and credits within the same second.
- Respond fast. Log every request/response pair with the `transaction_id` — that is the only key both sides share in a dispute.

### 3.6 Reference implementation (Node/Express) — port it, don't copy blindly
```js
const express = require('express'), crypto = require('crypto');
const app = express(); app.use(express.json());
const API_KEY = process.env.BIGBANG_API_KEY;         // the key = HMAC secret
// replace these two maps with your DB (players.balance; wallet_tx keyed by transaction_id)
const balances = new Map([['player_42', 1250.00]]), applied = new Map();

app.get('/wallet/user', (req, res) => {                 // user_data
  const u = req.query.username;
  if (!balances.has(u)) return res.status(404).json({ error: 'unknown user' });
  res.json({ username: u, balance: balances.get(u).toFixed(2), currency: 'EUR' });
});

app.post('/wallet/balance', (req, res) => {              // balance_change
  const p = req.body || {};
  const base = String(p.username) + String(p.amount) + String(p.game) + String(p.game_category) + String(p.transaction_id);
  const sig = crypto.createHmac('sha256', API_KEY).update(base).digest('hex');
  if (sig.length !== String(p.signature).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(String(p.signature))))
    return res.status(401).json({ error: 'bad signature' });
  if (p.sandbox) return res.json({ status: 'ok', balance: '100000.00' });         // never touch real money
  if (applied.has(p.transaction_id))                                               // duplicate = same answer
    return res.json({ status: 'ok', balance: applied.get(p.transaction_id).toFixed(2), duplicate: true });
  if (!balances.has(p.username)) return res.status(404).json({ error: 'unknown user' });
  const next = Math.round((balances.get(p.username) + Number(p.amount)) * 100) / 100;
  if (next < 0) return res.status(400).json({ error: 'insufficient balance', balance: balances.get(p.username).toFixed(2) });
  balances.set(p.username, next);                        // in your DB: one transaction: update + ledger insert
  applied.set(p.transaction_id, next);                   // ledger row: transaction_id, round_id, type, round_end, amount, game_id, provider_id
  res.json({ status: 'ok', balance: next.toFixed(2) });
});
app.listen(8080);
```
Suggested ledger table: `wallet_tx(transaction_id PK, round_id, type, round_end, username, amount, game, game_id, provider_id, balance_after, created_at)` with an index on `(username, round_id)`.

---

## 4. Webhooks (optional, separate from the money path)
Configured in the Dashboard with a URL + secret; signed with HMAC-SHA256 using the **webhook secret** (not the API key). Events: `session.started`, `session.ended`, `round.completed`. Treat as notifications only — never derive balances from them.

---

## 5. Plan — do this, in this order

1. **Config**: `BIGBANG_API_KEY` (secret), `BIGBANG_BASE_URL=https://api.bigbangcasino.bet/api/v1`, `BIGBANG_WALLET_MODE=seamless|managed`. Start with the operator's **sandbox key** if they have one.
2. **Client**: a small server-side HTTP client that adds `X-API-Key`, parses the envelope, maps `error.code` → exceptions, retries `429`/`5xx` with backoff (never retry `/launch` blindly — it is cheap to call again on demand).
3. **Catalog sync**: `/categories` + paged `/games` into your DB (`bigbang_games`: id, name, title, provider slug, game_type, mode/is_premium, thumbnail). Expose it to your frontend. Schedule a daily re-sync; mark games that disappeared as inactive rather than deleting them (your ledger references them).
4. **Launch**: a backend route `open-game(game_id)` for a logged-in user → `/games/launch` with `user_token` = your stable user id, `language`, `return_url` → return `game_url` → frontend iframe. Demo route with `demo: true` for logged-out visitors.
5. **Money** — seamless: implement §3 exactly (both endpoints, HTTPS, public), with the ledger table and a DB transaction per movement. Managed: create the player on first launch, then `deposit`/`withdraw` on the operator's cashier actions.
6. **Tell the operator** the two public URLs to register on the key in the Dashboard (seamless), and to fund the account before Premium live play.
7. **Self-test** (sandbox key, no money): register the URLs on the sandbox key, launch any Standard game, play a few spins, and assert in your logs: (a) every `balance_change` verified its signature; (b) a replayed `transaction_id` returned the same balance and changed nothing; (c) a losing linked round ended with a `win` of `0`, `round_end: true`; (d) a bet on a player with 0 balance was answered `400` and the game showed "insufficient balance"; (e) `user_data` answered in < 500 ms. Then switch the env var to the live key.

## 6. Gotchas that break real integrations
- Formatting `amount` as `-2.50` in the signature base → every signature fails. Use the shortest JS-style form.
- Rejecting `amount: 0` → losing rounds never close on your side.
- Applying a retried `transaction_id` twice → double credits.
- Keying your ledger on `game` + `game_category` → not unique; key on `game_id` / `provider_id`.
- Returning `200` with no balance, or an HTML error page → counted as a failure and retried for 12 hours.
- Exposing the API key or calling `/launch` from the browser → the key is the HMAC secret for your wallet; rotate it immediately if it leaks.
- Reading the game catalog once and hard-coding it → the visible set changes with the plan; sync from the API.

---

Human docs: https://api.bigbangcasino.bet/docs/ · Dashboard: https://api.bigbangcasino.bet/portal · Support: through the Dashboard.
