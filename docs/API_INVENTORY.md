# TANVIONROYALE — API Inventory & Contract Documentation
**Audit Date:** 2026-11-14
**Base Path:** `/api/v1`

---

## 1. Authentication & Users

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `POST` | `/auth/register` | Public | Register user with email/phone & password |
| `POST` | `/auth/login` | Public | Dual-identifier login (email or phone) |
| `POST` | `/auth/refresh` | Public | Refresh token rotation |
| `POST` | `/auth/logout` | User | Terminate session and blacklist token |
| `POST` | `/auth/oauth/google` | Public | Google OAuth token verification and account creation |
| `POST` | `/auth/request-otp` | Public | Request email/SMS OTP |
| `POST` | `/auth/verify-otp` | Public | Verify OTP code |
| `GET` | `/users/me` | User | Retrieve current user profile, VIP tier & roles |
| `PATCH`| `/users/me` | User | Update first/last name, phone, preferences |
| `POST` | `/users/me/password` | User | Change password |
| `GET` | `/users/me/sessions` | User | List active user login sessions |
| `DELETE`| `/users/me/sessions/:id` | User | Revoke remote session |

---

## 2. Wallet & Financial API

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `GET` | `/wallet` | User | Retrieve multi-currency balances and active wallet |
| `GET` | `/wallet/transactions` | User | Paginated transaction history |
| `POST` | `/wallet/deposits` | User | Create deposit request with proof |
| `POST` | `/wallet/withdrawals` | User | Create withdrawal request |
| `GET` | `/wallet/payment-methods` | User | List enabled payment methods (bKash, Nagad, Crypto) |
| `POST` | `/wallet/webhooks/:gateway` | Public (Signed) | Process gateway callback |

---

## 3. Trading & Market Data API

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `GET` | `/trading/instruments` | Public/User | List tradable assets with 24h change & quotes |
| `GET` | `/trading/candles` | Public/User | Fetch OHLCV candles with timeframe aggregation |
| `GET` | `/trading/orderbook` | Public/User | Retrieve depth levels (bids & asks) |
| `GET` | `/trading/trades` | Public/User | Stream recent market trades |
| `POST` | `/trading/orders` | User | Place market, limit or stop-limit paper order |
| `GET` | `/trading/orders` | User | List user's active and historical orders |
| `DELETE`| `/trading/orders/:id` | User | Cancel open order |
| `GET` | `/trading/positions` | User | List open trading positions with unrealized PnL |
| `POST` | `/trading/positions/:id/close` | User | Close position at market price |
| `POST` | `/trading/faucet` | User | Claim virtual paper funds |

---

## 4. Sportsbook & Betting API

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `GET` | `/sports` | Public | List sports and active category counts |
| `GET` | `/sports/:id/competitions` | Public | List leagues and competitions |
| `GET` | `/events` | Public | Query upcoming and live matches |
| `GET` | `/events/:id` | Public | Detailed match markets and odds |
| `POST` | `/betting/bets` | User | Submit single or accumulator bet |
| `GET` | `/betting/bets` | User | Fetch user's active and settled bets |
| `GET` | `/winhouse/launch-token` | User | Generate signed launch token for WinHouse iframe |

---

## 5. Casino & In-House Games API

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `GET` | `/games` | Public | List game catalog with provider and category filters |
| `POST` | `/games/play/royale-crash/bet` | User | Place crash multiplier bet |
| `POST` | `/games/play/royale-crash/cashout` | User | Cash out active crash round |
| `POST` | `/games/play/royale-ace/spin` | User | Execute slot spin with cascading symbols |
| `POST` | `/games/play/royale-plinko/drop` | User | Execute Plinko ball drop simulation |
| `POST` | `/games/play/royale-mines/reveal` | User | Reveal tile in mines game |
| `POST` | `/casino/callbacks/bigbang` | Partner (Signed) | Process BigBang wallet balance / debit / credit |

---

## 6. Dashboard Aggregation API (Targeted)

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---|:---|
| `GET` | `/dashboard/overview` | User | Unified high-performance endpoint returning profile, wallet balances (USD/BTC equiv, available/frozen), PnL, active trading positions, open orders, active bets, casino stats, rewards, and referral summary |
