/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Mock Stores
// ────────────────────────────────────────────────────────────────────────────
const mockRedisData: Record<string, string> = {};
const mockRedis = {
  get: vi.fn(async (key: string) => mockRedisData[key] || null),
  set: vi.fn(async (key: string, val: string) => {
    mockRedisData[key] = val;
    return 'OK';
  }),
  setex: vi.fn(async (key: string, ttl: number, val: string) => {
    mockRedisData[key] = val;
    return 'OK';
  }),
  del: vi.fn(async (key: string) => {
    delete mockRedisData[key];
    return 1;
  }),
  exists: vi.fn(async (key: string) => (mockRedisData[key] ? 1 : 0)),
  expire: vi.fn(async (key: string, ttl: number) => 1),
  incr: vi.fn(async (key: string) => 1),
};

const mockPrismaData = {
  tenants: [] as any[],
  publishers: [] as any[],
  buyers: [] as any[],
  buyerEndpoints: [] as any[],
  campaigns: [] as any[],
  campaignBuyers: [] as any[],
  campaignPublishers: [] as any[],
  phoneNumbers: [] as any[],
  calls: [] as any[],
  accrualLedgers: [] as any[],
  buyerTransactions: [] as any[],
  users: [] as any[],
  roles: [] as any[],
  userRoles: [] as any[],
  balances: [] as any[],
  billingAccounts: [] as any[],
  payouts: [] as any[],
  invoices: [] as any[],
  invoiceLines: [] as any[],
  apiKeys: [] as any[],
  didRoutes: [] as any[],
  pingRequests: [] as any[],
  buyerBids: [] as any[],
};

// Monotonic ids.
//
// Rows used to be keyed `${prefix}-${Date.now()}`, and two rows created in the
// same millisecond — which is every row, these tests do no I/O — collided. Two
// calls sharing an id meant findUnique returned the first for both, so the
// second call inherited the first's DEBIT transaction and every idempotency
// check reported it as already charged.
let mockIdCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++mockIdCounter}`;

// Helper to construct database objects
const mockPrisma = {
  $transaction: vi.fn(cb => cb(mockPrisma)),

  tenant: {
    findUnique: vi.fn(
      async ({ where }) =>
        mockPrismaData.tenants.find(t => t.id === where.id || t.slug === where.slug) || null
    ),
    findFirst: vi.fn(
      async ({ where }) =>
        mockPrismaData.tenants.find(t => t.id === where.id || t.slug === where.slug) || null
    ),
  },

  user: {
    findUnique: vi.fn(async ({ where, include }) => {
      const u = mockPrismaData.users.find(x => x.id === where.id || x.email === where.email);
      if (!u) return null;
      const res = { ...u };
      if (include?.roles) {
        res.roles = mockPrismaData.userRoles
          .filter(ur => ur.userId === u.id)
          .map(ur => {
            const role = mockPrismaData.roles.find(r => r.id === ur.roleId) || {
              name: 'BUYER',
              permissions: [],
            };
            return { ...ur, role };
          });
      }
      if (include?.buyer) {
        res.buyer = mockPrismaData.buyers.find(b => b.id === u.buyerId) || null;
      }
      return res;
    }),
    findFirst: vi.fn(
      async ({ where }) =>
        mockPrismaData.users.find(x => x.id === where.id || x.email === where.email) || null
    ),
    update: vi.fn(async ({ where, data }) => {
      const u = mockPrismaData.users.find(x => x.id === where.id);
      if (u) {
        Object.assign(u, data);
        return u;
      }
      return null;
    }),
  },

  role: {
    findUnique: vi.fn(
      async ({ where }) =>
        mockPrismaData.roles.find(r => r.id === where.id || r.name === where.name) || null
    ),
    findFirst: vi.fn(
      async ({ where }) =>
        mockPrismaData.roles.find(r => r.id === where.id || r.name === where.name) || null
    ),
  },

  apiKey: {
    findUnique: vi.fn(async ({ where, include }) => {
      const key = mockPrismaData.apiKeys.find(k => k.keyHash === where.keyHash);
      if (!key) return null;
      const res = { ...key };
      if (include?.tenant) {
        res.tenant = mockPrismaData.tenants.find(t => t.id === key.tenantId) || {
          status: 'ACTIVE',
        };
      }
      return res;
    }),
    update: vi.fn(async ({ where, data }) => {
      const key = mockPrismaData.apiKeys.find(k => k.id === where.id);
      if (key) {
        Object.assign(key, data);
        return key;
      }
      return null;
    }),
  },

  phoneNumber: {
    findFirst: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.phoneNumbers.find(p => !where.number || p.number === where.number) || null
      );
    }),
    update: vi.fn(async ({ where, data }) => {
      const idx = mockPrismaData.phoneNumbers.findIndex(
        p => p.id === where.id || p.number === where.number
      );
      if (idx !== -1) {
        mockPrismaData.phoneNumbers[idx] = { ...mockPrismaData.phoneNumbers[idx], ...data };
        return mockPrismaData.phoneNumbers[idx];
      }
      return null;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.phoneNumbers.find(p => p.id === where.id || p.number === where.number) ||
        null
      );
    }),
    findMany: vi.fn(async () => mockPrismaData.phoneNumbers),
  },

  buyer: {
    findUnique: vi.fn(
      async ({ where }) => mockPrismaData.buyers.find(b => b.id === where.id) || null
    ),
    update: vi.fn(async ({ where, data }) => {
      const b = mockPrismaData.buyers.find(x => x.id === where.id);
      if (b) {
        if (data.walletBalance !== undefined)
          b.walletBalance = new Prisma.Decimal(data.walletBalance.toString());
        if (data.leadsRemaining !== undefined) b.leadsRemaining = data.leadsRemaining;
        if (data.status !== undefined) b.status = data.status;
        return b;
      }
      return null;
    }),
  },

  buyerEndpoint: {
    // Honours the `where` clause. auction-service queries
    // `{ status: 'ACTIVE', buyer: { status: 'ACTIVE', publisherId } }`, and a
    // findMany that ignored it returned buyers belonging to no publisher —
    // so an ineligible buyer could win the auction.
    findMany: vi.fn(async ({ where }: any = {}) => {
      return mockPrismaData.buyerEndpoints
        .map(ep => ({
          ...ep,
          buyer: mockPrismaData.buyers.find(b => b.id === ep.buyerId),
        }))
        .filter(ep => {
          if (where?.status !== undefined && ep.status !== where.status) return false;
          if (where?.buyerId !== undefined && ep.buyerId !== where.buyerId) return false;

          const buyerWhere = where?.buyer;
          if (buyerWhere) {
            if (!ep.buyer) return false;
            if (buyerWhere.status !== undefined && ep.buyer.status !== buyerWhere.status) {
              return false;
            }
            if (
              buyerWhere.publisherId !== undefined &&
              ep.buyer.publisherId !== buyerWhere.publisherId
            ) {
              return false;
            }
          }
          return true;
        });
    }),
    findUnique: vi.fn(async ({ where }) => {
      const ep = mockPrismaData.buyerEndpoints.find(e => e.id === where.id);
      if (ep) {
        return {
          ...ep,
          buyer: mockPrismaData.buyers.find(b => b.id === ep.buyerId),
        };
      }
      return null;
    }),
  },

  campaignBuyer: {
    findMany: vi.fn(async () => mockPrismaData.campaignBuyers),
  },

  campaignPublisher: {
    findUnique: vi.fn(async () => mockPrismaData.campaignPublishers[0] || null),
  },

  campaign: {
    findFirst: vi.fn(async () => mockPrismaData.campaigns[0] || null),
    findUnique: vi.fn(
      async ({ where }) => mockPrismaData.campaigns.find(c => c.id === where.id) || null
    ),
  },

  publisher: {
    findUnique: vi.fn(
      async ({ where }) => mockPrismaData.publishers.find(p => p.id === where.id) || null
    ),
  },

  didRoute: {
    findFirst: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.didRoutes.find(
          r => !where.phoneNumberId || r.phoneNumberId === where.phoneNumberId
        ) || null
      );
    }),
    findUnique: vi.fn(async ({ where }) => {
      return mockPrismaData.didRoutes.find(r => r.id === where.id) || null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const idx = mockPrismaData.didRoutes.findIndex(r => r.id === where.id);
      if (idx !== -1) {
        mockPrismaData.didRoutes[idx] = { ...mockPrismaData.didRoutes[idx], ...data };
        return mockPrismaData.didRoutes[idx];
      }
      return null;
    }),
    // The CDR webhook updates route stats through `updateMany` so the tenant
    // can be part of the filter -- `update` only accepts a unique key. The
    // mock honours the tenant filter, so a wrong-tenant routeId matches
    // nothing here exactly as it would in Postgres.
    updateMany: vi.fn(async ({ where, data }) => {
      const matches = mockPrismaData.didRoutes.filter(
        r =>
          (where.id === undefined || r.id === where.id) &&
          (where.tenantId === undefined || r.tenantId === where.tenantId)
      );
      for (const route of matches) {
        const idx = mockPrismaData.didRoutes.indexOf(route);
        mockPrismaData.didRoutes[idx] = { ...route, ...data };
      }
      return { count: matches.length };
    }),
  },

  pingRequest: {
    create: vi.fn(async ({ data }) => {
      const ping = {
        id: data.id || nextId('ping'),
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.pingRequests.push(ping);
      return ping;
    }),
    update: vi.fn(async ({ where, data }) => {
      const idx = mockPrismaData.pingRequests.findIndex(p => p.id === where.id);
      if (idx !== -1) {
        mockPrismaData.pingRequests[idx] = { ...mockPrismaData.pingRequests[idx], ...data };
        return mockPrismaData.pingRequests[idx];
      }
      return null;
    }),
    // billing-service.ts looks for an RTB winning bid attached to the call's
    // DID through this. It was missing, so the lookup threw inside the billing
    // transaction; calculateCallBilling swallowed it into a failed result and
    // never wrote `billable`, which is why every CDR-driven assertion saw
    // undefined without any error being logged.
    findMany: vi.fn(async ({ where, include }: any = {}) => {
      const wantedNumber = where?.assignedPhoneNumber?.number;
      const wantedTenant = where?.assignedPhoneNumber?.tenantId;

      return mockPrismaData.pingRequests
        .filter(p => {
          if (where?.status !== undefined && p.status !== where.status) return false;
          if (wantedNumber !== undefined) {
            const phone = mockPrismaData.phoneNumbers.find(n => n.id === p.assignedPhoneNumberId);
            if (!phone || phone.number !== wantedNumber) return false;
            if (wantedTenant !== undefined && phone.tenantId !== wantedTenant) return false;
          }
          return true;
        })
        .map(p => {
          if (!include?.bids) return { ...p };
          const wanted = include.bids?.where?.status;
          return {
            ...p,
            bids: mockPrismaData.buyerBids
              .filter(b => b.pingRequestId === p.id && (!wanted || b.status === wanted))
              .map(b =>
                include.bids?.include?.buyerEndpoint
                  ? {
                      ...b,
                      buyerEndpoint: mockPrismaData.buyerEndpoints.find(
                        e => e.id === b.buyerEndpointId
                      ),
                    }
                  : b
              ),
          };
        });
    }),
    // did-routes.ts resolves an RTB CDR through this, with
    // `include: { publisher, bids: { where: { status: 'WON' }, include: { buyerEndpoint } } }`.
    findUnique: vi.fn(async ({ where, include }: any) => {
      const ping = mockPrismaData.pingRequests.find(p => p.id === where.id);
      if (!ping) return null;

      const hydrated: any = { ...ping };
      if (include?.publisher) {
        hydrated.publisher = mockPrismaData.publishers.find(p => p.id === ping.publisherId);
      }
      if (include?.bids) {
        const wanted = include.bids?.where?.status;
        // post-service asks for buyerEndpoint WITH its nested buyer.
        const wantsBuyer = !!include.bids?.include?.buyerEndpoint?.include?.buyer;
        hydrated.bids = mockPrismaData.buyerBids
          .filter(b => b.pingRequestId === ping.id && (!wanted || b.status === wanted))
          .map(b => {
            if (!include.bids?.include?.buyerEndpoint) return b;
            const ep = mockPrismaData.buyerEndpoints.find(e => e.id === b.buyerEndpointId);
            return {
              ...b,
              buyerEndpoint: ep
                ? {
                    ...ep,
                    ...(wantsBuyer
                      ? { buyer: mockPrismaData.buyers.find(x => x.id === ep.buyerId) }
                      : {}),
                  }
                : ep,
            };
          });
      }
      return hydrated;
    }),
  },

  // auction-service.ts writes every bid of an auction here and then reads the
  // winner back out. Without this model the RTB path threw on
  // `prisma.buyerBid.createMany` before any assertion could run.
  buyerBid: {
    createMany: vi.fn(async ({ data }: any) => {
      const rows = Array.isArray(data) ? data : [data];
      for (const [i, row] of rows.entries()) {
        mockPrismaData.buyerBids.push({
          id: row.id || `bid-${mockPrismaData.buyerBids.length + i + 1}`,
          createdAt: new Date(),
          ...row,
        });
      }
      return { count: rows.length };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      return (
        mockPrismaData.buyerBids.find(
          b =>
            (where?.pingRequestId === undefined || b.pingRequestId === where.pingRequestId) &&
            (where?.status === undefined || b.status === where.status)
        ) || null
      );
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return mockPrismaData.buyerBids.filter(
        b =>
          (where?.pingRequestId === undefined || b.pingRequestId === where.pingRequestId) &&
          (where?.status === undefined || b.status === where.status)
      );
    }),
  },

  call: {
    create: vi.fn(async ({ data }) => {
      const call = {
        id: nextId('call'),
        ...data,
        createdAt: new Date(),
        buyerChargeStatus: data.buyerChargeStatus || 'PENDING',
        publisherPayoutStatus: data.publisherPayoutStatus || 'PENDING',
      };
      mockPrismaData.calls.push(call);
      return call;
    }),
    update: vi.fn(async ({ where, data }) => {
      const call = mockPrismaData.calls.find(c => c.id === where.id);
      if (call) {
        Object.assign(call, data);
        return call;
      }
      return null;
    }),
    findUnique: vi.fn(async ({ where }) => {
      const call = mockPrismaData.calls.find(c => c.id === where.id);
      if (call) {
        return {
          ...call,
          buyer: mockPrismaData.buyers.find(b => b.id === call.buyerId),
          campaign: mockPrismaData.campaigns.find(c => c.id === call.campaignId),
          publisher: mockPrismaData.publishers.find(p => p.id === call.publisherId),
        };
      }
      return null;
    }),
    findFirst: vi.fn(async ({ where }) => {
      return mockPrismaData.calls.find(c => c.id === where.id) || null;
    }),
    count: vi.fn(async () => mockPrismaData.calls.length),
    aggregate: vi.fn(async ({ where }) => {
      const filtered = mockPrismaData.calls.filter(
        c => !where.tenantId || c.tenantId === where.tenantId
      );
      const count = filtered.length;
      const buyerBillableAmountSum = filtered.reduce(
        (acc, c) => acc + (c.buyerBillableAmount ? Number(c.buyerBillableAmount) : 0),
        0
      );
      const publisherPayoutAmountSum = filtered.reduce(
        (acc, c) => acc + (c.publisherPayoutAmount ? Number(c.publisherPayoutAmount) : 0),
        0
      );
      const costSum = filtered.reduce((acc, c) => acc + (c.cost ? Number(c.cost) : 0), 0);
      return {
        _count: { id: count },
        _sum: {
          buyerBillableAmount: buyerBillableAmountSum,
          publisherPayoutAmount: publisherPayoutAmountSum,
          cost: costSum,
        },
      };
    }),
    findMany: vi.fn(async ({ where, select, include, orderBy }) => {
      let filtered = [...mockPrismaData.calls];
      if (where) {
        if (where.tenantId) {
          filtered = filtered.filter(c => c.tenantId === where.tenantId);
        }
        if (where.buyerId) {
          filtered = filtered.filter(c => c.buyerId === where.buyerId);
        }
        if (where.publisherId) {
          filtered = filtered.filter(c => c.publisherId === where.publisherId);
        }
        if (where.campaignId) {
          filtered = filtered.filter(c => c.campaignId === where.campaignId);
        }
        if (where.createdAt) {
          if (where.createdAt.gte) {
            filtered = filtered.filter(c => new Date(c.createdAt) >= new Date(where.createdAt.gte));
          }
          if (where.createdAt.lte) {
            filtered = filtered.filter(c => new Date(c.createdAt) <= new Date(where.createdAt.lte));
          }
        }
        if (where.buyerBillableAmount && where.buyerBillableAmount.gt !== undefined) {
          filtered = filtered.filter(
            c =>
              c.buyerBillableAmount && Number(c.buyerBillableAmount) > where.buyerBillableAmount.gt
          );
        }
        if (where.publisherPayoutAmount && where.publisherPayoutAmount.gt !== undefined) {
          filtered = filtered.filter(
            c =>
              c.publisherPayoutAmount &&
              Number(c.publisherPayoutAmount) > where.publisherPayoutAmount.gt
          );
        }
        if (where.cost && where.cost.gt !== undefined) {
          filtered = filtered.filter(c => c.cost && Number(c.cost) > where.cost.gt);
        }
        if (where.accruals && where.accruals.none) {
          const type = where.accruals.none.type;
          filtered = filtered.filter(c => {
            const hasLedger = mockPrismaData.accrualLedgers.some(
              l => l.callId === c.id && l.type === type
            );
            return !hasLedger;
          });
        }
        if (where.disputeStatus) {
          if (where.disputeStatus.not === null) {
            filtered = filtered.filter(
              c => c.disputeStatus !== null && c.disputeStatus !== undefined
            );
          } else if (where.disputeStatus.not !== undefined) {
            filtered = filtered.filter(c => c.disputeStatus !== where.disputeStatus.not);
          } else {
            filtered = filtered.filter(c => c.disputeStatus === where.disputeStatus);
          }
        }
        if (where.publisherPayoutStatus) {
          if (where.publisherPayoutStatus.notIn) {
            filtered = filtered.filter(
              c => !where.publisherPayoutStatus.notIn.includes(c.publisherPayoutStatus)
            );
          }
        }
      }

      const mapped = filtered.map(c => {
        const item = { ...c };
        if (select) {
          const selectedItem: any = {};
          for (const key of Object.keys(select)) {
            selectedItem[key] = item[key];
          }
          if (select.buyer) {
            const bObj = mockPrismaData.buyers.find(b => b.id === item.buyerId) || null;
            if (bObj && typeof select.buyer === 'object' && select.buyer.select) {
              const selectedB: any = {};
              for (const k of Object.keys(select.buyer.select)) {
                selectedB[k] = bObj[k];
              }
              selectedItem.buyer = selectedB;
            } else {
              selectedItem.buyer = bObj;
            }
          }
          return selectedItem;
        }
        item.buyer = mockPrismaData.buyers.find(b => b.id === item.buyerId) || null;
        item.campaign = mockPrismaData.campaigns.find(cam => cam.id === item.campaignId) || null;
        item.publisher = mockPrismaData.publishers.find(p => p.id === item.publisherId) || null;
        return item;
      });

      return mapped;
    }),
  },

  accrualLedger: {
    findMany: vi.fn(async ({ where, select }) => {
      let filtered = [...mockPrismaData.accrualLedgers];
      if (where) {
        if (where.tenantId) {
          filtered = filtered.filter(l => l.tenantId === where.tenantId);
        }
        if (where.callId) {
          if (where.callId.in) {
            filtered = filtered.filter(l => where.callId.in.includes(l.callId));
          } else {
            filtered = filtered.filter(l => l.callId === where.callId);
          }
        }
        if (where.type) {
          if (where.type.in) {
            filtered = filtered.filter(l => where.type.in.includes(l.type));
          } else {
            filtered = filtered.filter(l => l.type === where.type);
          }
        }
      }
      return filtered.map(l => {
        if (select) {
          const selected: any = {};
          for (const key of Object.keys(select)) {
            selected[key] = l[key];
          }
          return selected;
        }
        return l;
      });
    }),
    findUnique: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.accrualLedgers.find(
          l => l.id === where.id || l.idempotencyKey === where.idempotencyKey
        ) || null
      );
    }),
    create: vi.fn(async ({ data }) => {
      const ledger = {
        id: `ledger-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.accrualLedgers.push(ledger);
      return ledger;
    }),
    update: vi.fn(async ({ where, data }) => {
      const ledger = mockPrismaData.accrualLedgers.find(l => l.id === where.id);
      if (ledger) {
        Object.assign(ledger, data);
        return ledger;
      }
      return null;
    }),
    deleteMany: vi.fn(async () => ({ count: 1 })),
    groupBy: vi.fn(async ({ by, where }) => {
      const filtered = mockPrismaData.accrualLedgers.filter(
        l => !where.tenantId || l.tenantId === where.tenantId
      );
      const groups: Record<string, number> = {};
      for (const item of filtered) {
        const key = item.type;
        groups[key] = (groups[key] || 0) + (item.amount ? Number(item.amount) : 0);
      }
      return Object.entries(groups).map(([type, sum]) => ({
        type,
        _sum: { amount: sum },
      }));
    }),
  },

  buyerTransaction: {
    findFirst: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.buyerTransactions.find(
          t =>
            t.buyerId === where.buyerId &&
            (!where.callId || t.callId === where.callId) &&
            (!where.type || t.type === where.type)
        ) || null
      );
    }),
    create: vi.fn(async ({ data }) => {
      const tx = {
        id: `tx-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.buyerTransactions.push(tx);
      return tx;
    }),
    aggregate: vi.fn(async ({ where }) => {
      const filtered = mockPrismaData.buyerTransactions;
      const sum = filtered.reduce((acc, t) => acc + (t.amount ? Number(t.amount) : 0), 0);
      return {
        _sum: { amount: sum },
      };
    }),
  },

  billingAccount: {
    findFirst: vi.fn(async ({ where }) => {
      return mockPrismaData.billingAccounts.find(ba => ba.tenantId === where.tenantId) || null;
    }),
    create: vi.fn(async ({ data }) => {
      const account = { id: nextId('acc'), ...data, currency: 'USD' };
      mockPrismaData.billingAccounts.push(account);
      return account;
    }),
  },

  payout: {
    groupBy: vi.fn(async ({ by, where }) => {
      const filtered = mockPrismaData.payouts;
      const groups: Record<string, number> = {};
      for (const item of filtered) {
        const key = item.status;
        groups[key] = (groups[key] || 0) + (item.amount ? Number(item.amount) : 0);
      }
      return Object.entries(groups).map(([status, sum]) => ({
        status,
        _sum: { amount: sum },
      }));
    }),
  },

  invoiceLine: {
    aggregate: vi.fn(async () => {
      const sum = mockPrismaData.invoiceLines.reduce(
        (acc, l) => acc + (l.total ? Number(l.total) : 0),
        0
      );
      return {
        _sum: { total: sum },
      };
    }),
  },

  balance: {
    findMany: vi.fn(async ({ where }) => {
      return mockPrismaData.balances.filter(b => b.billingAccountId === where.billingAccountId);
    }),
    groupBy: vi.fn(async ({ by, where }) => {
      const filtered = mockPrismaData.balances;
      const groups: Record<string, number> = {};
      for (const item of filtered) {
        const key = item.type;
        groups[key] = (groups[key] || 0) + (item.amount ? Number(item.amount) : 0);
      }
      return Object.entries(groups).map(([type, sum]) => ({
        type,
        _sum: { amount: sum },
      }));
    }),
  },

  $queryRaw: vi.fn(async (query, ...values) => {
    const counts: Record<string, number> = {};
    for (const ledger of mockPrismaData.accrualLedgers) {
      if (!ledger.callId) continue;
      const key = `${ledger.callId}:${ledger.type}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    const duplicates = Object.entries(counts)
      .filter(([_, count]) => count > 1)
      .map(([key, count]) => {
        const [call_id, type] = key.split(':');
        return { call_id, type, count: BigInt(count) };
      });
    return duplicates;
  }),
};

// Mock module paths using Vitest
vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/geo.js', () => ({
  isCallerStateAccepted: () => true,
}));

vi.mock('../tcpa-validation-service.js', () => ({
  tcpaValidationService: {
    validateNumber: vi.fn().mockResolvedValue({ isLitigator: false }),
  },
}));

vi.mock('../event-bus.js', () => ({
  eventBus: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../secrets.js', () => ({
  secrets: {
    get: (key: string) => process.env[key] || 'test-secret',
    getRequired: (key: string) => process.env[key] || 'test-secret',
    has: (key: string) => true,
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// Imports after Mocking
// ────────────────────────────────────────────────────────────────────────────
import { registerAuthRoutes } from '../../routes/auth.js';
import { registerDidRouteRoutes } from '../../routes/did-routes.js';
import {
  registerReportingRoutes,
  registerBillingRoutes,
  registerCallRoutes,
} from '../../routes/index.js';
import { registerPingRoutes } from '../../routes/ping.js';
import { registerPostRoutes } from '../../routes/post.js';
import { auctionService } from '../auction-service.js';
import { BillingService } from '../billing-service.js';
import { BuyerBillingService } from '../buyer-billing-service.js';
import { postService } from '../post-service.js';

describe('Pay-Per-Call System End-to-End Integration Suite', () => {
  let app: any;
  const billingService = new BillingService();
  const buyerBillingService = new BuyerBillingService();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset stores
    for (const key of Object.keys(mockPrismaData)) {
      (mockPrismaData as any)[key] = [];
    }
    for (const key of Object.keys(mockRedisData)) {
      delete mockRedisData[key];
    }

    // Seed Roles
    mockPrismaData.roles = [
      { id: 'role-admin', name: 'ADMIN', permissions: ['admin:*'] },
      { id: 'role-owner', name: 'OWNER', permissions: ['admin:*'] },
      { id: 'role-buyer', name: 'BUYER', permissions: ['calls:read', 'billing:read'] },
      { id: 'role-publisher', name: 'PUBLISHER', permissions: ['calls:read', 'payouts:read'] },
      { id: 'role-agent', name: 'AGENT', permissions: ['calls:read'] },
      { id: 'role-readonly', name: 'READONLY', permissions: ['calls:read'] },
    ];

    // Seed Tenant
    mockPrismaData.tenants = [
      { id: 'tenant-1', name: 'E2E Tenant', slug: 'e2e-tenant', status: 'ACTIVE' },
    ];

    // Seed User Accounts
    mockPrismaData.users = [
      { id: 'usr-admin', email: 'admin@e2e.com', tenantId: 'tenant-1', status: 'ACTIVE' },
      {
        id: 'usr-buyer-a',
        email: 'buyera@e2e.com',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        buyerId: 'buyer-a',
      },
      {
        id: 'usr-buyer-b',
        email: 'buyerb@e2e.com',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        buyerId: 'buyer-b',
      },
      {
        id: 'usr-publisher-a',
        email: 'puba@e2e.com',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        publisherId: 'pub-a',
      },
      {
        id: 'usr-publisher-b',
        email: 'pubb@e2e.com',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        publisherId: 'pub-b',
      },
      { id: 'usr-agent', email: 'agent@e2e.com', tenantId: 'tenant-1', status: 'ACTIVE' },
      { id: 'usr-readonly', email: 'readonly@e2e.com', tenantId: 'tenant-1', status: 'ACTIVE' },
    ];

    mockPrismaData.userRoles = [
      { userId: 'usr-admin', roleId: 'role-admin' },
      { userId: 'usr-buyer-a', roleId: 'role-buyer' },
      { userId: 'usr-buyer-b', roleId: 'role-buyer' },
      { userId: 'usr-publisher-a', roleId: 'role-publisher' },
      { userId: 'usr-publisher-b', roleId: 'role-publisher' },
      { userId: 'usr-agent', roleId: 'role-agent' },
      { userId: 'usr-readonly', roleId: 'role-readonly' },
    ];

    // Seed Publisher API Keys
    mockPrismaData.apiKeys = [
      {
        id: 'apikey-pub-a',
        keyHash: 'pub-a-key-hash', // sha256 mock
        tenantId: 'tenant-1',
        publisherId: 'pub-a',
        status: 'ACTIVE',
        scopes: ['ping', 'post'],
      },
    ];

    // Seed Publishers & Buyers
    mockPrismaData.publishers = [
      { id: 'pub-a', name: 'Publisher A', code: 'puba123', status: 'ACTIVE', tenantId: 'tenant-1' },
      { id: 'pub-b', name: 'Publisher B', code: 'pubb123', status: 'ACTIVE', tenantId: 'tenant-1' },
    ];

    mockPrismaData.buyers = [
      {
        id: 'buyer-a',
        name: 'Buyer A Prepaid',
        code: 'buyera123',
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        // Managed by pub-a, so it is the only buyer eligible for that
        // publisher's auction. Buyer B is deliberately unmanaged.
        publisherId: 'pub-a',
        billingType: 'UPFRONT',
        walletBalance: new Prisma.Decimal('100.00'),
        leadsRemaining: 100,
        billableDuration: 60,
        canDisputeConversions: true,
      },
      {
        id: 'buyer-b',
        name: 'Buyer B TERMS',
        code: 'buyerb123',
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        billingType: 'TERMS',
        walletBalance: new Prisma.Decimal('0.00'),
        leadsRemaining: 0,
        billableDuration: 60,
        canDisputeConversions: false,
      },
    ];

    mockPrismaData.buyerEndpoints = [
      {
        id: 'ep-a',
        buyerId: 'buyer-a',
        name: 'Target A PSTN',
        type: 'PSTN',
        destination: '+18005559999',
        status: 'ACTIVE',
        basePrice: new Prisma.Decimal('15.00'),
        timezone: 'America/New_York',
        acceptedStates: [],
        weight: 100,
      },
      {
        id: 'ep-b',
        buyerId: 'buyer-b',
        name: 'Target B PSTN',
        type: 'PSTN',
        destination: '+18005558888',
        status: 'ACTIVE',
        basePrice: new Prisma.Decimal('20.00'),
        timezone: 'America/New_York',
        acceptedStates: [],
        weight: 100,
      },
    ];

    mockPrismaData.campaigns = [
      {
        id: 'camp-1',
        tenantId: 'tenant-1',
        name: 'Standard Campaign',
        status: 'ACTIVE',
        billableDurationSeconds: 60,
        buyerPricePerBillableCall: new Prisma.Decimal('25.00'),
        publisherPayoutPerBillableCall: new Prisma.Decimal('10.00'),
        recordingEnabled: true,
      },
    ];

    mockPrismaData.campaignBuyers = [
      {
        id: 'cb-a',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        buyerId: 'buyer-a',
        buyerEndpointId: 'ep-a',
        pricePerBillableCall: new Prisma.Decimal('25.00'),
        status: 'ACTIVE',
      },
      {
        id: 'cb-b',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        buyerId: 'buyer-b',
        buyerEndpointId: 'ep-b',
        pricePerBillableCall: new Prisma.Decimal('25.00'),
        status: 'ACTIVE',
      },
    ];

    mockPrismaData.campaignPublishers = [
      {
        id: 'cp-a',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        publisherId: 'pub-a',
        payoutPerBillableCall: new Prisma.Decimal('10.00'),
        status: 'ACTIVE',
      },
    ];

    mockPrismaData.phoneNumbers = [
      {
        id: 'num-1',
        number: '+18005550100',
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        poolType: 'POOL',
        poolStatus: 'AVAILABLE',
      },
      {
        id: 'num-static',
        number: '+18005550200',
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        poolType: 'STATIC',
        poolStatus: 'ASSIGNED',
      },
    ];

    mockPrismaData.didRoutes = [
      {
        id: 'route-static',
        tenantId: 'tenant-1',
        phoneNumberId: 'num-static',
        destination: '+18005559999',
        campaignId: 'camp-1',
        buyerId: 'buyer-a',
        publisherId: 'pub-a',
      },
    ];

    mockPrismaData.billingAccounts = [{ id: 'ba-tenant', tenantId: 'tenant-1', currency: 'USD' }];

    mockPrismaData.balances = [
      {
        id: 'bal-1',
        billingAccountId: 'ba-tenant',
        type: 'AVAILABLE',
        amount: new Prisma.Decimal('500.00'),
      },
    ];

    // Setup Fastify App
    app = Fastify();
    await app.register(import('@fastify/jwt'), {
      secret: 'test-secret',
    });

    // Register custom user authentication bypass for test injection
    app.addHook('onRequest', async (request: any) => {
      const auth = request.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        const token = auth.substring(7);
        try {
          const decoded = app.jwt.verify(token);
          request.user = decoded;
        } catch {
          // Ignore
        }
      }
    });

    await app.register(registerDidRouteRoutes);
    await app.register(registerReportingRoutes);
    await app.register(registerBillingRoutes);
    await app.register(registerCallRoutes);
    await app.register(registerPingRoutes);
    await app.register(registerPostRoutes);
    await app.register(registerAuthRoutes);

    await app.ready();
  });

  const generateToken = (
    userId: string,
    role: string,
    buyerId: string | null = null,
    publisherId: string | null = null
  ) => {
    return app.jwt.sign({
      userId,
      roles: [role],
      tenantId: 'tenant-1',
      buyerId,
      publisherId,
    });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 1: Static Inbound DID Call
  // ────────────────────────────────────────────────────────────────────────────
  it('Static inbound DID call: Resolves static DidRoute, creates attributed call, computes ledger rows, and asserts idempotency', async () => {
    // 1. FreeSWITCH Lookup DID
    const lookupResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      query: { did: '+18005550200', caller: '+15556667777' },
    });
    expect(lookupResponse.statusCode).toBe(200);
    const lookupData = JSON.parse(lookupResponse.body);
    expect(lookupData.destination).toBe('+18005559999');
    expect(lookupData.buyerId).toBe('buyer-a');

    // 2. FreeSWITCH CDR webhook posting
    const cdrResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      body: {
        callId: 'static-call-uuid-1',
        routeId: 'route-static',
        tenantId: 'tenant-1',
        callerNumber: '+15556667777',
        did: '+18005550200',
        destination: '+18005559999',
        duration: 90,
        connectedDuration: 85,
        hangupCause: 'NORMAL_CLEARING',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    expect(cdrResponse.statusCode).toBe(201);

    // 3. Billing calculation
    const call = mockPrismaData.calls[0];
    expect(call).toBeDefined();
    expect(call.did).toBe('+18005550200');
    expect(call.billable).toBe(true);

    const calcRes = await billingService.calculateCallBilling(call.id);
    expect(calcRes.success).toBe(true);

    const chargeRes = await buyerBillingService.processCallBilling(call.id);
    expect(chargeRes.success).toBe(true);

    // Check financial attributes
    const billedCall = mockPrismaData.calls[0];
    expect(Number(billedCall.buyerBillableAmount)).toBe(25.0); // Standard campaign price
    expect(Number(billedCall.publisherPayoutAmount)).toBe(10.0); // Campaign payout rate
    expect(Number(billedCall.cost)).toBeGreaterThanOrEqual(0); // Carrier cost
    expect(Number(billedCall.profit)).toBe(25.0 - 10.0 - Number(billedCall.cost));

    // Ledger Rows verification
    const ledgers = mockPrismaData.accrualLedgers;
    expect(ledgers.length).toBe(4);
    expect(ledgers.some(l => l.type === 'BUYER_REVENUE' && Number(l.amount) === 25.0)).toBe(true);
    expect(ledgers.some(l => l.type === 'PUBLISHER_PAYOUT' && Number(l.amount) === -10.0)).toBe(
      true
    );
    expect(
      ledgers.some(
        l => l.type === 'PLATFORM_PROFIT' && Number(l.amount) === Number(billedCall.profit)
      )
    ).toBe(true);

    // 4. Test Idempotency
    const originalTxCount = mockPrismaData.buyerTransactions.length;
    const originalLedgerCount = mockPrismaData.accrualLedgers.length;

    await billingService.calculateCallBilling(call.id);
    await buyerBillingService.processCallBilling(call.id);

    expect(mockPrismaData.buyerTransactions.length).toBe(originalTxCount);
    expect(mockPrismaData.accrualLedgers.length).toBe(originalLedgerCount);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 2: RTB Bidding & Routing Test
  // ────────────────────────────────────────────────────────────────────────────
  it('RTB Bidding/Routing: ping returns token, post leases did, lookup resolves Redis, and CDR attributes winner bid', async () => {
    // 1. Process Ping using auctionService
    const pingResult = await auctionService.processPing('pub-a', {
      request_id: 'ping-uuid-1',
      vertical: 'insurance',
      caller: { state: 'NY' },
      min_bid: 10,
    });
    expect(pingResult.bid).toBe(15.0); // Matches Target A basePrice
    expect(pingResult.token).toBeDefined();

    // 2. Process Post using postService
    const postResult = await postService.processPost(pingResult.token!, 'pub-a', '+15554443333');
    expect(postResult.accepted).toBe(true);
    expect(postResult.transfer_number).toBe('+18005550100');

    // Redis route details stored
    const redisRoute = JSON.parse(mockRedisData['route:did:+18005550100']);
    expect(redisRoute.ping_id).toBe(pingResult.ping_id);
    expect(redisRoute.buyer_id).toBe('buyer-a');
    expect(redisRoute.rtb_bid_amount).toBe(15.0);

    // 3. FreeSWITCH Lookup resolves Redis route before static DidRoute
    const lookupResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      query: { did: '+18005550100', caller: '+15554443333' },
    });
    expect(lookupResponse.statusCode).toBe(200);
    const lookupData = JSON.parse(lookupResponse.body);
    expect(lookupData.buyerId).toBe('buyer-a');
    expect(lookupData.routeType).toBe('RTB');

    // 4. CDR Post for Completed call
    const cdrResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      body: {
        callId: 'rtb-call-uuid-1',
        routeId: `rtb-${pingResult.ping_id}`,
        tenantId: 'tenant-1',
        callerNumber: '+15554443333',
        did: '+18005550100',
        destination: '+18005559999',
        duration: 80,
        connectedDuration: 70,
        hangupCause: 'NORMAL_CLEARING',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    expect(cdrResponse.statusCode).toBe(201);

    // Process RTB call billing
    const rtbCall = mockPrismaData.calls[mockPrismaData.calls.length - 1];

    await billingService.calculateCallBilling(rtbCall.id);
    await buyerBillingService.processCallBilling(rtbCall.id);

    // Assert billable amount uses the RTB bid instead of the campaign price
    expect(Number(rtbCall.buyerBillableAmount)).toBe(15.0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 3: Buyer Wallet Tests
  // ────────────────────────────────────────────────────────────────────────────
  it('Buyer Wallets: debits prepaid upfront wallet, pauses on zero balance, bypasses TERMS', async () => {
    // 1. UPFRONT Buyer debit validation
    const buyerA = mockPrismaData.buyers.find(b => b.id === 'buyer-a');
    expect(Number(buyerA.walletBalance)).toBe(100.0);

    const call1 = await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        buyerId: 'buyer-a',
        campaignId: 'camp-1',
        targetId: 'ep-a',
        did: '+18005550200',
        duration: 90,
        connectedDuration: 85,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25.00'),
        publisherPayoutAmount: new Prisma.Decimal('10.00'),
      },
    });

    await buyerBillingService.processCallBilling(call1.id);
    expect(Number(buyerA.walletBalance)).toBe(75.0);
    expect(buyerA.leadsRemaining).toBe(75);

    // Verify transaction
    const tx = mockPrismaData.buyerTransactions[0];
    expect(tx).toBeDefined();
    expect(tx.type).toBe('DEBIT');
    expect(Number(tx.amount)).toBe(-25.0);

    // 2. Insufficient wallet auto-pauses buyer
    buyerA.walletBalance = new Prisma.Decimal('5.00'); // set below call cost
    const call2 = await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        buyerId: 'buyer-a',
        campaignId: 'camp-1',
        targetId: 'ep-a',
        did: '+18005550200',
        duration: 90,
        connectedDuration: 85,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25.00'),
      },
    });

    const pauseRes = await buyerBillingService.processCallBilling(call2.id);
    expect(buyerA.status).toBe('PAUSED');

    // 3. TERMS Buyer bypasses wallet debiting
    const buyerB = mockPrismaData.buyers.find(b => b.id === 'buyer-b');
    const callB = await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        buyerId: 'buyer-b',
        campaignId: 'camp-1',
        targetId: 'ep-b',
        did: '+18005550200',
        // calculateCallBilling below RECOMPUTES billability, and treats a call
        // that is not COMPLETED/ANSWERED as unbillable. Without a status the
        // recompute overwrote the `billable: true` set here and the call came
        // out NOT_BILLABLE.
        status: 'COMPLETED',
        duration: 90,
        connectedDuration: 85,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25.00'),
      },
    });

    await billingService.calculateCallBilling(callB.id);
    await buyerBillingService.processCallBilling(callB.id);
    expect(Number(buyerB.walletBalance)).toBe(0.0); // Remains 0 since TERMS doesn't use upfront wallet
    const finalCallB = mockPrismaData.calls.find(c => c.id === callB.id);
    expect(finalCallB?.buyerChargeStatus).toBe('CHARGED');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 4: Publisher Scoping, Earnings, Reports & CSV
  // ────────────────────────────────────────────────────────────────────────────
  it('Publisher scoping: filters rows by publisherId, hides buyer metrics, and formats CSV correctly', async () => {
    // Add call records for Pub A and Pub B
    await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        publisherId: 'pub-a',
        publisherName: 'Publisher A',
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        did: '+18005550200',
        connectedDuration: 85,
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('10.00'),
        publisherPayoutStatus: 'PAYABLE',
        buyerBillableAmount: new Prisma.Decimal('25.00'),
        cost: new Prisma.Decimal('1.50'),
      },
    });

    await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        publisherId: 'pub-b',
        publisherName: 'Publisher B',
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        did: '+18005550200',
        connectedDuration: 80,
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('12.00'),
        publisherPayoutStatus: 'PAYABLE',
        buyerBillableAmount: new Prisma.Decimal('30.00'),
        cost: new Prisma.Decimal('1.80'),
      },
    });

    const pubToken = generateToken('usr-publisher-a', 'PUBLISHER', null, 'pub-a');

    // 1. JSON endpoint
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/publisher-revenue',
      headers: { Authorization: `Bearer ${pubToken}` },
    });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);

    // Scoped to Publisher A only
    expect(data.rows.length).toBe(1);
    expect(data.rows[0].publisherId).toBe('pub-a');
    // 4dp: this endpoint serialises every money field with toFixed(4)
    // (earnings, publisherRevenue, payoutRate, and the totals), matching the
    // scale money is stored at. Asserting '10.00' described a display format
    // the API has never returned.
    expect(data.rows[0].earnings).toBe('10.0000');

    // 2. CSV endpoint
    const csvResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/publisher-revenue/export.csv',
      headers: { Authorization: `Bearer ${pubToken}` },
    });
    expect(csvResponse.statusCode).toBe(200);
    const csvBody = csvResponse.body;
    expect(csvBody).toContain('Publisher A');
    expect(csvBody).not.toContain('Publisher B'); // properly filtered
    expect(csvBody).not.toContain('Buyer Cost'); // does not leak platform/buyer metrics
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 5: Buyer Scoping, Costs, Reports & CSV
  // ────────────────────────────────────────────────────────────────────────────
  it('Buyer scoping: filters rows by buyerId, hides publisher/profit metrics, uses buyer safe terminology', async () => {
    // Add call records for Buyer A and Buyer B
    await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        buyerId: 'buyer-a',
        buyerName: 'Buyer A',
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        targetNumber: '+18005559999',
        connectedDuration: 85,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25.00'),
        buyerChargeStatus: 'CHARGED',
        publisherPayoutAmount: new Prisma.Decimal('10.00'),
        cost: new Prisma.Decimal('1.50'),
      },
    });

    await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        buyerId: 'buyer-b',
        buyerName: 'Buyer B',
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        targetNumber: '+18005558888',
        connectedDuration: 80,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('30.00'),
        buyerChargeStatus: 'CHARGED',
        publisherPayoutAmount: new Prisma.Decimal('12.00'),
        cost: new Prisma.Decimal('1.80'),
      },
    });

    const buyerToken = generateToken('usr-buyer-a', 'BUYER', 'buyer-a', null);

    // 1. JSON endpoint
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/buyer-costs',
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);

    // Scoped to Buyer A only
    expect(data.rows.length).toBe(1);
    expect(data.rows[0].buyerId).toBe('buyer-a');
    expect(data.rows[0].buyerCost).toBe('25.0000');

    // 2. CSV endpoint
    const csvResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/buyer-costs/export.csv',
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(csvResponse.statusCode).toBe(200);
    const csvBody = csvResponse.body;
    expect(csvBody).toContain('Buyer A');
    expect(csvBody).not.toContain('Buyer B'); // properly filtered
    expect(csvBody).not.toContain('Publisher Payout'); // does not leak payout/carrier/profit metrics
    expect(csvBody).toContain('Cost'); // Uses buyer-safe terms
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 6: Admin Profitability & Reconciliation
  // ────────────────────────────────────────────────────────────────────────────
  it('Admin Profitability & Reconciliation: admin sees complete metrics and reconciliation matches call-level sums', async () => {
    // Add call records with payout and ledger entries
    const c1 = await mockPrisma.call.create({
      data: {
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        connectedDuration: 85,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25.00'),
        buyerChargeStatus: 'CHARGED',
        publisherPayoutAmount: new Prisma.Decimal('10.00'),
        publisherPayoutStatus: 'PAYABLE',
        cost: new Prisma.Decimal('1.50'),
        profit: new Prisma.Decimal('13.50'),
      },
    });

    // Create ledger entries for reconciliation matching
    await mockPrisma.accrualLedger.create({
      data: {
        tenantId: 'tenant-1',
        callId: c1.id,
        type: 'BUYER_REVENUE',
        amount: new Prisma.Decimal('25.00'),
      },
    });
    await mockPrisma.accrualLedger.create({
      data: {
        tenantId: 'tenant-1',
        callId: c1.id,
        type: 'PUBLISHER_PAYOUT',
        amount: new Prisma.Decimal('-10.00'),
      },
    });
    await mockPrisma.accrualLedger.create({
      data: {
        tenantId: 'tenant-1',
        callId: c1.id,
        type: 'CARRIER_COST',
        amount: new Prisma.Decimal('-1.50'),
      },
    });
    await mockPrisma.accrualLedger.create({
      data: {
        tenantId: 'tenant-1',
        callId: c1.id,
        type: 'PLATFORM_PROFIT',
        amount: new Prisma.Decimal('13.50'),
      },
    });

    const adminToken = generateToken('usr-admin', 'ADMIN');

    // 1. JSON endpoint Profitability
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/campaign-profitability',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);
    expect(data.rows[0].buyerRevenue).toBe('25.0000');
    expect(data.rows[0].profit).toBe('13.5000');

    // 2. Reconciliation report
    const reconResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reconciliation',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(reconResponse.statusCode).toBe(200);
    const reconData = JSON.parse(reconResponse.body);
    expect(reconData.summaries.calls.totalRevenue).toBe('25');
    expect(reconData.summaries.ledger.buyerRevenue).toBe('25');
    expect(reconData.mismatches.missingLedgerRows.buyerRevenue.length).toBe(0); // Valid data
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Case 7: Role-based Security
  // ────────────────────────────────────────────────────────────────────────────
  it('Role-Based Security: enforces role blocks and scoped row security on direct API access', async () => {
    const pubToken = generateToken('usr-publisher-a', 'PUBLISHER', null, 'pub-a');
    const buyerToken = generateToken('usr-buyer-a', 'BUYER', 'buyer-a', null);
    const agentToken = generateToken('usr-agent', 'AGENT');
    const readonlyToken = generateToken('usr-readonly', 'READONLY');

    // 1. Buyer A attempts to access reconciliation report
    const reconResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reconciliation',
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(reconResponse.statusCode).toBe(403);

    // 2. Publisher A attempts to access buyer-costs report
    const buyerCostsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/buyer-costs',
      headers: { Authorization: `Bearer ${pubToken}` },
    });
    expect(buyerCostsResponse.statusCode).toBe(403);

    // 3. Agent attempts to access profitability report
    const profitResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/campaign-profitability',
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(profitResponse.statusCode).toBe(403);
  });
});
