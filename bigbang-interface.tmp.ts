/** BigBang API and callback contracts. Unknown provider fields stay opaque. */
export interface BigBangRemoteGame {
  game_id: number;
  provider_id: number;
  game_type: 'slot' | 'live' | 'crash' | string;
  game_name: string;
  standard_available?: boolean;
  premium_available?: boolean;
}

export interface BigBangGamesResponse {
  data?: BigBangRemoteGame[];
  total?: number;
  page?: number;
  per_page?: number;
  last_page?: number;
}

export interface BigBangLaunchRequest {
  game_id: number;
  user_token?: string;
  demo?: boolean;
  language?: string;
}

export interface BigBangLaunchResponse {
  game_url?: string;
}

export interface BigBangCreatePlayerRequest {
  username: string;
  currency: string;
}

export interface BigBangUserDataCallbackResponse {
  username: string;
  balance: string;
  currency: string;
}

export interface BigBangBalanceChangeCallbackRequest {
  username: string;
  amount: number | string;
  game: string;
  game_category: string;
  transaction_id: string;
  round_id?: string;
  round_type?: string;
  round_end?: boolean | string;
  currency: string;
  hmac?: string;
}

export interface BigBangBalanceChangeCallbackResponse {
  status: 'ok';
  balance: string;
  currency: string;
  transaction_id: string;
}

export interface BigBangHealthResult {
  reachable: boolean;
  latencyMs: number | null;
  environment: string;
  message: string | null;
}


