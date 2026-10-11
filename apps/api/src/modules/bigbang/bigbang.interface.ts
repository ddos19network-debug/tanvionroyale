/** BigBang API and callback contracts. Unknown provider fields stay opaque. */
export interface BigBangRemoteGame {
  /** Numeric game id used by /games/launch and reported by balance_change. */
  id: number;
  /** Launch slug returned by the catalog. Do not display this as the title. */
  name: string;
  /** Human-readable title returned by the catalog. */
  title?: string;
  /** Provider slug (not a numeric provider id). */
  provider?: string;
  category?: string;
  category_title?: string;
  thumbnail?: string | null;
  mode?: 'standard' | 'premium' | string;
  is_premium?: boolean;
  game_type?: 'slot' | 'live' | 'crash' | string;
  is_demo?: boolean;
  /** Compatibility aliases accepted from older catalog responses. */
  game_id?: number;
  game_name?: string;
  provider_id?: string | number;
  standard_available?: boolean;
  premium_available?: boolean;
}

export interface BigBangPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface BigBangGamesResponse {
  success?: boolean;
  data?: BigBangRemoteGame[];
  pagination?: BigBangPagination;
  error?: { code?: number | string; message?: string };
}

export interface BigBangCategoriesResponse {
  success?: boolean;
  data?: Array<{ id?: number | string; name?: string; slug?: string; premium?: boolean }>;
  error?: { code?: number | string; message?: string };
}

export interface BigBangLaunchRequest {
  game_id: number;
  user_token?: string;
  demo?: boolean;
  language?: string;
}

export interface BigBangLaunchResponse {
  success?: boolean;
  game_url?: string;
  session_id?: string;
  game_id?: number;
  game_name?: string;
  provider?: string;
  demo?: boolean;
  error?: { code?: number | string; message?: string };
}

export interface BigBangCreatePlayerRequest {
  user_token: string;
  username?: string;
  country?: string;
}

export interface BigBangUserDataCallbackResponse {
  username: string;
  balance: string;
  currency: string;
}

export interface BigBangBalanceChangeCallbackRequest {
  username: string;
  /** The documented callback value is a JSON number; string is tolerated for compatibility. */
  amount: number | string;
  game: string;
  game_category: string;
  transaction_id: string;
  signature: string;
  round_id?: string;
  /** BigBang calls this field `type`; `round_type` is accepted as a legacy alias. */
  type?: string;
  round_type?: string;
  round_end?: boolean | string;
  currency?: string;
  game_id?: number | string;
  provider_id?: string | number;
  sandbox?: boolean | string;
}

export interface BigBangBalanceChangeCallbackResponse {
  status: 'ok';
  balance: string;
  /** Present on an idempotent retry, as permitted by the provider contract. */
  duplicate?: boolean;
}

export interface BigBangHealthResult {
  reachable: boolean;
  latencyMs: number | null;
  environment: string;
  message: string | null;
}

