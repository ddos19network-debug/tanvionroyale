/**
 * WebSocket fan-out for the Sky Rocket crash game.
 *
 * Namespace: /games/crash
 * Events broadcast (server-authoritative, no secrets):
 *   ROUND_CREATED, BETTING_OPEN, BETTING_CLOSED, ROUND_STARTED,
 *   MULTIPLIER_UPDATE, PLAYER_BET_UPDATE, PLAYER_CASHOUT,
 *   ROUND_CRASHED, ROUND_SETTLED,
 *   crash:countdown, crash:state, crash:tick, crash:crashed, crash:cashout-success
 *
 * The connection REQUIRES a valid JWT (handshake.auth.token or the
 * Authorization header). The server clock is authoritative — clients use
 * serverTime to compute clock offsets, never their own timers.
 */

import { Logger, forwardRef, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { CrashEventBus, CRASH_ROOM } from './crash-events';
import { CrashRoundEngine } from './crash-round-engine';
import { CrashService } from './crash.service';

interface CrashSocketData {
  userId: string | null;
  email: string | null;
  user?: { id: string; email?: string | null };
}

@WebSocketGateway({
  namespace: '/games/crash',
  cors: { origin: true, credentials: true },
})
export class CrashGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CrashGateway.name);
  private subscription: Subscription | null = null;
  private readonly userPanelBets = new Map<string, string>();

  constructor(
    private readonly events: CrashEventBus,
    private readonly jwt: JwtService,
    private readonly engine: CrashRoundEngine,
    @Inject(forwardRef(() => CrashService))
    private readonly crashService: CrashService,
  ) {}

  afterInit(server?: Server): void {
    if (server) {
      this.server = server;
    }
    this.engine.setServer(this.server);

    // Single subscription: every engine event fans out to all connected
    // clients of this namespace. No secrets are ever included in engine payloads.
    this.subscription = this.events.subscribe(CRASH_ROOM, (event) => {
      try {
        // Standard uppercase fan-out
        this.server.emit(event.type, event.payload);

        // Unified crash:* events for twin-panel Aviator clients
        const payload = (event.payload ?? {}) as Record<string, unknown>;

        if (event.type === 'BETTING_OPEN') {
          const closeAt =
            typeof payload.bettingCloseAt === 'number'
              ? payload.bettingCloseAt
              : Date.now() + 5000;
          const timeLeft = Math.max(0, (closeAt - Date.now()) / 1000);
          this.server.emit('crash:countdown', { timeLeft: timeLeft > 0 ? timeLeft : 5.0 });
          this.server.emit('crash:state', { state: 'WAITING', multiplier: 1.0 });
        } else if (event.type === 'ROUND_STARTED') {
          this.server.emit('crash:state', { state: 'FLYING', multiplier: 1.0 });
        } else if (event.type === 'MULTIPLIER_UPDATE') {
          const mult = typeof payload.multiplier === 'number' ? payload.multiplier : 1.0;
          this.server.emit('crash:tick', { multiplier: mult, state: 'FLYING' });
          this.server.emit('crash:state', { state: 'FLYING', multiplier: mult });
        } else if (event.type === 'ROUND_CRASHED') {
          const crashPoint = typeof payload.crashMultiplier === 'number' ? payload.crashMultiplier : 1.0;
          this.server.emit('crash:crashed', { crashPoint });
          this.server.emit('crash:state', { state: 'CRASHED', multiplier: crashPoint });
          // Clear per-round panel bet mappings
          this.userPanelBets.clear();
        }
      } catch (error) {
        this.logger.error(
          `Crash WS fan-out failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    let verified: { sub?: string; email?: string } | null = null;
    try {
      const header = client.handshake.headers.authorization;
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined);
      if (token) {
        verified = await this.jwt.verifyAsync(token);
      }
    } catch {
      verified = null;
    }
    if (!verified?.sub) {
      client.emit('ERROR', { code: 'UNAUTHORIZED', message: 'Authentication required' });
      client.disconnect(true);
      return;
    }
    const data: CrashSocketData = {
      userId: verified.sub,
      email: verified.email ?? null,
      user: { id: verified.sub, email: verified.email ?? null },
    };
    (client.data as CrashSocketData) = data;
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as CrashSocketData | undefined;
    if (data?.userId) {
      this.logger.debug(`Crash WS disconnected: user=${data.userId}`);
    }
  }

  @SubscribeMessage('crash:place-bet')
  @SubscribeMessage('place-bet')
  async handlePlaceBet(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      stake?: number;
      amount?: number;
      betId?: string;
      clientRequestId?: string;
      panelId?: number | string;
      autoCashout?: number;
    },
  ) {
    const userId =
      (client.data as CrashSocketData)?.userId ??
      (client.data as CrashSocketData)?.user?.id;
    if (!userId) {
      return {
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        panelId: data?.panelId,
      };
    }

    const stakeAmount = Number(data.amount ?? data.stake ?? 0);
    const reqId = data.betId ?? data.clientRequestId;

    try {
      const bet = await this.crashService.placeBet(
        { id: userId } as any,
        { stake: stakeAmount, clientRequestId: reqId },
      );

      if (data?.panelId != null) {
        this.userPanelBets.set(`${userId}:${data.panelId}`, bet.id);
      }

      return {
        status: 'success',
        code: 'OK',
        bet,
        panelId: data?.panelId,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to place bet';
      return { status: 'error', message, panelId: data?.panelId };
    }
  }

  @SubscribeMessage('crash:cashout')
  @SubscribeMessage('cashout')
  async handleCashout(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      betId?: string;
      clientRequestId?: string;
      panelId?: number | string;
    },
  ) {
    const userId =
      (client.data as CrashSocketData)?.userId ??
      (client.data as CrashSocketData)?.user?.id;
    if (!userId) {
      return {
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        panelId: data?.panelId,
      };
    }

    let betId = data?.betId;
    if (!betId && data?.panelId != null) {
      betId = this.userPanelBets.get(`${userId}:${data.panelId}`);
    }

    if (!betId) {
      const fallback = await this.crashService.findActiveBetForUser(userId);
      if (fallback) {
        betId = fallback.id;
      }
    }

    if (!betId) {
      return {
        status: 'error',
        message: 'No active bet found to cash out',
        panelId: data?.panelId,
      };
    }

    try {
      const bet = await this.crashService.cashOut(
        { id: userId } as any,
        betId,
        { clientRequestId: data.clientRequestId },
      );

      this.server.emit('crash:cashout-success', {
        userId,
        panelId: data?.panelId,
        betId: bet.id,
        payout: bet.payout,
        cashoutMultiplier: bet.cashoutMultiplier,
      });

      return {
        status: 'success',
        code: 'OK',
        bet,
        panelId: data?.panelId,
        payout: bet.payout,
        multiplier: bet.cashoutMultiplier,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cash out';
      return { status: 'error', message, panelId: data?.panelId };
    }
  }

  handleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
