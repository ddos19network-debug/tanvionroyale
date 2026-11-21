lanceView,
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
} from './dto/p2p.dto';

@Injectable()
export class P2PService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async listOffers(
    query: ListP2POffersQueryDto,
  ): Promise<P2POffersView> {
    const { symbol, fiat, side, paymentMethod, minAmount, maxAmount, sortBy = 'price', page = 1, limit = 20 } = query;

    const where: Record<string, unknown> = { isActive: true };

    if (symbol) where.symbol = symbol;
    if (fiat) where.fiat = fiat;
    if (side) where.side = side;
    if (paymentMethod) where.paymentMethods = { has: paymentMethod };
    if (minAmount !== undefined) {
      where.minOrderFiat = { ...(where.minOrderFiat as object), gte: minAmount };
    }
    if (maxAmount !== undefined) {
      where.maxOrderFiat = { ...(where.maxOrderFiat as object), lte: maxAmount };
    }

    const orderBy: Record<string, string> = {};
    if (sortBy === 'price') orderBy.pricePerFiatUnit = 'asc';
    else if (sortBy === 'available') orderBy.availableCrypto = 'desc';
    else orderBy.createdAt = 'desc';

    const [items, total] = await this.prisma.\$transaction([
      this.prisma.p2POffer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { merchant: { include: { profile: true } } },
      }),
      this.prisma.p2POffer.count({ where }),
    ]);

    return {
      items: items.map((o) => ({
        id: o.id,
        merchantId: o.merchantId,
        merchant: {
          id: o.merchant.profile?.id || o.merchantId,
          displayName: o.merchant.profile?.displayName || 'Merchant',
          verificationStatus: o.merchant.profile?.verificationStatus || 'UNVERIFIED',
          totalOrders: o.merchant.profile?.totalOrders ?? 0,
          completedOrders: o.merchant.profile?.completedOrders ?? 0,
          cancelledOrders: o.merchant.profile?.cancelledOrders ?? 0,
          completionRate: Number(o.merchant.profile?.completionRate ?? 0),
          positiveFeedback: Number(o.merchant.profile?.positiveFeedback ?? 0),
          isActive: o.merchant.profile?.isActive ?? false,
          createdAt: o.merchant.profile?.createdAt || o.createdAt,
          updatedAt: o.merchant.profile?.updatedAt || o.updatedAt,
        } as any,
        symbol: o.symbol,
        fiat: o.fiat,
        side: o.side,
        pricePerFiatUnit: o.pricePerFiatUnit,
        cryptoScale: o.cryptoScale,
        availableCrypto: Number(o.availableCrypto),
        minOrderFiat: o.minOrderFiat,
        maxOrderFiat: o.maxOrderFiat,
        paymentMethods: (o.paymentMethods as string[]) || [],
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

  async getQuote(dto: P2PQuoteDto): Promise<P2PQuoteView> {
    const { symbol, fiat, side, fiatAmount } = dto;
    const offerSide = side === 'BUY' ? 'SELL' : 'BUY';

    const offer = await this.prisma.p2POffer.findFirst({
      where: {
        symbol,
        fiat,
        side: offerSide,
        isActive: true,
        availableCrypto: { gt: 0 },
        minOrderFiat: { lte: fiatAmount },
        maxOrderFiat: { gte: fiatAmount },
      },
    });

    if (!offer) {
      throw new BadRequestException('No active offer available for this pair and amount.');
    }

    const cryptoScale = offer.cryptoScale ?? 8;
    const pricePerUnit = offer.pricePerFiatUnit;
    const cryptoAmount = Math.floor((fiatAmount * Math.pow(10, cryptoScale)) / pricePerUnit);
    const feeAmount = Math.floor(fiatAmount * 0.005);
    const totalFiat = fiatAmount + feeAmount;

    return {
      symbol,
      fiat,
      side,
      fiatAmount,
      cryptoAmount,
      pricePerFiatUnit: pricePerUnit,
      feeAmount,
      totalFiat,
      dataSource: 'DEMO',
      asOf: new Date().toISOString(),
    };
  }

  async createOrder(
    auth: AuthenticatedUser,
    dto: CreateP2POrderDto,
  ): Promise<P2POrderView> {
    const { symbol, fiat, side, offerId, paymentMethod, idempotencyKey } = dto;

    const existing = await this.prisma.p2POrder.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.buyerId === auth.id) {
        return { id: existing.id, orderReference: existing.orderReference } as any;
      }
      throw new ConflictException('An order with this idempotency key already exists.');
    }

    const offer = await this.prisma.p2POffer.findUnique({ where: { id: offerId } });
    if (!offer || !offer.isActive) {
      throw new NotFoundException('Offer not found or inactive.');
    }
    if (offer.symbol !== symbol || offer.fiat !== fiat || offer.side !== side) {
      throw new BadRequestException('Offer does not match requested parameters.');
    }
    if (dto.fiatAmount < offer.minOrderFiat || dto.fiatAmount > offer.maxOrderFiat) {
      throw new BadRequestException('Amount outside offer limits.');
    }
    if (BigInt(offer.availableCrypto) < BigInt(dto.cryptoAmount)) {
      throw new BadRequestException('Insufficient crypto available in offer.');
    }

    if (side === 'BUY') {
      const balance = await this.walletService.getMyBalance(auth);
      if (balance.availableBalance < dto.fiatAmount) {
        throw new BadRequestException('Insufficient Royale Pay balance for this order.');
      }
      try {
        await this.walletService.reserveStake(auth.id, dto.fiatAmount, fiat, idempotencyKey);
      } catch {
        throw new BadRequestException('Failed to reserve funds for this order.');
      }
    }

    const orderReference = 'P2P-' + new Date().toISOString().slice(0, 10).replace(/-/g, '-') + '-' + idempotencyKey.slice(-8);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const order = await this.prisma.p2POrder.create({
      data: {
        orderReference,
        idempotencyKey,
        buyerId: auth.id,
        sellerId: offer.merchantId,
        offerId: offer.id,
        symbol,
        fiat,
        side,
        pricePerFiatUnit: offer.pricePerFiatUnit,
        cryptoAmount: BigInt(dto.cryptoAmount),
        fiatAmount: dto.fiatAmount,
        feeAmount: Math.floor(dto.fiatAmount * 0.005),
        status: 'CREATED',
        paymentMethod,
        expiresAt,
      },
      include: { offer: { include: { merchant: { include: { profile: true } } } } },
    });

    await this.prisma.p2POffer.update({
      where: { id: offer.id },
      data: { availableCrypto: { decrement: BigInt(dto.cryptoAmount) } },
    });

    return {
      id: order.id,
      orderReference: order.orderReference,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      offerId: order.offerId,
      symbol: order.symbol,
      fiat: order.fiat,
      side: order.side,
      pricePerFiatUnit: order.pricePerFiatUnit,
      cryptoAmount: Number(order.cryptoAmount),
      fiatAmount: order.fiatAmount,
      feeAmount: order.feeAmount,
      status: order.status as any,
      paymentMethod: order.paymentMethod,
      expiresAt: order.expiresAt.toISOString(),
    } as any;
  }

  async submitPayment(
    auth: AuthenticatedUser,
    dto: SubmitP2PPaymentDto,
  ): Promise<P2POrderView> {
    const order = await this.prisma.p2POrder.findUnique({ where: { id: dto.orderId }, include: { payment: true, offer: true } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.buyerId !== auth.id) throw new ForbiddenException('Only the buyer can submit payment.');
    if (order.status !== 'CREATED' && order.status !== 'PAYMENT_PENDING') {
      throw new BadRequestException('Order is not in a state that accepts payment.');
    }
    if (order.payment) throw new ConflictException('Payment already submitted.');

    const payment = await this.prisma.p2PPayment.create({
      data: {
        orderId: order.id,
        payerId: auth.id,
        payeeId: order.sellerId,
        method: dto.method,
        amount: order.fiatAmount,
        currency: order.fiat,
        reference: dto.reference ?? null,
        proofUrl: dto.proofUrl ?? null,
        status: 'SUBMITTED',
      },
    });

    const updated = await this.prisma.p2POrder.update({
      where: { id: order.id },
      data: { status: 'PAYMENT_SUBMITTED', paymentMethod: dto.method, paymentReference: dto.reference ?? undefined, paymentProofUrl: dto.proofUrl ?? undefined },
      include: { offer: { include: { merchant: { include: { profile: true } } } }, payment: true, dispute: true },
    });

    return {
      id: updated.id,
      orderReference: updated.orderReference,
      buyerId: updated.buyerId,
      sellerId: updated.sellerId,
      offerId: updated.offerId,
      symbol: updated.symbol,
      fiat: updated.fiat,
      side: updated.side,
      pricePerFiatUnit: updated.pricePerFiatUnit,
      cryptoAmount: Number(updated.cryptoAmount),
      fiatAmount: updated.fiatAmount,
      feeAmount: updated.feeAmount,
      status: updated.status as any,
      paymentMethod: updated.paymentMethod,
      paymentReference: updated.paymentReference,
      paymentProofUrl: updated.paymentProofUrl,
      expiresAt: updated.expiresAt.toISOString(),
    } as any);
  }

  async cancelOrder(
    auth: AuthenticatedUser,
    dto: CancelP2POrderDto,
  ): Promise<P2POrderView> {
    const order = await this.prisma.p2POrder.findUnique({ where: { id: dto.orderId }, include: { payment: true, offer: true } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.buyerId !== auth.id) throw new ForbiddenException('Only the buyer can cancel.');
    if (!['CREATED', 'PAYMENT_PENDING'].includes(order.status)) {
      throw new BadRequestException('Order cannot be cancelled at this stage.');
    }

    if (order.side === 'BUY') {
      try { await this.walletService.releaseStake(auth.id, order.idempotencyKey); } catch {}
    }

    await this.prisma.p2POffer.update({
      where: { id: order.offerId },
      data: { availableCrypto: { increment: order.cryptoAmount } },
    });

    const updated = await this.prisma.p2POrder.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: dto.reason ?? null },
      include: { offer: { include: { merchant: { include: { profile: true } } } }, payment: true, dispute: true },
    });

    return {
      id: updated.id,
      orderReference: updated.orderReference,
      buyerId: updated.buyerId,
      sellerId: updated.sellerId,
      offerId: updated.offerId,
      symbol: updated.symbol,
      fiat: updated.fiat,
      side: updated.side,
      pricePerFiatUnit: updated.pricePerFiatUnit,
      cryptoAmount: Number(updated.cryptoAmount),
      fiatAmount: updated.fiatAmount,
      feeAmount: updated.feeAmount,
      status: updated.status as any,
      paymentMethod: updated.paymentMethod,
      expiresAt: updated.expiresAt.toISOString(),
      paidAt: updated.paidAt?.toISOString(),
      completedAt: updated.completedAt?.toISOString(),
      cancelledAt: updated.cancelledAt?.toISOString(),
    } as any);
  }

  async listOrders(
    auth: AuthenticatedUser,
    query: ListP2POrdersQueryDto,
  ): Promise<P2POrderView[]> {
    const { status, page = 1, limit = 20 } = query;
    const where = { OR: [{ buyerId: auth.id }, { sellerId: auth.id }] };
    if (status) where.status = status;

    const orders = await this.prisma.p2POrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { offer: { include: { merchant: { include: { profile: true } } } }, payment: true, dispute: true },
    });

    return orders.map((o) => ({
      id: o.id,
      orderReference: o.orderReference,
      buyerId: o.buyerId,
      sellerId: o.sellerId,
      offerId: o.offerId,
      symbol: o.symbol,
      fiat: o.fiat,
      side: o.side,
      pricePerFiatUnit: o.pricePerFiatUnit,
      cryptoAmount: Number(o.cryptoAmount),
      fiatAmount: o.fiatAmount,
      feeAmount: o.feeAmount,
      status: o.status as any,
      paymentMethod: o.paymentMethod,
      expiresAt: o.expiresAt.toISOString(),
    } as any));
  }

  async getRoyalePayBalance(auth: AuthenticatedUser): Promise<RoyalePayBalanceView> {
    const balance = await this.walletService.getMyBalance(auth);

    const lockedAmount = balance.lockedBalance ?? 0;
    const availableAmount = balance.availableBalance ?? 0;

    return {
      balanceId: balance.id,
      userId: auth.id,
      totalBalance: balance.totalBalance,
      availableBalance: availableAmount,
      lockedBalance: lockedAmount,
      currency: balance.currency ?? 'BDT',
      lastUpdated: new Date().toISOString(),
    };
  }
}
'''
^Z
