import { createHash } from 'node:crypto';
import express from 'express';
import { CORRIDOR_CONFIGURATIONS, MOCK_INTERBANK_RATES } from '../treasury/corridor-rates.js';
import { FxTreasuryEngine } from '../treasury/fx-engine.js';
import { makeStaffAuthMiddleware } from './staff-auth.js';

const treasuryViewerRoles = ['TREASURY_VIEWER', 'TREASURY_OPERATOR', 'TREASURY_ADMIN'];
const treasuryOperatorRoles = ['TREASURY_OPERATOR', 'TREASURY_ADMIN'];

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function actorRole(identity) {
  return ['TREASURY_ADMIN', 'TREASURY_OPERATOR', 'TREASURY_VIEWER']
    .find(role => identity.roles.includes(role));
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
