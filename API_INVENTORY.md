# TANVIONROYALE — API INVENTORY
**Phase:** Phase 3: Core Application Development  
**Base URL:** `/api/v1`  
**Authentication Scheme:** Bearer JWT Header (`Authorization: Bearer <token>`)  

---

## 1. Executive Dashboard API

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/dashboard/overview` | Unified multi-domain overview (Profile, Wallet, Trading, Referral, Activity) | Authenticated User |
| `GET` | `/api/v1/profile/activity` | Paginated chronological user activity feed with type and date filtering | Authenticated User |

---

## 2. User & Authentication API

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Identifier + password login returning JWT access and refresh tokens | Public |
| `POST` | `/api/v1/auth/register` | New user registration with optional referral code binding | Public |
| `GET` | `/api/v1/users/me` | Fetch authenticated user profile data | Authenticated User |
| `PATCH` | `/api/v1/users/profile` | Update profile information (username, firstName, lastName, phone, country) | Authenticated User |
| `POST` | `/api/v1/users/change-password` | Update account password with old password verification | Authenticated User |

---

## 3. Main Wallet, Deposit & Withdrawal API

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/wallet` | Fetch primary wallet balances and active currency | Authenticated User |
| `GET` | `/api/v1/wallet/balance` | Fetch balances for specific currency (`?currency=BDT\|USD\|EUR`) | Authenticated User |
| `GET` | `/api/v1/wallet/transactions` | List filtered transaction ledger history (status, type, search, pagination) | Authenticated User |
| `GET` | `/api/v1/wallet/deposit/methods` | List available deposit payment methods and gateway configurations | Authenticated User |
| `POST` | `/api/v1/wallet/manual-deposits` | Submit manual deposit proof and transaction reference | Authenticated User |
| `GET` | `/api/v1/wallet/manual-deposits` | Fetch user's submitted deposit request history | Authenticated User |
| `POST` | `/api/v1/wallet/manual-withdrawals` | Submit withdrawal request with fund reservation | Authenticated User |
| `GET` | `/api/v1/wallet/manual-withdrawals` | Fetch user's submitted withdrawal request history | Authenticated User |

---

## 4. Trading & Exchange API

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/v1/trading/instruments` | Catalog of all tradable instruments with current prices and metadata | Public / Authenticated |
| `GET` | `/api/v1/trading/portfolio` | User trading portfolio, virtual balance, margin utilization, and P&L | Authenticated User |
| `GET` | `/api/v1/trading/positions` | List open margin positions | Authenticated User |
| `GET` | `/api/v1/trading/orders` | List open and historical orders | Authenticated User |
| `POST` | `/api/v1/trading/orders` | Submit new market or pending order | Authenticated User |
| `POST` | `/api/v1/trading/faucet` | Claim virtual demo trading funds | Authenticated User |

---

## 5. Administrative API (Role Protected: `ADMIN`)

| Method | Endpoint | Description | Required Role |
|---|---|---|---|
| `GET` | `/api/v1/admin/wallet/summary` | Platform-wide financial balances, liabilities, and volume | `ADMIN` |
| `GET` | `/api/v1/admin/manual-deposits` | List all pending user manual deposits | `ADMIN` |
| `POST` | `/api/v1/admin/manual-deposits/:id/approve` | Approve deposit and credit user wallet atomically | `ADMIN` |
| `POST` | `/api/v1/admin/manual-deposits/:id/reject` | Reject deposit with documented reason | `ADMIN` |
| `GET` | `/api/v1/admin/manual-withdrawals` | List all pending user manual withdrawals | `ADMIN` |
| `POST` | `/api/v1/admin/manual-withdrawals/:id/approve` | Approve withdrawal and mark completed | `ADMIN` |
| `POST` | `/api/v1/admin/manual-withdrawals/:id/reject` | Reject withdrawal and release locked balance | `ADMIN` |
| `GET` | `/api/v1/admin/payment-methods` | List and configure payment methods and limits | `ADMIN` |
| `PUT` | `/api/v1/admin/payment-methods/:id` | Update payment method status and limits | `ADMIN` |
