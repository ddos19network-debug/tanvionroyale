import { EventEmitter } from 'events';
import { Injectable, Logger } from '@nestjs/common';
import {
  generateWinningOutcome,
  calculateUserPayout,
  getNumberColor,
} from './roulette-math';
import {
  BetItem,
  PlaceBetPayload,
  RoundResultBroadcast,
  RouletteState,
  StateBroadcast,
  UserBetSummary,
  WheelSpinBroadcast,
} from './roulette.types';

@Injectable()
export class RouletteRoundEngine extends EventEmitter {
  private readonly logger = new Logger(RouletteRoundEngine.name);

  private currentState: RouletteState = 'BETTING_OPEN';
  private timerRemaining = 15;
  private timerInterval: NodeJS.Timeout | null = null;
  private roundCount = 0;
  private roundId = '';
  private winningNumber: number | null = null;
  private pocketIndex: number | null = null;
  private targetAngle: number | null = null;

  // Recent history (last 15 winning numbers)
  private history: number[] = [32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30];

  // In-memory bets for the current active round: userId -> BetItem[]
  private currentBets: Map<string, BetItem[]> = new Map();

  constructor() {
    super();
    this.startNewRound();
  }

  public getCurrentState(): RouletteState {
    return this.currentState;
  }

  public getTimerRemaining(): number {
    return this.timerRemaining;
  }

  public getHistory(): number[] {
    return [...this.history];
  }

  public getRoundId(): string {
    return this.roundId;
  }

  public getWinningNumber(): number | null {
    return this.winningNumber;
  }

  public getStatePayload(): StateBroadcast {
    return {
      currentState: this.currentState,
      timerRemaining: this.timerRemaining,
      winningNumber: this.winningNumber,
      history: this.history.slice(0, 15),
      roundId: this.roundId,
      serverTime: Date.now(),
    };
  }

  /**
   * Places bet from a player. Only accepted when state is BETTING_OPEN.
   */
  public placeBet(payload: PlaceBetPayload): { success: boolean; error?: string; totalBet?: number } {
    if (this.currentState !== 'BETTING_OPEN') {
      return { success: false, error: 'Betting is currently closed.' };
    }

    if (!payload.userId || !Array.isArray(payload.bets) || payload.bets.length === 0) {
      return { success: false, error: 'Invalid bet payload.' };
    }

    const sanitizedBets: BetItem[] = [];
    let totalBet = 0;

    for (const b of payload.bets) {
      const amount = Number(b.amount);
      if (Number.isFinite(amount) && amount > 0) {
        sanitizedBets.push({
          type: String(b.type),
          selection: String(b.selection),
          amount,
        });
        totalBet += amount;
      }
    }

    if (sanitizedBets.length === 0) {
      return { success: false, error: 'No valid bets found.' };
    }

    const existing = this.currentBets.get(payload.userId) || [];
    this.currentBets.set(payload.userId, [...existing, ...sanitizedBets]);

    this.logger.log(
      `User ${payload.userId} placed ${sanitizedBets.length} bet(s) totaling ${totalBet}. Round: ${this.roundId}`,
    );

    return { success: true, totalBet };
  }

  /**
   * Transition to next round (STATE_BETTING_OPEN: 15s)
   */
  private startNewRound(): void {
    this.roundCount++;
    this.roundId = `RT-${Date.now()}-${this.roundCount}`;
    this.currentState = 'BETTING_OPEN';
    this.timerRemaining = 15;
    this.winningNumber = null;
    this.pocketIndex = null;
    this.targetAngle = null;
    this.currentBets.clear();

    this.logger.log(`[Roulette] STATE_BETTING_OPEN (15s) - Round ${this.roundId}`);
    this.emitStateUpdate();

    this.runTimer(() => {
      this.closeBetting();
    });
  }

  /**
   * Transition to STATE_BETS_CLOSED (2s countdown alert)
   */
  private closeBetting(): void {
    this.currentState = 'BETS_CLOSED';
    this.timerRemaining = 2;
    this.logger.log(`[Roulette] STATE_BETS_CLOSED (2s) - Round ${this.roundId}`);
    this.emitStateUpdate();

    this.runTimer(() => {
      this.spinWheel();
    });
  }

  /**
   * Transition to STATE_SPINNING (8s)
   */
  private spinWheel(): void {
    this.currentState = 'SPINNING';
    this.timerRemaining = 8;

    // Secure server-side CSPRNG winning outcome
    const outcome = generateWinningOutcome();
    this.winningNumber = outcome.winningNumber;
    this.pocketIndex = outcome.pocketIndex;
    this.targetAngle = outcome.targetAngle;

    this.logger.log(
      `[Roulette] STATE_SPINNING (8s) - Winning Number: ${outcome.winningNumber} (pocket: ${outcome.pocketIndex}, angle: ${outcome.targetAngle}deg)`,
    );

    const spinPayload: WheelSpinBroadcast = {
      roundId: this.roundId,
      winningNumber: outcome.winningNumber,
      pocketIndex: outcome.pocketIndex,
      targetAngle: outcome.targetAngle,
      spinDurationMs: 8000,
    };

    this.emit('WHEEL_SPIN', spinPayload);
    this.emitStateUpdate();

    this.runTimer(() => {
      this.payoutRound();
    });
  }

  /**
   * Transition to STATE_PAYOUT (5s)
   */
  private payoutRound(): void {
    this.currentState = 'PAYOUT';
    this.timerRemaining = 5;

    const winningNum = this.winningNumber ?? 0;
    const color = getNumberColor(winningNum);

    // Update history
    this.history.unshift(winningNum);
    if (this.history.length > 20) {
      this.history.pop();
    }

    // Compute payouts for all players
    const userPayouts: Record<string, UserBetSummary> = {};
    for (const [userId, bets] of this.currentBets.entries()) {
      userPayouts[userId] = calculateUserPayout(userId, bets, winningNum);
    }

    this.logger.log(
      `[Roulette] STATE_PAYOUT (5s) - Settled ${Object.keys(userPayouts).length} players for round ${this.roundId}`,
    );

    const resultPayload: RoundResultBroadcast = {
      roundId: this.roundId,
      winningNumber: winningNum,
      color,
      history: this.history.slice(0, 15),
      userPayouts,
    };

    this.emit('ROUND_RESULT', resultPayload);
    this.emitStateUpdate();

    this.runTimer(() => {
      this.startNewRound();
    });
  }

  private runTimer(onComplete: () => void): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      this.emit('TICK', this.getStatePayload());

      if (this.timerRemaining <= 0) {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        onComplete();
      }
    }, 1000);
  }

  private emitStateUpdate(): void {
    this.emit('STATE_CHANGE', this.getStatePayload());
  }

  public cleanup(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.removeAllListeners();
  }
}

