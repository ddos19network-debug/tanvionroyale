import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type {
  P2PQuoteView,
  P2POrderView,
  P2POfferView,
  P2POffersView,
  RoyalePayBalanceView,
  P2PMerchantProfileView,
  P2PPaymentView,
  P2PDisputeView,
  P2POrderSummaryView,
  P2PSymbol,
  P2PFiat,
  P2POrderSide,
  P2POrderStatus,
} from '@tanvion-royale/types';
import {
  ListP2POffersQueryDto,
  P2PQuoteDto,
  CreateP2POrderDto,
  SubmitP2PPaymentDto,
  CancelP2POrderDto,
  ListP2POrdersQueryDto,
  AdminP2POfferDto,
  AdminVerifyP2PPaymentDto,
  AdminResolveP2PDisputeDto,
} from './dto/p2p.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a Prisma P2PMerchantProfile row (or null) to the view type. */
function mapMerchantProfile(
  profile: {
    id: string;
    userId: string;
    displayName: string;
    verificationStatus: string;
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    completionRate: { toNumber(): number } | number;
    positiveFeedback: { toNumber(): number } | number;
    avgCompletionMin: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null,
  fallbackId: string,
  fallbackCreatedAt: Date,
  fallbackUpdatedAt: Date,
): P2PMerchantProfileView {
  if (!profile) {
    return {
      id: fallbackId,
      userId: fallbackId,
      displayName: 'Merchant',
      verificationStatus: 'UNVERIFIED',
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      completionRate: 0,
      positiveFeedback: 0,
      avgCompletionMin: 0,
      isActive: false,
      createdAt: fallbackCreatedAt.toISOString(),
      updatedAt: fallbackUpdatedAt.toISOString(),
    };
  }
  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    verificationStatus: profile.verificationStatus as P2PMerchantProfileView['verificationStatus'],
    totalOrders: profile.totalOrders,
    completedOrders: profile.completedOrders,
    cancelledOrders: profile.cancelledOrders,
    completionRate:
      typeof profile.completionRate === 'object'
        ? profile.completionRate.toNumber()
        : profile.completionRate,
    positiveFeedback:
      typeof profile.positiveFeedback === 'object'
        ? profile.positiveFeedback.toNumber()
        : profile.positiveFeedback,
    avgCompletionMin: profile.avgCompletionMin,
    isActive: profile.isActive,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/** Canonical include clause for fetching a P2POffer with its merchant profile. */
const OFFER_INCLUDE = {
  merchant: {
    include: { merchantProfile: true },
  },
} as const;

/** Canonical include clause for fetching a P2POrder with all relations. */
const ORDER_INCLUDE = {
  buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
  seller: { select: { id: true, username: true, firstName: true, lastName: true } },
  offer: {
    include: {
      merchant: {
        include: { merchantProfile: true },
      },
    },
  },
  payment: true,
  dispute: true,
} as const;

/** Map a fetched P2POrder row to P2POrderView. */
function mapOrderView(order: {
  id: string;
  orderReference: string;
  buyerId: string;
  sellerId: string;
  offerId: string;
  symbol: string;
  fiat: string;
  side: string;
  pricePerFiatUnit: number;
  cryptoAmount: bigint;
  fiatAmount: number;
  feeAmount: number;
  status: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentProofUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): P2POrderView {
  return {
    id: order.id,
    orderReference: order.orderReference,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    offerId: order.offerId,
    symbol: order.symbol as P2PSymbol,
    fiat: order.fiat as P2PFiat,
    side: order.side as P2POrderSide,
    pricePerFiatUnit: order.pricePerFiatUnit,
    cryptoAmount: Number(order.cryptoAmount),
    fiatAmount: order.fiatAmount,
    feeAmount: order.feeAmount,
    status: order.status as P2POrderStatus,
    paymentMethod: (order.paymentMethod ?? null) as P2POrderView['paymentMethod'],
    paymentReference: order.paymentReference ?? null,
    paymentProofUrl: order.paymentProofUrl ?? null,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancellationReason: order.cancellationReason ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function mapPaymentView(
  payment: {
    id: string;
    orderId: string;
    payerId: string;
    payeeId: string;
    method: string;
    amount: number;
    currency: string;
    reference: string | null;
    proofUrl: string | null;
    status: string;
    verifiedBy: string | null;
    verifiedAt: Date | null;
    verificationNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
): P2PPaymentView | null {
  if (!payment) return null;
  return {
    id: payment.id,
    orderId: payment.orderId,
    payerId: payment.payerId,
    payeeId: payment.payeeId,
    method: payment.method as P2PPaymentView['method'],
    amount: payment.amount,
    currency: payment.currency,
    reference: payment.reference ?? null,
    proofUrl: payment.proofUrl ?? null,
    status: payment.status as P2PPaymentView['status'],
    verifiedBy: payment.verifiedBy ?? null,
    verifiedAt: payment.verifiedAt?.toISOString() ?? null,
    verificationNote: payment.verificationNote ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function mapDisputeView(
  dispute: {
    id: string;
    orderId: string;
    openedBy: string;
    reason: string;
    status: string;
    resolution: string | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
): P2PDisputeView | null {
  if (!dispute) return null;
  return {
    id: dispute.id,
    orderId: dispute.orderId,
    openedBy: dispute.openedBy,
    reason: dispute.reason,
    status: dispute.status as P2PDisputeView['status'],
    resolution: (dispute.resolution ?? null) as P2PDisputeView['resolution'],
    resolvedBy: dispute.resolvedBy ?? null,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    resolutionNote: dispute.resolutionNote ?? null,
    createdAt: dispute.createdAt.toISOString(),
    updatedAt: dispute.updatedAt.toISOString(),
  };
}

/** Unique idempotency key suffix generator. */
function txKey(prefix: string, orderId: string): string {
  return `${prefix}-${orderId}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class P2PService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // -------------------------------------------------------------------------
  // Customer: listOffers
  // -------------------------------------------------------------------------

  async listOffers(query: ListP2POffersQueryDto): Promise<P2POffersView> {
    const {
      symbol,
      fiat,
      side,
      paymentMethod,
      minAmount,
      maxAmount,
      sortBy = 'price',
      page = 1,
      limit = 20,
    } = query;

    const where: Record<string, unknown> = { isActive: true };

    if (symbol) where['symbol'] = symbol;
    if (fiat) where['fiat'] = fiat;
    if (side) where['side'] = side;
    if (paymentMethod) where['paymentMethods'] = { has: paymentMethod };
    if (minAmount !== undefined) {
      where['minOrderFiat'] = { ...(where['minOrderFiat'] as object), gte: minAmount };
    }
    if (maxAmount !== undefined) {
      where['maxOrderFiat'] = { ...(where['maxOrderFiat'] as object), lte: maxAmount };
    }

    const orderBy: Record<string, string> = {};
    if (sortBy === 'price') orderBy['pricePerFiatUnit'] = 'asc';
    else if (sortBy === 'available') orderBy['availableCrypto'] = 'desc';
    else orderBy['createdAt'] = 'desc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POffer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: OFFER_INCLUDE,
      }),
      this.prisma.p2POffer.count({ where }),
    ]);

    return {
      items: items.map((o): P2POfferView => ({
        id: o.id,
        merchantId: o.merchantId,
        merchant: mapMerchantProfile(
          o.merchant.merchantProfile,
          o.merchantId,
          o.createdAt,
          o.updatedAt,
        ),
        symbol: o.symbol as P2PSymbol,
        fiat: o.fiat as P2PFiat,
        side: o.side as P2POrderSide,
        pricePerFiatUnit: o.pricePerFiatUnit,
        cryptoScale: o.cryptoScale,
        availableCrypto: Number(o.availableCrypto),
        minOrderFiat: o.minOrderFiat,
        maxOrderFiat: o.maxOrderFiat,
        paymentMethods: (o.paymentMethods as string[]) as P2POfferView['paymentMethods'],
        isActive: o.isActive,
        expiresAt: o.expiresAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  // -------------------------------------------------------------------------
  // Customer: getQuote
  // -------------------------------------------------------------------------

  async getQuote(dto: P2PQuoteDto): Promise<P2PQuoteView> {
    const { symbol, fiat, side, fiatAmount } = dto;

    const offers = await this.prisma.p2POffer.findMany({
      where: { isActive: true, symbol, fiat, side },
      orderBy:
        side === 'BUY' ? { pricePerFiatUnit: 'asc' } : { pricePerFiatUnit: 'desc' },
      take: 1,
    });

    if (offers.length === 0) {
      throw new NotFoundException(
        'No active offers available for the selected criteria',
      );
    }

    const offer = offers[0];
    const cryptoScale = offer.cryptoScale ?? 8;
    const scaleFactor = Math.pow(10, cryptoScale);
    const pricePerFiatUnit = offer.pricePerFiatUnit;

    let cryptoAmount: number;
    let totalFiat: number;

    if (side === 'BUY') {
      cryptoAmount = Math.floor((fiatAmount / pricePerFiatUnit) * scaleFactor) / scaleFactor;
      totalFiat = fiatAmount;
    } else {
      const maxCrypto = Number(offer.availableCrypto);
      cryptoAmount = Math.floor(maxCrypto * scaleFactor) / scaleFactor;
      totalFiat = Math.floor(cryptoAmount * pricePerFiatUnit * 100) / 100;
    }

    const feeAmount = Math.round(totalFiat * 0.001);

    return {
      symbol: offer.symbol as P2PSymbol,
      fiat: offer.fiat as P2PFiat,
      side: offer.side as P2POrderSide,
      fiatAmount,
      cryptoAmount,
      pricePerFiatUnit,
      feeAmount,
      totalFiat: totalFiat + feeAmount,
      dataSource: 'LIVE',
      asOf: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Customer: createOrder
  // -------------------------------------------------------------------------

  async createOrder(
    auth: AuthenticatedUser,
    dto: CreateP2POrderDto,
  ): Promise<P2POrderView> {
    const {
      symbol,
      fiat,
      side,
      cryptoAmount,
      pricePerFiatUnit,
      paymentMethod,
      offerId,
      idempotencyKey,
      fiatAmount,
    } = dto;

    // 1. Idempotency: return existing order if key was already used
    const existing = await this.prisma.p2POrder.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.buyerId !== auth.id) {
        throw new ConflictException(
          'Idempotency key already used by a different user',
        );
      }
      return mapOrderView(existing);
    }

    // 2. Validate offer
    const offer = await this.prisma.p2POffer.findUnique({
      where: { id: offerId },
      include: OFFER_INCLUDE,
    });

    if (!offer) throw new NotFoundException('P2P offer not found');
    if (!offer.isActive)
      throw new BadRequestException('This offer is no longer active');
    if (offer.symbol !== symbol)
      throw new BadRequestException('Symbol does not match the offer');
    if (offer.side !== side)
      throw new BadRequestException('Side does not match the offer');
    if (offer.fiat !== fiat)
      throw new BadRequestException('Fiat does not match the offer');

    // 3. Availability check
    const availableCrypto = Number(offer.availableCrypto);
    if (cryptoAmount > availableCrypto)
      throw new BadRequestException('Insufficient crypto available in offer');

    // 4. Order limits check
    if (fiatAmount < offer.minOrderFiat)
      throw new BadRequestException(
        `Minimum fiat order amount is ${offer.minOrderFiat} minor units`,
      );
    if (fiatAmount > offer.maxOrderFiat)
      throw new BadRequestException(
        `Maximum fiat order amount is ${offer.maxOrderFiat} minor units`,
      );

    // 5. Wallet balance check (outside tx — read-only snapshot)
    const wallet = await this.walletService.getOrCreateWalletForUser(auth.id, fiat);
    if (wallet.availableBalance < fiatAmount)
      throw new BadRequestException('Insufficient wallet balance');

    // 6. Fee (0.1%, rounded)
    const feeAmount = Math.round(fiatAmount * 0.001);

    const orderReference = `TANV-P2P-${symbol}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)
      .toUpperCase()}`;

    // 7. Atomic transaction
    const newOrder = await this.prisma.$transaction(async (tx) => {
      // Reserve buyer funds
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: auth.id,
          idempotencyKey: `p2p-reserve-${idempotencyKey}`,
          type: 'ADJUSTMENT',
          status: 'PENDING',
          amount: -fiatAmount,
          currency: fiat,
          reference: `p2p-reserve-${orderReference}`,
        },
      });

      // Update wallet balances
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { decrement: fiatAmount },
          lockedBalance: { increment: fiatAmount },
        },
      });

      // Decrement offer availability (atomic; prevents overselling)
      await tx.p2POffer.update({
        where: { id: offer.id },
        data: { availableCrypto: { decrement: BigInt(cryptoAmount) } },
      });

      return tx.p2POrder.create({
        data: {
          orderReference,
          idempotencyKey,
          buyerId: auth.id,
          sellerId: offer.merchantId,
          offerId: offer.id,
          symbol,
          fiat,
          side,
          pricePerFiatUnit,
          cryptoAmount: BigInt(cryptoAmount),
          fiatAmount,
          feeAmount,
          status: 'CREATED',
          paymentMethod,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      });
    });

    return mapOrderView(newOrder);
  }

  // -------------------------------------------------------------------------
  // Customer: getOrder
  // -------------------------------------------------------------------------

  async getOrder(
    auth: AuthenticatedUser,
    id: string,
  ): Promise<P2POrderSummaryView> {
    const order = await this.prisma.p2POrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException('P2P order not found');

    if (order.buyerId !== auth.id && order.sellerId !== auth.id) {
      throw new ForbiddenException(
        'You do not have permission to view this order',
      );
    }

    return {
      order: mapOrderView(order),
      payment: mapPaymentView(order.payment),
      dispute: mapDisputeView(order.dispute),
    };
  }

  // -------------------------------------------------------------------------
  // Customer: submitPayment
  // -------------------------------------------------------------------------

  async submitPayment(
    auth: AuthenticatedUser,
    dto: SubmitP2PPaymentDto,
  ): Promise<P2POrderSummaryView> {
    const { orderId, method, reference, proofUrl } = dto;

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException('P2P order not found');
    if (order.buyerId !== auth.id)
      throw new ForbiddenException(
        'You can only submit payment for your own orders',
      );

    const validStates: P2POrderStatus[] = ['CREATED', 'PAYMENT_PENDING'];
    if (!validStates.includes(order.status as P2POrderStatus))
      throw new BadRequestException(
        `Payment cannot be submitted in current order state: ${order.status}`,
      );

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Create the payment record
      await tx.p2PPayment.create({
        data: {
          orderId,
          payerId: auth.id,
          payeeId: order.sellerId,
          method,
          amount: order.fiatAmount,
          currency: order.fiat,
          reference: reference ?? null,
          proofUrl: proofUrl ?? null,
          status: 'SUBMITTED',
        },
      });

      return tx.p2POrder.update({
        where: { id: orderId },
        data: {
          status: 'PAYMENT_SUBMITTED',
          paymentMethod: method,
          paymentReference: reference ?? null,
          paymentProofUrl: proofUrl ?? null,
          paidAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });

    return {
      order: mapOrderView(updatedOrder),
      payment: mapPaymentView(updatedOrder.payment),
      dispute: mapDisputeView(updatedOrder.dispute),
    };
  }

  // -------------------------------------------------------------------------
  // Customer: cancelOrder
  // -------------------------------------------------------------------------

  async cancelOrder(
    auth: AuthenticatedUser,
    dto: CancelP2POrderDto,
  ): Promise<P2POrderView> {
    const { orderId, reason } = dto;

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('P2P order not found');
    if (order.buyerId !== auth.id)
      throw new ForbiddenException('You can only cancel your own orders');

    const cancellableStates: P2POrderStatus[] = ['CREATED', 'PAYMENT_PENDING'];
    if (!cancellableStates.includes(order.status as P2POrderStatus))
      throw new BadRequestException(
        `Order cannot be cancelled in current state: ${order.status}`,
      );

    // Fetch wallet outside tx for id; balance validation already done on create
    const wallet = await this.walletService.getOrCreateWalletForUser(
      auth.id,
      order.fiat,
    );

    const cancelledOrder = await this.prisma.$transaction(async (tx) => {
      // Release reserved funds back to available
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: auth.id,
          idempotencyKey: txKey('p2p-cancel', orderId),
          type: 'ADJUSTMENT',
          status: 'COMPLETED',
          amount: order.fiatAmount,
          currency: order.fiat,
          reference: `p2p-cancel-${orderId}`,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { increment: order.fiatAmount },
          lockedBalance: { decrement: order.fiatAmount },
        },
      });

      // Restore crypto availability in offer
      await tx.p2POffer.update({
        where: { id: order.offerId },
        data: { availableCrypto: { increment: order.cryptoAmount } },
      });

      return tx.p2POrder.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancellationReason: reason ?? 'Cancelled by user',
          cancelledAt: new Date(),
        },
      });
    });

    return mapOrderView(cancelledOrder);
  }

  // -------------------------------------------------------------------------
  // Customer: listOrders
  // -------------------------------------------------------------------------

  async listOrders(
    auth: AuthenticatedUser,
    query: ListP2POrdersQueryDto,
  ): Promise<{ items: P2POrderView[]; total: number; page: number; limit: number }> {
    const { status, page = 1, limit = 20 } = query;

    const where: Record<string, unknown> = { buyerId: auth.id };
    if (status) where['status'] = status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.p2POrder.count({ where }),
    ]);

    return {
      items: items.map(mapOrderView),
      total,
      page,
      limit,
    };
  }

  // -------------------------------------------------------------------------
  // Customer: getRoyalePayBalance
  // -------------------------------------------------------------------------

  async getRoyalePayBalance(
    auth: AuthenticatedUser,
  ): Promise<RoyalePayBalanceView> {
    const wallet = await this.walletService.getOrCreateWalletForUser(
      auth.id,
      'BDT',
    );

    return {
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      currency: 'BDT',
      mode: 'LIVE',
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminListOffers
  // -------------------------------------------------------------------------

  async adminListOffers(): Promise<P2POffersView> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POffer.findMany({
        orderBy: { createdAt: 'desc' },
        include: OFFER_INCLUDE,
      }),
      this.prisma.p2POffer.count(),
    ]);

    return {
      items: items.map((o): P2POfferView => ({
        id: o.id,
        merchantId: o.merchantId,
        merchant: mapMerchantProfile(
          o.merchant.merchantProfile,
          o.merchantId,
          o.createdAt,
          o.updatedAt,
        ),
        symbol: o.symbol as P2PSymbol,
        fiat: o.fiat as P2PFiat,
        side: o.side as P2POrderSide,
        pricePerFiatUnit: o.pricePerFiatUnit,
        cryptoScale: o.cryptoScale,
        availableCrypto: Number(o.availableCrypto),
        minOrderFiat: o.minOrderFiat,
        maxOrderFiat: o.maxOrderFiat,
        paymentMethods: (o.paymentMethods as string[]) as P2POfferView['paymentMethods'],
        isActive: o.isActive,
        expiresAt: o.expiresAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      total,
      page: 1,
      limit: total,
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminCreateOffer
  // -------------------------------------------------------------------------

  async adminCreateOffer(dto: AdminP2POfferDto): Promise<P2POfferView> {
    const {
      merchantId,
      symbol,
      fiat,
      side,
      pricePerFiatUnit,
      availableCrypto,
      minOrderFiat,
      maxOrderFiat,
      paymentMethods,
      isActive = true,
    } = dto;

    const merchant = await this.prisma.user.findUnique({
      where: { id: merchantId },
      include: { merchantProfile: true },
    });
    if (!merchant) throw new NotFoundException('Merchant user not found');

    const offer = await this.prisma.p2POffer.create({
      data: {
        merchantId,
        symbol,
        fiat,
        side,
        pricePerFiatUnit,
        availableCrypto: BigInt(availableCrypto),
        minOrderFiat,
        maxOrderFiat,
        paymentMethods,
        isActive,
      },
      include: OFFER_INCLUDE,
    });

    return {
      id: offer.id,
      merchantId: offer.merchantId,
      merchant: mapMerchantProfile(
        offer.merchant.merchantProfile,
        offer.merchantId,
        offer.createdAt,
        offer.updatedAt,
      ),
      symbol: offer.symbol as P2PSymbol,
      fiat: offer.fiat as P2PFiat,
      side: offer.side as P2POrderSide,
      pricePerFiatUnit: offer.pricePerFiatUnit,
      cryptoScale: offer.cryptoScale,
      availableCrypto: Number(offer.availableCrypto),
      minOrderFiat: offer.minOrderFiat,
      maxOrderFiat: offer.maxOrderFiat,
      paymentMethods: (offer.paymentMethods as string[]) as P2POfferView['paymentMethods'],
      isActive: offer.isActive,
      expiresAt: offer.expiresAt?.toISOString() ?? null,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminUpdateOffer
  // -------------------------------------------------------------------------

  async adminUpdateOffer(id: string, dto: AdminP2POfferDto): Promise<P2POfferView> {
    const existing = await this.prisma.p2POffer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('P2P offer not found');

    const updated = await this.prisma.p2POffer.update({
      where: { id },
      data: {
        merchantId: dto.merchantId,
        symbol: dto.symbol,
        fiat: dto.fiat,
        side: dto.side,
        pricePerFiatUnit: dto.pricePerFiatUnit,
        availableCrypto: BigInt(dto.availableCrypto),
        minOrderFiat: dto.minOrderFiat,
        maxOrderFiat: dto.maxOrderFiat,
        paymentMethods: dto.paymentMethods,
        isActive: dto.isActive ?? existing.isActive,
      },
      include: OFFER_INCLUDE,
    });

    return {
      id: updated.id,
      merchantId: updated.merchantId,
      merchant: mapMerchantProfile(
        updated.merchant.merchantProfile,
        updated.merchantId,
        updated.createdAt,
        updated.updatedAt,
      ),
      symbol: updated.symbol as P2PSymbol,
      fiat: updated.fiat as P2PFiat,
      side: updated.side as P2POrderSide,
      pricePerFiatUnit: updated.pricePerFiatUnit,
      cryptoScale: updated.cryptoScale,
      availableCrypto: Number(updated.availableCrypto),
      minOrderFiat: updated.minOrderFiat,
      maxOrderFiat: updated.maxOrderFiat,
      paymentMethods: (updated.paymentMethods as string[]) as P2POfferView['paymentMethods'],
      isActive: updated.isActive,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminListOrders
  // -------------------------------------------------------------------------

  async adminListOrders(): Promise<{
    items: P2POrderView[];
    total: number;
  }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POrder.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.p2POrder.count(),
    ]);

    return {
      items: items.map(mapOrderView),
      total,
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminVerifyPayment
  // -------------------------------------------------------------------------

  async adminVerifyPayment(
    auth: AuthenticatedUser,
    dto: AdminVerifyP2PPaymentDto,
  ): Promise<P2POrderSummaryView> {
    const { orderId, status, verificationNote } = dto;

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException('P2P order not found');
    if (order.status !== 'PAYMENT_SUBMITTED')
      throw new BadRequestException(
        `Cannot verify payment in current order state: ${order.status}`,
      );

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      if (order.payment) {
        await tx.p2PPayment.update({
          where: { id: order.payment.id },
          data: {
            status: status === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
            verifiedBy: auth.id,
            verifiedAt: new Date(),
            verificationNote: verificationNote ?? null,
          },
        });
      }

      const newOrderStatus: P2POrderStatus =
        status === 'VERIFIED' ? 'PAYMENT_VERIFICATION_PENDING' : 'CREATED';

      return tx.p2POrder.update({
        where: { id: orderId },
        data: { status: newOrderStatus },
        include: ORDER_INCLUDE,
      });
    });

    return {
      order: mapOrderView(updatedOrder),
      payment: mapPaymentView(updatedOrder.payment),
      dispute: mapDisputeView(updatedOrder.dispute),
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminCompleteOrder
  // -------------------------------------------------------------------------

  async adminCompleteOrder(id: string): Promise<P2POrderSummaryView> {
    const order = await this.prisma.p2POrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException('P2P order not found');

    const completableStates: P2POrderStatus[] = [
      'PAYMENT_VERIFICATION_PENDING',
      'PROCESSING',
    ];
    if (!completableStates.includes(order.status as P2POrderStatus))
      throw new BadRequestException(
        `Order cannot be completed in current state: ${order.status}`,
      );

    // Fetch wallets outside the tx to get their ids
    const buyerWallet = await this.walletService.getOrCreateWalletForUser(
      order.buyerId,
      order.fiat,
    );
    const sellerWallet = await this.walletService.getOrCreateWalletForUser(
      order.sellerId,
      order.fiat,
    );

    const completedOrder = await this.prisma.$transaction(async (tx) => {
      // Debit buyer locked balance (crypto delivered, fiat consumed)
      await tx.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          userId: order.buyerId,
          idempotencyKey: txKey('p2p-complete-debit', id),
          type: 'ADJUSTMENT',
          status: 'COMPLETED',
          amount: -order.fiatAmount,
          currency: order.fiat,
          reference: `p2p-complete-debit-${id}`,
        },
      });

      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: { lockedBalance: { decrement: order.fiatAmount } },
      });

      // Credit fiat to seller (minus platform fee)
      const sellerCredit = order.fiatAmount - order.feeAmount;
      await tx.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          userId: order.sellerId,
          idempotencyKey: txKey('p2p-complete-credit', id),
          type: 'ADJUSTMENT',
          status: 'COMPLETED',
          amount: sellerCredit,
          currency: order.fiat,
          reference: `p2p-complete-credit-${id}`,
        },
      });

      await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: { availableBalance: { increment: sellerCredit } },
      });

      return tx.p2POrder.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        include: ORDER_INCLUDE,
      });
    });

    return {
      order: mapOrderView(completedOrder),
      payment: mapPaymentView(completedOrder.payment),
      dispute: mapDisputeView(completedOrder.dispute),
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminListDisputes
  // -------------------------------------------------------------------------

  async adminListDisputes(): Promise<{
    items: P2PDisputeView[];
    total: number;
  }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2PDispute.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.p2PDispute.count(),
    ]);

    return {
      items: items.map((d) => mapDisputeView(d) as P2PDisputeView),
      total,
    };
  }

  // -------------------------------------------------------------------------
  // Admin: adminResolveDispute
  // -------------------------------------------------------------------------

  async adminResolveDispute(
    auth: AuthenticatedUser,
    dto: AdminResolveP2PDisputeDto,
  ): Promise<P2POrderSummaryView> {
    const { disputeId, resolution, resolutionNote } = dto;

    const dispute = await this.prisma.p2PDispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException('P2P dispute not found');
    if (dispute.status === 'RESOLVED')
      throw new BadRequestException('Dispute has already been resolved');

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: dispute.orderId },
    });
    if (!order) throw new NotFoundException('P2P order for dispute not found');

    // Pre-fetch wallets outside the tx
    const buyerWallet = await this.walletService.getOrCreateWalletForUser(
      order.buyerId,
      order.fiat,
    );
    const sellerWallet = await this.walletService.getOrCreateWalletForUser(
      order.sellerId,
      order.fiat,
    );

    const resolvedOrder = await this.prisma.$transaction(async (tx) => {
      await tx.p2PDispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: auth.id,
          resolvedAt: new Date(),
          resolutionNote: resolutionNote ?? null,
        },
      });

      let newOrderStatus: P2POrderStatus;

      if (resolution === 'BUYER_WINS') {
        // Refund buyer's locked funds
        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            userId: order.buyerId,
            idempotencyKey: txKey('p2p-dispute-refund', order.id),
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: order.fiatAmount,
            currency: order.fiat,
            reference: `p2p-dispute-refund-${order.id}`,
          },
        });
        await tx.wallet.update({
          where: { id: buyerWallet.id },
          data: {
            availableBalance: { increment: order.fiatAmount },
            lockedBalance: { decrement: order.fiatAmount },
          },
        });
        // Restore offer crypto availability
        await tx.p2POffer.update({
          where: { id: order.offerId },
          data: { availableCrypto: { increment: order.cryptoAmount } },
        });
        newOrderStatus = 'REFUNDED';
      } else if (resolution === 'SELLER_WINS') {
        // Debit buyer locked, credit seller available
        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            userId: order.buyerId,
            idempotencyKey: txKey('p2p-dispute-seller-debit', order.id),
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: -order.fiatAmount,
            currency: order.fiat,
            reference: `p2p-dispute-seller-wins-debit-${order.id}`,
          },
        });
        await tx.wallet.update({
          where: { id: buyerWallet.id },
          data: { lockedBalance: { decrement: order.fiatAmount } },
        });

        const sellerCredit = order.fiatAmount - order.feeAmount;
        await tx.walletTransaction.create({
          data: {
            walletId: sellerWallet.id,
            userId: order.sellerId,
            idempotencyKey: txKey('p2p-dispute-seller-credit', order.id),
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: sellerCredit,
            currency: order.fiat,
            reference: `p2p-dispute-seller-wins-credit-${order.id}`,
          },
        });
        await tx.wallet.update({
          where: { id: sellerWallet.id },
          data: { availableBalance: { increment: sellerCredit } },
        });
        newOrderStatus = 'COMPLETED';
      } else {
        // SPLIT: return half to buyer, pay remaining (minus fee) to seller
        const half = Math.floor(order.fiatAmount / 2);
        const sellerCredit = order.fiatAmount - half - order.feeAmount;

        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            userId: order.buyerId,
            idempotencyKey: txKey('p2p-dispute-split-buyer', order.id),
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: half - order.fiatAmount, // net change (negative, releases partial lock)
            currency: order.fiat,
            reference: `p2p-dispute-split-buyer-${order.id}`,
          },
        });
        await tx.wallet.update({
          where: { id: buyerWallet.id },
          data: {
            availableBalance: { increment: half },
            lockedBalance: { decrement: order.fiatAmount },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: sellerWallet.id,
            userId: order.sellerId,
            idempotencyKey: txKey('p2p-dispute-split-seller', order.id),
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: sellerCredit,
            currency: order.fiat,
            reference: `p2p-dispute-split-seller-${order.id}`,
          },
        });
        await tx.wallet.update({
          where: { id: sellerWallet.id },
          data: { availableBalance: { increment: sellerCredit } },
        });
        newOrderStatus = 'REFUNDED';
      }

      return tx.p2POrder.update({
        where: { id: order.id },
        data: { status: newOrderStatus },
        include: ORDER_INCLUDE,
      });
    });

    return {
      order: mapOrderView(resolvedOrder),
      payment: mapPaymentView(resolvedOrder.payment),
      dispute: mapDisputeView(resolvedOrder.dispute),
    };
  }
}
