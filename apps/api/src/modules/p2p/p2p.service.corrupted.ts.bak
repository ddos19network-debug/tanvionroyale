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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POffer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { merchant: { include: { merchantProfile: true } } },
      }),
      this.prisma.p2POffer.count({ where }),
    ]);

    return {
      items: items.map((o) => ({
        id: o.id,
        merchantId: o.merchantId,
        merchant: {
          id: o.merchant.merchantProfile?.id || o.merchantId,
          displayName: o.merchant.merchantProfile?.displayName || 'Merchant',
          verificationStatus: o.merchant.merchantProfile?.verificationStatus || 'UNVERIFIED',
          totalOrders: o.merchant.merchantProfile?.totalOrders ?? 0,
          completedOrders: o.merchant.merchantProfile?.completedOrders ?? 0,
          cancelledOrders: o.merchant.merchantProfile?.cancelledOrders ?? 0,
          completionRate: Number(o.merchant.merchantProfile?.completionRate ?? 0),
          positiveFeedback: Number(o.merchant.merchantProfile?.positiveFeedback ?? 0),
          isActive: o.merchant.merchantProfile?.isActive ?? false,
          createdAt: o.merchant.merchantProfile?.createdAt || o.createdAt,
          updatedAt: o.merchant.merchantProfile?.updatedAt || o.updatedAt,
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
    const { symbol, fiat, side } = dto;

    const offers = await this.prisma.p2POffer.findMany({
      where: {
        isActive: true,
        symbol,
        fiat,
        side,
      },
      orderBy: side === 'BUY' ? { pricePerFiatUnit: 'asc' } : { pricePerFiatUnit: 'desc' },
      take: 1,
    });

    if (offers.length === 0) {
      throw new NotFoundException('No active offers available for the selected criteria');
    }

    const offer = offers[0];
    const cryptoScale = offer.cryptoScale || 8;
    const pricePerFiatUnit = offer.pricePerFiatUnit;

    let cryptoAmount: number;
    let totalFiat: number;

    if (side === 'BUY') {
      cryptoAmount = Math.floor(dto.fiatAmount / pricePerFiatUnit * Math.pow(10, cryptoScale)) / Math.pow(10, cryptoScale);
      totalFiat = dto.fiatAmount;
    } else {
      const maxCrypto = offer.availableCrypto || 0;
      cryptoAmount = Math.floor(maxCrypto * Math.pow(10, cryptoScale)) / Math.pow(10, cryptoScale);
      totalFiat = Math.floor(cryptoAmount * pricePerFiatUnit * Math.pow(10, 2)) / Math.pow(10, 2);
    }

    const feeAmount = Math.floor(totalFiat * 0.001 * Math.pow(10, 2)) / Math.pow(10, 2);

    return {
      symbol: offer.symbol as P2PSymbol,
      fiat: offer.fiat as P2PFiat,
      side: offer.side as P2POrderSide,
      fiatAmount: dto.fiatAmount,
      cryptoAmount,
      pricePerFiatUnit,
      feeAmount,
      totalFiat: totalFiat + feeAmount,
      dataSource: 'LIVE',
      asOf: new Date().toISOString(),
    };
  }
    async createOrder(
    auth: AuthenticatedUser,
    dto: CreateP2POrderDto,
  ): Promise<P2POrderView> {
    const { symbol, fiat, side, cryptoAmount, pricePerFiatUnit, paymentMethod, offerId } = dto;

    const offer = await this.prisma.p2POffer.findUnique({
      where: { id: offerId },
      include: { merchant: { include: { merchantProfile: true } } },
    });

    if (!offer) {
      throw new NotFoundException('P2P offer not found');
    }

    if (!offer.isActive) {
      throw new BadRequestException('This offer is no longer active');
    }

    if (offer.symbol !== symbol) {
      throw new BadRequestException('Symbol does not match the offer');
    }

    if (offer.side !== side) {
      throw new BadRequestException('Side does not match the offer');
    }

    if (offer.fiat !== fiat) {
      throw new BadRequestException('Fiat does not match the offer');
    }

    const availableCrypto = Number(offer.availableCrypto || 0);
    if (cryptoAmount > availableCrypto) {
      throw new BadRequestException('Insufficient crypto available in offer');
    }

    const minOrderFiat = Number(offer.minOrderFiat || 0);
    const maxOrderFiat = Number(offer.maxOrderFiat || Infinity);
    const fiatAmount = Number(dto.fiatAmount);
    if (fiatAmount < minOrderFiat) {
      throw new BadRequestException(`Minimum fiat order amount is ${minOrderFiat} minor units`);
    }
    if (fiatAmount > maxOrderFiat) {
      throw new BadRequestException(`Maximum fiat order amount is ${maxOrderFiat} minor units`);
    }

    const wallet = await this.walletService.getUserWallet(auth.id, fiat);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    if (wallet.availableBalance < dto.fiatAmount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const feeAmount = Math.floor(dto.fiatAmount * 0.001 * Math.pow(10, 2)) / Math.pow(10, 2);

    const order = await this.prisma.$transaction(async (prisma) => {
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          status: 'PENDING',
          amount: -dto.fiatAmount,
          currency: fiat,
          reference: `p2p-order-${offer.id}`,
        },
      });

      const newAvailableCrypto = availableCrypto - cryptoAmount;
      await prisma.p2POffer.update({
        where: { id: offer.id },
        data: { availableCrypto: newAvailableCrypto },
      });

      const orderReference = `TANV-ROYALE-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

      const newOrder = await prisma.p2POrder.create({
        data: {
          buyerId: auth.id,
          sellerId: offer.merchantId,
          offerId: offer.id,
          symbol,
          fiat,
          side,
          pricePerFiatUnit,
          cryptoAmount,
          fiatAmount: dto.fiatAmount,
          feeAmount,
          status: 'CREATED',
          paymentMethod,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
        include: {
          buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
          seller: { select: { id: true, username: true, firstName: true, lastName: true } },
          offer: {
            include: { merchant: { include: { merchantProfile: true } } },
          },
        },
      });

      return newOrder;
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
      cryptoAmount: order.cryptoAmount,
      fiatAmount: order.fiatAmount,
      feeAmount: order.feeAmount,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentReference: order.paymentReference,
      paymentProofUrl: order.paymentProofUrl,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() || null,
      completedAt: order.completedAt?.toISOString() || null,
      cancelledAt: order.cancelledAt?.toISOString() || null,
      cancellationReason: order.cancellationReason || null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
async getOrder(
    auth: AuthenticatedUser,
    id: string,
  ): Promise<P2POrderView> {
    const order = await this.prisma.p2POrder.findUnique({
      where: { id },
      include: {
        buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
        seller: { select: { id: true, username: true, firstName: true, lastName: true } },
        offer: {
          include: {
            merchant: {
              include: { merchantProfile: true },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        dispute: true,
      },
    });

    if (!order) {
      throw new NotFoundException('P2P order not found');
    }

    if (order.buyerId !== auth.id && order.sellerId !== auth.id) {
      throw new ForbiddenException('You do not have permission to view this order');
    }

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
      cryptoAmount: order.cryptoAmount,
      fiatAmount: order.fiatAmount,
      feeAmount: order.feeAmount,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentReference: order.paymentReference,
      paymentProofUrl: order.paymentProofUrl,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() || null,
      completedAt: order.completedAt?.toISOString() || null,
      cancelledAt: order.cancelledAt?.toISOString() || null,
async submitPayment(
    auth: AuthenticatedUser,
    dto: SubmitP2PPaymentDto,
  ): Promise<P2POrderView> {
    const { orderId, method, reference, proofUrl } = dto;

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: orderId },
      include: {
        offer: {
          include: {
            merchant: {
              include: { merchantProfile: true },
            },
          },
        },
        buyer: true,
      },
    });

    if (!order) {
      throw new NotFoundException('P2P order not found');
    }

    if (order.buyerId !== auth.id) {
      throw new ForbiddenException('You can only submit payment for your own orders');
    }

    const validStatesForPayment = ['CREATED', 'PAYMENT_PENDING'];
    if (!validStatesForPayment.includes(order.status)) {
      throw new BadRequestException(`Payment cannot be submitted in current order state: ${order.status}`);
    }

    if (order.status === 'PAYMENT_SUBMITTED') {
      throw new BadRequestException('Payment has already been submitted for this order');
    }

    const fiatAmount = order.fiatAmount;
    const feeAmount = Math.floor(fiatAmount * 0.001 * Math.pow(10, 2)) / Math.pow(10, 2);

    const updatedOrder = await this.prisma.p2POrder.update({
      where: { id: orderId },
      data: {
        status: 'PAYMENT_SUBMITTED',
        paymentMethod: method,
        paymentReference: reference || null,
        paymentProofUrl: proofUrl || null,
      },
      include: {
        buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
        seller: { select: { id: true, username: true, firstName: true, lastName: true } },
        offer: {
          include: {
            merchant: {
              include: { merchantProfile: true },
async cancelOrder(
    auth: AuthenticatedUser,
    dto: CancelP2POrderDto,
  ): Promise<P2POrderView> {
    const { orderId, reason } = dto;

    const order = await this.prisma.p2POrder.findUnique({
      where: { id: orderId },
      include: {
        buyer: true,
        offer: {
          include: {
            merchant: {
              include: { merchantProfile: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('P2P order not found');
    }

    if (order.buyerId !== auth.id) {
      throw new ForbiddenException('You can only cancel your own orders');
    }

    const validStatesForCancellation = ['CREATED', 'PAYMENT_PENDING'];
    if (!validStatesForCancellation.includes(order.status)) {
      throw new BadRequestException(`Order cannot be cancelled in current state: ${order.status}`);
    }

    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Order has already been cancelled');
    }

    const cancelledOrder = await this.prisma.$transaction(async (prisma) => {
      if (order.fiatAmount > 0) {
        await prisma.walletTransaction.create({
          data: {
            walletId: order.buyerId,
            type: 'ADJUSTMENT',
            status: 'COMPLETED',
            amount: order.fiatAmount,
            currency: order.fiat,
            reference: `p2p-cancel-${order.id}`,
          },
        });
      }

      await prisma.p2POffer.update({
        where: { id: order.offerId },
        data: { availableCrypto: { increment: order.cryptoAmount } },
      });
async listOrders(
    auth: AuthenticatedUser,
    query: ListP2POrdersQueryDto,
  ): Promise<{ items: P2POrderView[]; total: number; page: number; limit: number }> {
    const { status, page = 1, limit = 20 } = query;

    const where: Record<string, unknown> = {
      buyerId: auth.id,
    };

    if (status) {
      where.status = status;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.p2POrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          offer: {
            include: {
              merchant: {
                include: { merchantProfile: true },
              },
            },
          },
          buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
          seller: { select: { id: true, username: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.p2POrder.count({ where }),
    ]);

    return {
      items: items.map((o) => ({
        id: o.id,
        orderReference: o.orderReference,
        buyerId: o.buyerId,
        sellerId: o.sellerId,
        offerId: o.offerId,
        symbol: o.symbol,
        fiat: o.fiat,
        side: o.side,
        pricePerFiatUnit: o.pricePerFiatUnit,
        cryptoAmount: o.cryptoAmount,
        fiatAmount: o.fiatAmount,
        feeAmount: o.feeAmount,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentReference: o.paymentReference,
        paymentProofUrl: o.paymentProofUrl,
        expiresAt: o.expiresAt.toISOString(),
        paidAt: o.paidAt?.toISOString() || null,
async getRoyalePayBalance(
    auth: AuthenticatedUser,
  ): Promise<RoyalePayBalanceView> {
    const wallet = await this.walletService.getUserWallet(auth.id, 'BDT');

    if (!wallet) {
      return {
        availableBalance: 0,
        lockedBalance: 0,
        currency: 'BDT',
        mode: 'DEMO',
      };
    }

    return {
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      currency: 'BDT',
      mode: 'LIVE',
    };
  }

  // Admin methods
        completedAt: o.completedAt?.toISOString() || null,
        cancelledAt: o.cancelledAt?.toISOString() || null,
        cancellationReason: o.cancellationReason || null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getRoyalePayBalance(

      const updated = await prisma.p2POrder.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancellationReason: reason || 'Cancelled by user',
        },
        include: {
          buyer: { select: { id: true, username: true, firstName: true, lastName: true } },
          seller: { select: { id: true, username: true, firstName: true, lastName: true } },
          offer: {
            include: {
              merchant: {
                include: { merchantProfile: true },
              },
            },
          },
        },
      });

      return updated;
    });

    return {
      id: cancelledOrder.id,
      orderReference: cancelledOrder.orderReference,
      buyerId: cancelledOrder.buyerId,
      sellerId: cancelledOrder.sellerId,
      offerId: cancelledOrder.offerId,
      symbol: cancelledOrder.symbol,
      fiat: cancelledOrder.fiat,
      side: cancelledOrder.side,
      pricePerFiatUnit: cancelledOrder.pricePerFiatUnit,
      cryptoAmount: cancelledOrder.cryptoAmount,
      fiatAmount: cancelledOrder.fiatAmount,
      feeAmount: cancelledOrder.feeAmount,
      status: cancelledOrder.status,
      paymentMethod: cancelledOrder.paymentMethod,
      paymentReference: cancelledOrder.paymentReference,
      paymentProofUrl: cancelledOrder.paymentProofUrl,
      expiresAt: cancelledOrder.expiresAt.toISOString(),
      paidAt: cancelledOrder.paidAt?.toISOString() || null,
      completedAt: cancelledOrder.completedAt?.toISOString() || null,
      cancelledAt: cancelledOrder.cancelledAt?.toISOString() || null,
      cancellationReason: cancelledOrder.cancellationReason || null,
      createdAt: cancelledOrder.createdAt.toISOString(),
      updatedAt: cancelledOrder.updatedAt.toISOString(),
    };
  }
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return {
      id: updatedOrder.id,
      orderReference: updatedOrder.orderReference,
      buyerId: updatedOrder.buyerId,
      sellerId: updatedOrder.sellerId,
      offerId: updatedOrder.offerId,
      symbol: updatedOrder.symbol,
      fiat: updatedOrder.fiat,
      side: updatedOrder.side,
      pricePerFiatUnit: updatedOrder.pricePerFiatUnit,
      cryptoAmount: updatedOrder.cryptoAmount,
      fiatAmount: updatedOrder.fiatAmount,
      feeAmount: updatedOrder.feeAmount,
      status: updatedOrder.status,
      paymentMethod: updatedOrder.paymentMethod,
      paymentReference: updatedOrder.paymentReference,
      paymentProofUrl: updatedOrder.paymentProofUrl,
      expiresAt: updatedOrder.expiresAt.toISOString(),
      paidAt: updatedOrder.paidAt?.toISOString() || null,
      completedAt: updatedOrder.completedAt?.toISOString() || null,
      cancelledAt: updatedOrder.cancelledAt?.toISOString() || null,
      cancellationReason: updatedOrder.cancellationReason || null,
      createdAt: updatedOrder.createdAt.toISOString(),
      updatedAt: updatedOrder.updatedAt.toISOString(),
    };
  }
      cancellationReason: order.cancellationReason || null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
