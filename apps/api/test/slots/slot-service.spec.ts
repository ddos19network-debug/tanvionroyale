import { Test, TestingModule } from '@nestjs/testing';
import { SlotService, slotStakeKey, slotPayoutKey } from '../../src/modules/games/slots/slot.service';
import { PrismaService } from '../../src/database/prisma.service';
import { CrashFreePlayWalletService } from '../../src/modules/crash/crash-freeplay-wallet.service';
import { BadRequestException } from '@nestjs/common';

describe('SlotService Unit & Mock Integration', () => {
  let service: SlotService;
  let mockPrisma: any;
  let mockWallet: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(async (cb: (db: any) => Promise<any>) => {
        const mockDb = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          freePlaySlotRound: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(({ data }: any) => ({
              id: 'test-round-uuid',
              ...data,
              createdAt: new Date(),
            })),
          },
          crashFreePlayWallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 9900 }),
          },
          gameResult: {
            create: jest.fn().mockResolvedValue({ id: 'res-id' }),
          },
        };
        return cb(mockDb);
      }),
      freePlaySlotRound: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockWallet = {
      getBalance: jest.fn().mockResolvedValue(10000),
      getOrCreateWalletInTx: jest.fn().mockResolvedValue({ id: 'w1', balance: 10000 }),
      debitInTx: jest.fn().mockResolvedValue({ id: 'tx-debit', balanceAfter: 9900 }),
      creditInTx: jest.fn().mockResolvedValue({ id: 'tx-credit', balanceAfter: 10500 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CrashFreePlayWalletService, useValue: mockWallet },
      ],
    }).compile();

    service = module.get<SlotService>(SlotService);
  });

  describe('getConfig', () => {
    it('returns public view without leaking internal strips or RNG secrets', () => {
      const cfg = service.getConfig('royale-pharaoh');
      expect(cfg.gameSlug).toBe('royale-pharaoh');
      expect(cfg.reels).toBe(5);
      expect(cfg.rows).toBe(4);
      expect(cfg.paytable).toBeDefined();
      expect(cfg.stakeLevels).toContain(100);
      // Ensure internal strips are NOT exposed on public view
      expect((cfg as any).strips).toBeUndefined();
    });

    it('throws NotFoundException for unknown slug', () => {
      expect(() => service.getConfig('unknown-game')).toThrow();
    });
  });

  describe('spin validation', () => {
    it('rejects invalid stakes not in stakeLevels', async () => {
      await expect(
        service.spin('u1', 'royale-pharaoh', {
          stake: 999, // invalid level
          clientRequestId: 'req-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects missing clientRequestId', async () => {
      await expect(
        service.spin('u1', 'royale-pharaoh', {
          stake: 100,
          clientRequestId: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('spin execution & idempotency', () => {
    it('executes atomic debit and round derivation in single transaction', async () => {
      const res = await service.spin('u1', 'royale-pharaoh', {
        stake: 100,
        clientRequestId: 'req-unique-1',
      });

      expect(res.roundId).toBe('test-round-uuid');
      expect(res.stake).toBe(100);
      expect(res.baseGrid).toBeDefined();
      expect(res.baseGrid.length).toBe(4);
      expect(res.baseGrid[0].length).toBe(5);
      expect(mockWallet.debitInTx).toHaveBeenCalledTimes(1);
    });

    it('returns existing round when same clientRequestId is passed', async () => {
      const existingRound = {
        id: 'existing-uuid',
        gameSlug: 'royale-pharaoh',
        stake: 100,
        totalPayBp: 1500,
        payout: 15,
        capped: false,
        outcome: {
          baseGrid: [['ankh']],
          steps: [],
          freeSpins: { triggered: false, awarded: 0, retriggers: 0, spins: [], totalPayBp: 0 },
        },
      };

      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const mockDb = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          freePlaySlotRound: {
            findUnique: jest.fn().mockResolvedValue(existingRound),
          },
        };
        return cb(mockDb);
      });

      const res = await service.spin('u1', 'royale-pharaoh', {
        stake: 100,
        clientRequestId: 'duplicate-req-id',
      });

      expect(res.roundId).toBe('existing-uuid');
      expect(res.payout).toBe(15);
      // No debit or credit should be called for duplicate
      expect(mockWallet.debitInTx).not.toHaveBeenCalled();
    });
  });
});
