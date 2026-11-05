import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RouletteRoundEngine } from './roulette-round-engine';
import {
  PlaceBetPayload,
  RoundResultBroadcast,
  StateBroadcast,
  WheelSpinBroadcast,
} from './roulette.types';

@WebSocketGateway({
  namespace: '/games/roulette',
  cors: { origin: true, credentials: true },
})
export class RouletteGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RouletteGateway.name);

  constructor(private readonly engine: RouletteRoundEngine) {
    this.setupEngineSubscriptions();
  }

  private setupEngineSubscriptions(): void {
    this.engine.on('STATE_CHANGE', (payload: StateBroadcast) => {
      this.server?.emit('STATE_UPDATE', payload);
      this.server?.emit('GAME_STATE_UPDATE', payload);
    });

    this.engine.on('TICK', (payload: StateBroadcast) => {
      this.server?.emit('STATE_UPDATE', payload);
      this.server?.emit('GAME_STATE_UPDATE', payload);
    });

    this.engine.on('WHEEL_SPIN', (payload: WheelSpinBroadcast) => {
      this.server?.emit('WHEEL_SPIN', {
        ...payload,
        duration: Math.round((payload.spinDurationMs || 8000) / 1000),
      });
    });

    this.engine.on('ROUND_RESULT', (payload: RoundResultBroadcast) => {
      this.server?.emit('ROUND_RESULT', payload);
    });
  }

  handleConnection(client: Socket): void {
    this.logger.log(`[RouletteGateway] Client connected: ${client.id}`);
    // Send current game state immediately to newly connected client
    const state = this.engine.getStatePayload();
    client.emit('STATE_UPDATE', state);
    client.emit('GAME_STATE_UPDATE', state);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[RouletteGateway] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('PLACE_BET')
  handlePlaceBet(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: PlaceBetPayload,
  ): void {
    try {
      const result = this.engine.placeBet(payload);
      if (result.success) {
        const resp = {
          success: true,
          roundId: this.engine.getRoundId(),
          totalBet: result.totalBet,
          bets: payload.bets,
          message: 'Bet placed successfully!',
        };
        client.emit('BET_CONFIRMED', resp);
        client.emit('BET_RESPONSE', resp);
      } else {
        const errResp = {
          success: false,
          error: result.error || 'Failed to place bet',
          message: result.error || 'Betting is currently closed!',
        };
        client.emit('BET_ERROR', errResp);
        client.emit('BET_RESPONSE', errResp);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown bet placement error';
      this.logger.error(`Error handling PLACE_BET: ${errorMsg}`);
      const errResp = { success: false, error: errorMsg, message: errorMsg };
      client.emit('BET_ERROR', errResp);
      client.emit('BET_RESPONSE', errResp);
    }
  }

  @SubscribeMessage('GET_STATE')
  handleGetState(@ConnectedSocket() client: Socket): void {
    client.emit('STATE_UPDATE', this.engine.getStatePayload());
  }
}

