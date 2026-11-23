import { createHash } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { CORRIDOR_CONFIGURATIONS, MOCK_INTERBANK_RATES } from '../treasury/corridor-rates.js';
import { FxTreasuryEngine } from '../treasury/fx-engine.js';
import { makeStaffAuthMiddleware } from './staff-auth.js';
import { getSimulatedProviderAdapterSummaries } from '../routing/simulated-provider-adapters.js';
import { buildTransferLifecycle } from './transfer-lifecycle.js';

const treasuryViewerRoles = ['TREASURY_VIEWER', 'TREASURY_OPERATOR', 'TREASURY_ADMIN'];
const treasuryOperatorRoles = ['TREASURY_OPERATOR', 'TREASURY_ADMIN'];
const pendingTransferStatuses = ['INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED', 'ACCEPTED'];
const transferStatuses = [
  'INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED', 'ACCEPTED',
  'SETTLED', 'FAILED', 'REJECTED', 'RETURNED', 'CANCELLED', 'SIMULATED', 'REVERSED',
];
const operationsFilterSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(100).optional(),
  status: z.enum(transferStatuses).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  corridor: z.enum(Object.keys(CORRIDOR_CONFIGURATIONS)).optional(),
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function actorRole(identity) {
  return ['TREASURY_ADMIN', 'TREASURY_OPERATOR', 'TREASURY_VIEWER']
    .find(role => identity.roles.includes(role));
}

function summarizeRouting(rows) {
  const providerCounts = new Map();
  const corridorCounts = new Map();
  const rejectionCounts = new Map();
  for (const { transfer, decision } of rows) {
    const providerId = decision.selectedRoute?.providerAdapter?.id;
    if (providerId) providerCounts.set(providerId, (providerCounts.get(providerId) || 0) + 1);
    const corridor = corridorCounts.get(transfer.corridorCode) || { corridorCode: transfer.corridorCode, count: 0, selectedProviders: {} };
    corridor.count += 1;
    if (providerId) corridor.selectedProviders[providerId] = (corridor.selectedProviders[providerId] || 0) + 1;
    corridorCounts.set(transfer.corridorCode, corridor);
    for (const rejected of decision.rejectedRoutes || []) {
      for (const reason of rejected.rejectionReasons || []) {
        const key = `${rejected.providerAdapter?.id || 'UNKNOWN'}:${reason}`;
        rejectionCounts.set(key, (rejectionCounts.get(key) || 0) + 1);
      }
    }
  }
  return {
    providerSelections: [...providerCounts].map(([providerId, count]) => ({ providerId, count })).sort((a, b) => a.providerId.localeCompare(b.providerId)),
    corridorPerformance: [...corridorCounts.values()].sort((a, b) => a.corridorCode.localeCompare(b.corridorCode)),
    routeRejections: [...rejectionCounts].map(([key, count]) => {
      const [providerId, reason] = key.split(':');
      return { providerId, reason, count };
    }).sort((a, b) => b.count - a.count || a.providerId.localeCompare(b.providerId)),
  };
}

function auditOperationsAccess(prisma, req, subjectType, subjectId = 'current') {
  return prisma.treasuryAuditEvent.create({
    data: {
      eventType: 'TREASURY_ACCESS',
      subjectType,
      subjectId,
      actorId: req.staffIdentity.reviewerId,
      actorRole: actorRole(req.staffIdentity),
    },
  });
}

function serializedGroups(groups, key) {
  return groups.map(group => ({
    [key]: group[key],
    count: group._count._all,
    sendAmount: String(group._sum.sendAmount ?? '0'),
    feeAmount: group._sum.feeAmount == null ? undefined : String(group._sum.feeAmount),
  }));
}

function stableAlertId(alert) {
  const identity = [
    alert.bankCode,
    alert.currency,
    alert.thresholdType,
    alert.currentBalance,
    alert.availableBalance,
    alert.rebalanceAmountRequired,
  ].join(':');
  const bytes = createHash('sha256').update(identity).digest('hex').slice(0, 32).split('');
  bytes[12] = '5';
  bytes[16] = (8 | (Number.parseInt(bytes[16], 16) & 3)).toString(16);
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createTreasuryRouter({ prisma, staffTokenVerifier } = {}) {
  if (!prisma) throw new Error('Prisma client is required for treasury routes');

  const router = express.Router();
  const fxEngine = new FxTreasuryEngine();
  const authenticateTreasuryViewer = makeStaffAuthMiddleware(
    treasuryViewerRoles,
    staffTokenVerifier
  );
  const authenticateTreasuryOperator = makeStaffAuthMiddleware(
    treasuryOperatorRoles,
    staffTokenVerifier
  );

  router.get('/operations/summary', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const now = new Date();
    const [
      totalTransfers,
      successfulSimulatedTransfers,
      pendingTransfers,
      failedTransfers,
      corridorGroups,
      currencyGroups,
      pendingKycApplications,
      availableFxQuotes,
      recentTransferEvents,
      recentTreasuryEvents,
      routedTransfers,
    ] = await Promise.all([
      prisma.transfer.count(),
      prisma.transfer.count({ where: { status: 'SIMULATED' } }),
      prisma.transfer.count({ where: { status: { in: pendingTransferStatuses } } }),
      prisma.transfer.count({ where: { status: { in: ['FAILED', 'REJECTED'] } } }),
      prisma.transfer.groupBy({
        by: ['corridorCode'],
        _count: { _all: true },
        _sum: { sendAmount: true, feeAmount: true },
      }),
      prisma.transfer.groupBy({
        by: ['sourceCurrency'],
        _count: { _all: true },
        _sum: { sendAmount: true, feeAmount: true },
      }),
      prisma.user.count({ where: { kycStatus: 'PENDING' } }),
      prisma.fxQuote.count({ where: { state: 'ACTIVE', expiresAt: { gt: now } } }),
      prisma.transferStatusEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          actorType: true,
          createdAt: true,
          transfer: { select: { uetr: true, corridorCode: true } },
        },
      }),
      prisma.treasuryAuditEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: { id: true, eventType: true, subjectType: true, subjectId: true, actorRole: true, createdAt: true },
      }),
      prisma.transfer.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        select: { id: true, uetr: true, corridorCode: true, status: true, createdAt: true, timeline: true },
      }),
    ]);

    await auditOperationsAccess(prisma, req, 'OPERATIONS_SUMMARY');
    const routingRows = routedTransfers.flatMap(transfer => {
      const event = Array.isArray(transfer.timeline)
        ? transfer.timeline.find(item => item?.step === 'ROUTE_SELECTED')
        : null;
      return event?.routingDecision ? [{ transfer, decision: event.routingDecision }] : [];
    });
    return res.json({
      generatedAt: now.toISOString(),
      executionMode: 'SIMULATED',
      totals: {
        totalTransfers,
        successfulSimulatedTransfers,
        pendingTransfers,
        failedTransfers,
        pendingKycApplications,
        availableFxQuotes,
      },
      corridorStatistics: serializedGroups(corridorGroups, 'corridorCode'),
      currencyStatistics: serializedGroups(currencyGroups, 'sourceCurrency'),
      recentActivity: recentTransferEvents.map(event => ({
        id: event.id,
        type: 'TRANSFER_STATUS',
        reference: event.transfer.uetr,
        corridor: event.transfer.corridorCode,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actorType: event.actorType,
        createdAt: event.createdAt,
      })),
      recentTreasuryActivity: recentTreasuryEvents.map(event => ({
        id: event.id,
        type: event.eventType,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        actorRole: event.actorRole,
        createdAt: event.createdAt,
      })),
      routingAnalytics: summarizeRouting(routingRows),
    });
  }));

  router.get('/operations/transfers', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const parsed = operationsFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid transfer filters or pagination values' });
    const { page, pageSize, query, status, currency, corridor } = parsed.data;
    const where = {
      ...(status ? { status } : {}),
      ...(corridor ? { corridorCode: corridor } : {}),
    };
    const andConditions = [];
    if (currency) andConditions.push({ OR: [{ sourceCurrency: currency }, { payoutCurrency: currency }] });
    if (query) {
      const searchConditions = [{ transaction: { is: { reference: { contains: query, mode: 'insensitive' } } } }];
      if (z.string().uuid().safeParse(query).success) searchConditions.push({ uetr: query });
      andConditions.push({ OR: searchConditions });
    }
    if (andConditions.length) where.AND = andConditions;

    const [transfers, total] = await Promise.all([
      prisma.transfer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          uetr: true,
          corridorCode: true,
          sourceCurrency: true,
          sendAmount: true,
          feeAmount: true,
          payoutCurrency: true,
          payoutAmount: true,
          status: true,
          createdAt: true,
          user: { select: { kycStatus: true } },
          statusEvents: {
            take: 1,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { reason: true, createdAt: true, actorType: true },
          },
        },
      }),
      prisma.transfer.count({ where }),
    ]);
    await auditOperationsAccess(prisma, req, 'OPERATIONS_TRANSFER_LIST');
    return res.json({
      transfers,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  }));

  router.get('/operations/transfers/:transferId', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const transferId = z.string().uuid().safeParse(req.params.transferId);
    if (!transferId.success) return res.status(400).json({ error: 'transferId must be a UUID' });
    const transfer = await prisma.transfer.findUnique({
      where: { id: transferId.data },
      select: {
        id: true,
        uetr: true,
        corridorCode: true,
        sourceCurrency: true,
        sendAmount: true,
        feeAmount: true,
        payoutCurrency: true,
        payoutAmount: true,
        exchangeRate: true,
        status: true,
        purpose: true,
        createdAt: true,
        timeline: true,
        beneficiary: { select: { fullName: true, country: true } },
        user: { select: { kycStatus: true } },
        statusEvents: {
          orderBy: [{ sequenceOrder: 'asc' }],
          select: { id: true, sequenceOrder: true, fromStatus: true, toStatus: true, reason: true, actorType: true, createdAt: true },
        },
        transaction: {
          select: {
            reference: true,
            status: true,
            reversalReason: true,
            reversedAt: true,
            isoAuditLogs: {
              orderBy: [{ createdAt: 'asc' }],
              select: { messageId: true, messageType: true, status: true, createdAt: true },
            },
            callbackInbox: {
              orderBy: [{ receivedAt: 'asc' }],
              select: { source: true, messageId: true, transactionStatus: true, processingStatus: true, processingError: true, receivedAt: true },
            },
          },
        },
      },
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    const corridor = await prisma.corridor.findUnique({
      where: { code: transfer.corridorCode },
      select: { sourceRail: true, destinationRail: true, isActive: true },
    });
    await auditOperationsAccess(prisma, req, 'OPERATIONS_TRANSFER_DETAIL', transfer.id);
    return res.json({
      transfer,
      lifecycle: buildTransferLifecycle(transfer),
      routingDecision: Array.isArray(transfer.timeline)
        ? transfer.timeline.find(item => item?.step === 'ROUTE_SELECTED')?.routingDecision ?? null
        : null,
      routing: corridor
        ? { corridorCode: transfer.corridorCode, ...corridor, executionMode: 'SIMULATED' }
        : { corridorCode: transfer.corridorCode, executionMode: 'SIMULATED', configurationAvailable: false },
    });
  }));

  router.get('/routing/analytics', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const transfers = await prisma.transfer.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1000,
      select: { id: true, uetr: true, corridorCode: true, status: true, createdAt: true, timeline: true },
    });
    const rows = transfers.flatMap(transfer => {
      const event = Array.isArray(transfer.timeline)
        ? transfer.timeline.find(item => item?.step === 'ROUTE_SELECTED')
        : null;
      return event?.routingDecision ? [{ transfer, decision: event.routingDecision }] : [];
    });
    await auditOperationsAccess(prisma, req, 'ROUTING_ANALYTICS');
    return res.json({
      executionMode: 'SIMULATED',
      sampleSize: rows.length,
      maximumRecordsScanned: 1000,
      providers: getSimulatedProviderAdapterSummaries(),
      ...summarizeRouting(rows),
      recentDecisions: rows.slice(0, 20).map(({ transfer, decision }) => ({
        transferId: transfer.id,
        uetr: transfer.uetr,
        corridorCode: transfer.corridorCode,
        status: transfer.status,
        createdAt: transfer.createdAt,
        strategy: decision.strategy,
        selectedRoute: decision.selectedRoute,
        alternatives: decision.alternatives,
        rejectedRoutes: decision.rejectedRoutes,
        decisionReason: decision.decisionReason,
      })),
    });
  }));

  router.get('/fx/quotes', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const now = new Date();
    const quotes = await prisma.fxQuote.findMany({
      where: { state: 'ACTIVE', expiresAt: { gt: now } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        quoteId: true,
        corridorCode: true,
        sourceCurrency: true,
        targetCurrency: true,
        instructedAmount: true,
        settlementAmount: true,
        midMarketRate: true,
        clientRate: true,
        spreadBps: true,
        volatilityBufferBps: true,
        spreadRevenue: true,
        rateProvider: true,
        rateObservedAt: true,
        expiresAt: true,
      },
    });
    await auditOperationsAccess(prisma, req, 'OPERATIONS_FX_QUOTES');
    return res.json({ quotes, generatedAt: now.toISOString(), rateSource: 'Persisted quote records; provider labels identify static/demo rates where applicable' });
  }));

  router.get('/liquidity/alerts', authenticateTreasuryViewer, asyncRoute(async (req, res) => {
    const balances = await prisma.nostroVostroBalance.findMany({
      orderBy: [{ bankCode: 'asc' }, { currency: 'asc' }],
      select: {
        bankCode: true,
        bankName: true,
        currency: true,
        currentBalance: true,
        reservedBalance: true,
        availableBalance: true,
        minimumThreshold: true,
        maximumThreshold: true,
        targetBalance: true,
      },
    });
    const alerts = fxEngine.evaluateLiquidityAlerts(balances).map(alert => ({
      ...alert,
      alertId: stableAlertId(alert),
    }));
    const corridors = Object.values(CORRIDOR_CONFIGURATIONS).map(corridor => {
      const feed = MOCK_INTERBANK_RATES[`${corridor.sourceCurrency}/${corridor.targetCurrency}`];
      return {
        code: corridor.code,
        sourceCurrency: corridor.sourceCurrency,
        targetCurrency: corridor.targetCurrency,
        baseSpreadBps: corridor.baseSpreadBps,
        volatilityBufferBps: corridor.volatilityBufferBps,
        quoteTtlSeconds: corridor.quoteTtlSeconds,
        isConfigured: true,
        rateProvider: 'STATIC_DEMO',
        midMarketRate: feed?.midMarketRate ?? null,
        rateObservedAt: feed?.timestamp ?? null,
      };
    });

    await prisma.treasuryAuditEvent.create({
      data: {
        eventType: 'TREASURY_ACCESS',
        subjectType: 'LIQUIDITY_ALERTS',
        subjectId: 'current',
        actorId: req.staffIdentity.reviewerId,
        actorRole: actorRole(req.staffIdentity),
        details: { alertCount: alerts.length, corridorCount: corridors.length },
      },
    });

    if (alerts.length > 0) {
      await prisma.treasuryAuditEvent.createMany({
        data: alerts.map(alert => ({
          eventType: 'TREASURY_ACCESS',
          subjectType: 'LIQUIDITY_ALERT',
          subjectId: alert.alertId,
          actorId: req.staffIdentity.reviewerId,
          actorRole: actorRole(req.staffIdentity),
          details: alert,
        })),
      });
    }

    const acknowledgements = alerts.length > 0
      ? await prisma.treasuryAuditEvent.findMany({
        where: {
          eventType: 'LIQUIDITY_ALERT_ACKNOWLEDGED',
          subjectType: 'LIQUIDITY_ALERT',
          subjectId: { in: alerts.map(alert => alert.alertId) },
        },
        select: { subjectId: true },
      })
      : [];
    const acknowledgedIds = new Set(acknowledgements.map(event => event.subjectId));

    return res.json({
      balances,
      corridors,
      alerts: alerts.map(alert => ({
        ...alert,
        acknowledged: acknowledgedIds.has(alert.alertId),
      })),
    });
  }));

  router.post(
    '/liquidity/alerts/:alertId/acknowledge',
    authenticateTreasuryOperator,
    asyncRoute(async (req, res) => {
      const { alertId } = req.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alertId)) {
        return res.status(400).json({ error: 'A valid alert ID is required' });
      }

      const observedAlert = await prisma.treasuryAuditEvent.findFirst({
        where: { eventType: 'TREASURY_ACCESS', subjectType: 'LIQUIDITY_ALERT', subjectId: alertId },
        select: { id: true },
      });
      if (!observedAlert) return res.status(404).json({ error: 'Liquidity alert not found' });

      const existingAcknowledgement = await prisma.treasuryAuditEvent.findFirst({
        where: {
          eventType: 'LIQUIDITY_ALERT_ACKNOWLEDGED',
          subjectType: 'LIQUIDITY_ALERT',
          subjectId: alertId,
        },
        select: { id: true },
      });
      if (existingAcknowledgement) {
        return res.status(409).json({ error: 'Liquidity alert has already been acknowledged' });
      }

      const acknowledgement = await prisma.treasuryAuditEvent.create({
        data: {
          eventType: 'LIQUIDITY_ALERT_ACKNOWLEDGED',
          subjectType: 'LIQUIDITY_ALERT',
          subjectId: alertId,
          actorId: req.staffIdentity.reviewerId,
          actorRole: actorRole(req.staffIdentity),
        },
      });

      return res.status(201).json({ acknowledged: true, acknowledgementId: acknowledgement.id });
    })
  );

  router.use((error, _req, res, _next) => {
    console.error('[TREASURY_API_ERROR]', error);
    return res.status(500).json({ error: 'The treasury request could not be completed' });
  });

  return router;
}
