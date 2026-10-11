import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { getFreePlayEngine, getFreePlayGameMeta, listFreePlayGameMeta } from './game-engines/registry';
import { PlayerActionError } from './game-engines/engine-errors';
import { stripEngineState } from './game-engines/engine-state';
import type { FreePlayActionResult, FreePlayRoundResult, FreePlayState, PublicFreePlayGame } from './game-engines/free-play-engine.interface';
import type { GameActionDto, StartGameSessionDto } from './dto/game-session.dto';

export interface GameSessionView {
  id: string;
  gameSlug: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  state: Record<string, unknown>;
  endedAt: string | null;
  createdAt: string;
}

export interface SessionActionResult {
  session: GameSessionView;
  finished: boolean;
  result: FreePlayRoundResult | null;
}

export interface GameResultView {
  id: string;
  gameSlug: string;
  score: number;
  outcome: string;
  message: string | null;
  createdAt: string;
}

/**
 * Free-play games service.
 *
 * Internally developed games run a REAL, server-authoritative engine:
 * state persists in GameSession.state (JSONB), scoring produces GameResult
 * rows, and the engine is the only place state may change. FREE-PLAY ONLY —
 * no money, no wallet, no odds. Real-money betting stays strictly behind
 * BettingModule's licensed-operator gate.
 */
@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  listGames(): PublicFreePlayGame[] {
    return listFreePlayGameMeta();
  }

  getGameMeta(slug: string): PublicFreePlayGame {
    const meta = getFreePlayGameMeta(slug);
    if (!meta) throw new NotFoundException('Free-play game not found');
    return meta;
  }
// --------------------------------------------------------------------------
  // Sessions
  // --------------------------------------------------------------------------

  async startSession(
    userId: string,
    slug: string,
    dto: StartGameSessionDto,
  ): Promise<GameSessionView> {
    const engine = getFreePlayEngine(slug);
    if (!engine) throw new NotFoundException('Free-play game not found');

    const payload: Record<string, unknown> = { ...(dto.payload ?? {}) };
    if (dto.target) payload.target = dto.target;

    const state = engine.createInitialState(payload);
    const row = await this.prisma.gameSession.create({
      data: {
        userId,
        gameSlug: slug,
        status: 'ACTIVE',
        state: state as Prisma.InputJsonValue,
      },
    });
    return this.toSessionView(row, engine.snapshot(state));
  }

  async getActiveSession(userId: string, slug: string): Promise<GameSessionView | null> {
    const engine = getFreePlayEngine(slug);
    if (!engine) throw new NotFoundException('Free-play game not found');
    const row = await this.prisma.gameSession.findFirst({
      where: { userId, gameSlug: slug, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.toSessionView(row, engine.snapshot(row.state as unknown as FreePlayState));
  }

  async getSession(userId: string, slug: string, sessionId: string): Promise<GameSessionView> {
    const engine = getFreePlayEngine(slug);
    if (!engine) throw new NotFoundException('Free-play game not found');
    const row = await this.prisma.gameSession.findFirst({
      where: { id: sessionId, userId, gameSlug: slug },
    });
    if (!row) throw new NotFoundException('Session not found');
    return this.toSessionView(row, engine.snapshot(row.state as unknown as FreePlayState));
  }

  // --------------------------------------------------------------------------
  // Engine actions
  // --------------------------------------------------------------------------

  async takeAction(
    userId: string,
    slug: string,
    sessionId: string,
    dto: GameActionDto,
  ): Promise<SessionActionResult> {
    const engine = getFreePlayEngine(slug);
    if (!engine) throw new NotFoundException('Free-play game not found');

    const applied = await this.prisma.$transaction(async (db) => {
      const row = await db.gameSession.findUnique({ where: { id: sessionId } });
      if (!row || row.userId !== userId || row.gameSlug !== slug) {
        throw new NotFoundException('Session not found');
      }
      if (row.status !== 'ACTIVE') {
        throw new ConflictException('Session is already finished');
      }

      let next: FreePlayActionResult;
      try {
        next = engine.applyAction(
          row.state as unknown as FreePlayState,
          { type: dto.type, payload: dto.payload },
          Date.now(),
        );
      } catch (error) {
        if (error instanceof PlayerActionError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }

      const stateJson = stripEngineState(next.state) as Prisma.InputJsonValue;
      if (next.finished) {
        await db.gameSession.updateMany({
          where: { id: row.id, status: 'ACTIVE' },
          data: { status: 'COMPLETED', endedAt: new Date(), state: stateJson },
        });
        await db.gameResult.create({
          data: {
            userId,
            gameSlug: slug,
            score: next.result?.score ?? 0,
            outcome: next.result?.outcome ?? 'LOSS',
            meta: {
              message: next.result?.message ?? 'Round finished',
            } as Prisma.InputJsonValue,
          },
        });
      } else {
        await db.gameSession.update({ where: { id: row.id }, data: { state: stateJson } });
      }
      return next;
    });

    const session = await this.getSession(userId, slug, sessionId);
    return { session, finished: applied.finished, result: applied.result ?? null };
  }

  async listResults(userId: string, slug: string): Promise<GameResultView[]> {
    const engine = getFreePlayEngine(slug);
    if (!engine) throw new NotFoundException('Free-play game not found');
    const rows = await this.prisma.gameResult.findMany({
      where: { userId, gameSlug: slug },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => {
      const meta = (row.meta as { message?: string } | null) ?? null;
      return {
        id: row.id,
        gameSlug: row.gameSlug,
        score: row.score,
        outcome: row.outcome,
        message: meta?.message ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private toSessionView(
    row: {
      id: string;
      gameSlug: string;
      status: string;
      startedAt: Date;
      endedAt: Date | null;
      createdAt: Date;
    },
    state: Record<string, unknown>,
  ): GameSessionView {
    return {
      id: row.id,
      gameSlug: row.gameSlug,
      status: row.status as GameSessionView['status'],
      state,
      endedAt: row.endedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}