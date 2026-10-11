/**
 * WebSocket fan-out for the Sky Rocket crash game.
 *
 * Namespace: /games/crash
 * Events broadcast (server-authoritative, no secrets):
 *   ROUND_CREATED, BETTING_OPEN, BETTING_CLOSED, ROUND_STARTED,
 *   MULTIPLIER_UPDATE, PLAYER_BET_UPDATE, PLAYER_CASHOUT,
 *   ROUND_CRASHED, ROUND_SETTLED
 *
 * The connection REQUIRES a valid JWT (handshake.auth.token or the
 * Authorization header). The server clock is authoritative — clients use
 * serverTime to compute clock offsets, never their own timers.
 */

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { CrashEventBus, CRASH_ROOM } from './crash-events';

interface CrashSocketData {
  userId: string | null;
  email: string | null;
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

  constructor(
    private readonly events: CrashEventBus,
    private readonly jwt: JwtService,
  ) {}

  afterInit(): void {
    // Single subscription: every engine event fans out to all connected
    // clients of this namespace. No secrets (server seed, encrypted seed,
    // wallet balances) are ever included in engine payloads.
    this.subscription = this.events.subscribe(CRASH_ROOM, (event) => {
      try {
        this.server.emit(event.type, event.payload);
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
      // Anonymous sockets may not join the live game feed.
      client.emit('ERROR', { code: 'UNAUTHORIZED', message: 'Authentication required' });
      client.disconnect(true);
      return;
    }
    (client.data as CrashSocketData) = {
      userId: verified.sub,
      email: verified.email ?? null,
    };
    // The client synchronizes itself via GET /games/crash/current — the
    // snapshot is the resume mechanism (no client-side event invention).
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as CrashSocketData | undefined;
    if (data?.userId) {
      this.logger.debug(`Crash WS disconnected: user=${data.userId}`);
    }
  }

  handleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
