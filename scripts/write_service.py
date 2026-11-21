celP2POrderDto,
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

    const [items, total] = await this.prisma.$transaction([
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
}
'''

with open(path, 'w') as f:
    f.write(content)
print('Service file written successfully')
^Z
