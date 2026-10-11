/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService } from '../src/database/prisma.service';

/** In-memory fake of the Prisma surface used by the Phase 11 services. */
export function makePrismaFake() {
  const state = {
    users: [] as Record<string, any>[],
    identities: [] as Record<string, any>[],
    otps: [] as Record<string, any>[],
    sessions: [] as Record<string, any>[],
    securityEvents: [] as Record<string, any>[],
    auditLogs: [] as Record<string, any>[],
    authTokens: [] as Record<string, any>[],
    verifications: [] as Record<string, any>[],
  };
  let seq = 0;
  const id = () => `id-${++seq}`;

  const matches = (row: Record<string, any>, where: Record<string, any>): boolean =>
    Object.entries(where).every(([k, v]): boolean => {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        // Prisma scalar negation filter ({ not: value }) used by
        // session.updateMany({ id: { not: currentId } }) and friends.
        if (Object.prototype.hasOwnProperty.call(v, 'not')) {
          return row?.[k] !== (v as { not: unknown }).not;
        }
        return matches(row?.[k] ?? {}, v);
      }
      return row?.[k] === v;
    });

  const prisma: any = {
    user: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.OR) {
          return (
            state.users.find((u) =>
              where.OR.some((cond: any) =>
                Object.entries(cond).every(([k, v]) => u[k] === v),
              ),
            ) ?? null
          );
        }
        return state.users.find((u) => matches(u, where)) ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.id ? 'id' : where.email ? 'email' : where.phone ? 'phone' : 'username';
        const value = where[key];
        if (value === undefined || value === null) return null;
        return state.users.find((u) => u[key] === value) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const user = {
          emailVerified: false,
          phoneVerified: false,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          phoneVerifiedDuringSignupAt: null,
          ...data,
          id: id(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        // Support nested identity creation (OAuth user.create).
        if (data.authIdentities?.create) {
          const c = data.authIdentities.create;
          state.identities.push({
            ...c,
            id: id(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        delete user.authIdentities;
        // Simulate the USER role include for userRoles nested creates.
        user.userRoles = [{ role: { name: 'USER' } }];
        state.users.push(user);
        return user;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const user = state.users.find((u) => u.id === where.id)!;
        Object.assign(user, data, { updatedAt: new Date() });
        return user;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    role: { upsert: jest.fn(async () => ({ id: 'role-user', name: 'USER' })) },
    session: {
      create: jest.fn(async ({ data }: any) => {
        const session = { ...data, id: id(), revokedAt: null };
        state.sessions.push(session);
        return session;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = state.sessions.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        state.sessions
          .filter((s) => matches(s, where))
          .forEach((s) => Object.assign(s, data));
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) {
          return state.sessions.find((s) => s.id === where.id) ?? null;
        }
        if (where.refreshTokenHash !== undefined) {
          return (
            state.sessions.find((s) => s.refreshTokenHash === where.refreshTokenHash) ?? null
          );
        }
        return null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.previousRefreshTokenHash !== undefined) {
          return (
            state.sessions.find(
              (s) => s.previousRefreshTokenHash === where.previousRefreshTokenHash,
            ) ?? null
          );
        }
        return state.sessions.find((s) => matches(s, where)) ?? null;
      }),
    },
    securityEvent: {
      create: jest.fn(async ({ data }: any) => {
        state.securityEvents.push({ ...data, createdAt: new Date() });
        return data;
      }),
      count: jest.fn(async () => 0),
    },
    authToken: {
      create: jest.fn(async ({ data }: any) => {
        const t = { ...data, id: id(), usedAt: null, createdAt: new Date() };
        state.authTokens.push(t);
        return t;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        state.authTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        [...state.authTokens].reverse().find((t) => matches(t, where)) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const t = state.authTokens.find((x) => x.id === where.id);
        if (t) Object.assign(t, data);
        return t;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = state.authTokens.filter((t) => matches(t, where));
        matched.forEach((t) => Object.assign(t, data));
        return { count: matched.length };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.auditLogs.push(data);
        return data;
      }),
    },
    authIdentity: {
      findUnique: jest.fn(async ({ where }: any) => {
        const { provider, providerAccountId } = where.provider_providerAccountId;
        return (
          state.identities.find(
            (i) => i.provider === provider && i.providerAccountId === providerAccountId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const identity = { ...data, id: id(), createdAt: new Date(), updatedAt: new Date() };
        state.identities.push(identity);
        return identity;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        state.identities.filter((i) => i.userId === where.userId),
      ),
      count: jest.fn(async ({ where }: any) =>
        state.identities.filter((i) => i.userId === where.userId).length,
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = state.identities.length;
        state.identities = state.identities.filter(
          (i) => !(i.userId === where.userId && (!where.provider || i.provider === where.provider)),
        );
        return { count: before - state.identities.length };
      }),
    },
    otpCode: {
      create: jest.fn(async ({ data }: any) => {
        const otp = { ...data, id: id(), attempts: 0, consumedAt: null };
        state.otps.push(otp);
        return otp;
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const rows = state.otps
          .filter((o) => matches(o, where))
          .sort((a, b) =>
            orderBy?.lastSentAt === 'desc'
              ? b.lastSentAt.getTime() - a.lastSentAt.getTime()
              : a.lastSentAt.getTime() - b.lastSentAt.getTime(),
          );
        return rows[0] ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const otp = state.otps.find((o) => o.id === where.id);
        if (otp) Object.assign(otp, data);
        return otp;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        state.otps.filter((o) => matches(o, where)).forEach((o) => Object.assign(o, data));
        return { count: 1 };
      }),
    },
    verification: {
      findUnique: jest.fn(async ({ where }: any) => {
        const { userId, type } = where.userId_type;
        return state.verifications.find((v) => v.userId === userId && v.type === type) ?? null;
      }),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const { userId, type } = where.userId_type;
        let v = state.verifications.find((x) => x.userId === userId && x.type === type);
        if (v) Object.assign(v, update, { updatedAt: new Date() });
        else {
          v = { ...create, id: id(), createdAt: new Date(), updatedAt: new Date() } as Record<
            string,
            any
          >;
          state.verifications.push(v);
        }
        return v;
      }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };

  return { prisma: prisma as PrismaService, state };
}

export function makeJwtFake(overrides: Record<string, any> = {}) {
  return {
    signAsync: jest.fn(async () => 'access-token'),
    verifyAsync: jest.fn(async () => ({})),
    ...overrides,
  } as any;
}

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: null,
    phone: '+447911123456',
    username: 'tester',
    status: 'ACTIVE',
    passwordHash: 'x',
    passwordSetAt: null as Date | null,
    accountType: 'CUSTOMER',
    userRoles: [{ role: { name: 'USER' } }],
    createdAt: new Date(),
    updatedAt: new Date(),
    firstName: null,
    lastName: null,
    country: null,
    emailVerified: false,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    phoneVerifiedDuringSignupAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

export function otpHash(purpose: string, identifier: string, code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(`${purpose}:${identifier}:${code}`).digest('hex');
}
