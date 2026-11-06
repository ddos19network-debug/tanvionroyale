import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@Injectable()
@WebSocketGateway({ namespace: '/trading', cors: true })
export class TradingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TradingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(): void {
    this.logger.log('Trading WebSocket gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token ?? client.handshake.headers?.authorization;
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwtService.verifyAsync(token) as Promise<{ sub: string }>;
      const user = await payload;
      client.data.userId = user.sub;
      this.logger.log(`Client connected: ${client.id} (user: ${user.sub})`);
      client.join(`user:${user.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Emit a price update to all connected clients. */
  broadcastPriceUpdate(instrumentId: string, price: number, asOf: string): void {
    this.server.emit('price:update', { instrumentId, price, asOf });
  }

  /** Emit a user-specific portfolio update. */
  emitPortfolioUpdate(userId: string, portfolio: unknown): void {
    this.server.to(`user:${userId}`).emit('portfolio:update', portfolio);
  }

  /** Emit an order fill notification. */
  emitOrderFill(userId: string, order: unknown): void {
    this.server.to(`user:${userId}`).emit('order:fill', order);
  }

  @SubscribeMessage('subscribe:instrument')
  handleSubscribeInstrument(client: Socket, instrumentId: string): void {
    client.join(`instrument:${instrumentId}`);
    this.logger.debug(`Client ${client.id} subscribed to instrument ${instrumentId}`);
  }

  @SubscribeMessage('unsubscribe:instrument')
  handleUnsubscribeInstrument(client: Socket, instrumentId: string): void {
    client.leave(`instrument:${instrumentId}`);
    this.logger.debug(`Client ${client.id} unsubscribed from instrument ${instrumentId}`);
  }
}
