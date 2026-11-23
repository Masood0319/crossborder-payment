const allowedTransitions = new Map([
  ['INITIATED', new Set(['VALIDATING', 'FAILED', 'CANCELLED'])],
  ['VALIDATING', new Set(['QUOTED', 'REJECTED', 'FAILED', 'CANCELLED'])],
  ['QUOTED', new Set(['FUNDS_DEBITED', 'FAILED', 'CANCELLED'])],
  ['FUNDS_DEBITED', new Set(['SUBMITTED', 'SIMULATED', 'FAILED', 'CANCELLED'])],
  ['SUBMITTED', new Set(['ACCEPTED', 'REJECTED', 'FAILED'])],
  ['ACCEPTED', new Set(['SETTLED', 'RETURNED'])],
  ['SETTLED', new Set(['RETURNED'])],
  ['SIMULATED', new Set(['REVERSED'])],
]);

export const TRANSFER_STATUSES = Object.freeze([
  'INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED',
  'ACCEPTED', 'SETTLED', 'FAILED', 'REJECTED', 'RETURNED',
  'CANCELLED', 'SIMULATED', 'REVERSED',
]);

export const TERMINAL_TRANSFER_STATUSES = Object.freeze([
  'SETTLED', 'FAILED', 'REJECTED', 'RETURNED', 'CANCELLED', 'SIMULATED', 'REVERSED',
]);

export function assertTransferTransition(fromStatus, toStatus) {
  const allowed = fromStatus === null
    ? toStatus === 'INITIATED'
    : allowedTransitions.get(fromStatus)?.has(toStatus);
  if (!allowed) {
    throw new Error(`Invalid transfer status transition: ${fromStatus ?? 'NEW'} -> ${toStatus}`);
  }
}

export async function transitionTransfer(tx, transferId, fromStatus, toStatus, reason, actorType = 'SYSTEM') {
  assertTransferTransition(fromStatus, toStatus);
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 255) {
    throw new Error('A transfer status transition reason between 1 and 255 characters is required');
  }

  const updated = await tx.transfer.updateMany({
    where: { id: transferId, status: fromStatus },
    data: { status: toStatus },
  });
  if (updated.count !== 1) {
    if (typeof tx.transfer.findUnique === 'function') {
      const current = await tx.transfer.findUnique({
        where: { id: transferId },
        select: { status: true },
      });
      if (current?.status === toStatus && typeof tx.transferStatusEvent.findFirst === 'function') {
        const existing = await tx.transferStatusEvent.findFirst({
          where: { transferId, fromStatus, toStatus, reason: reason.trim(), actorType },
          orderBy: [{ sequenceOrder: 'asc' }],
        });
        if (existing) return existing;
      }
    }
    throw new Error(`Transfer ${transferId} status changed concurrently or was not found`);
  }

  const latestEvent = await tx.transferStatusEvent.aggregate({
    where: { transferId },
    _max: { sequenceOrder: true },
  });
  return tx.transferStatusEvent.create({
    data: {
      transferId,
      sequenceOrder: (latestEvent._max.sequenceOrder ?? 0) + 1,
      fromStatus,
      toStatus,
      reason: reason.trim(),
      actorType,
    },
  });
}

export function getTransferStatusPresentation(status) {
  const presentations = {
    INITIATED: { label: 'Request received', tone: 'neutral', description: 'Your simulated transfer request has been received.', action: 'CREATED' },
    VALIDATING: { label: 'Checking details', tone: 'processing', description: 'The beneficiary and quote are being validated.', action: 'IN_PROGRESS' },
    QUOTED: { label: 'Quote validated', tone: 'processing', description: 'An owned FX quote is ready for this simulation.', action: 'IN_PROGRESS' },
    FUNDS_DEBITED: { label: 'Wallet debit recorded', tone: 'processing', description: 'The simulated wallet debit and ledger posting are complete.', action: 'IN_PROGRESS' },
    SUBMITTED: { label: 'Processing simulation', tone: 'processing', description: 'The simulated provider instruction is being processed.', action: 'IN_PROGRESS' },
    ACCEPTED: { label: 'Accepted for simulation', tone: 'processing', description: 'The demo instruction was accepted by the simulation; no bank settlement is verified.', action: 'IN_PROGRESS' },
    SETTLED: { label: 'Verified simulation complete', tone: 'success', description: 'A verified simulated final state was recorded.', action: 'COMPLETED' },
    SIMULATED: { label: 'Demo instruction prepared', tone: 'success', description: 'The transfer is complete as a simulation. No bank or real-money settlement occurred.', action: 'COMPLETED' },
    FAILED: { label: 'Transfer failed', tone: 'danger', description: 'The simulated transfer failed. Your ledger and idempotency records remain available for investigation.', action: 'INTERVENTION' },
    REJECTED: { label: 'Transfer rejected', tone: 'danger', description: 'The simulated provider or compliance engine rejected this transfer.', action: 'INTERVENTION' },
    REQUIRES_REVIEW: { label: 'Review required', tone: 'warning', description: 'This record requires authorized staff review before a safe outcome can be recorded.', action: 'INTERVENTION' },
    RETURNED: { label: 'Funds returned', tone: 'warning', description: 'The simulated transfer was recorded as returned.', action: 'COMPLETED' },
    CANCELLED: { label: 'Transfer cancelled', tone: 'neutral', description: 'The transfer was cancelled and no further simulation should reopen it.', action: 'CANCELLED' },
    REVERSED: { label: 'Transfer reversed', tone: 'warning', description: 'A simulated reversal was recorded without changing the ledger accounting model.', action: 'REVERSED' },
  };
  return presentations[status] || {
    label: 'Status unavailable',
    tone: 'neutral',
    description: 'The latest transfer status could not be presented.',
    action: 'UNKNOWN',
  };
}

function safeDescription(reason) {
  if (typeof reason !== 'string') return 'Lifecycle status recorded';
  const cleaned = reason.replace(/^DEMO_MODE:\s*/i, '').replace(/\b(?:password|secret|token|authorization)\b[=:][^\s,;]+/gi, '[redacted]').trim();
  return cleaned.slice(0, 255) || 'Lifecycle status recorded';
}

export function buildTransferLifecycle(transfer) {
  const statusEvents = Array.isArray(transfer?.statusEvents)
    ? [...transfer.statusEvents].sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0))
    : [];
  const timelineEvents = statusEvents.map(event => ({
    eventType: 'STATUS_TRANSITION',
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus,
    timestamp: event.createdAt ? new Date(event.createdAt).toISOString() : null,
    description: safeDescription(event.reason),
    source: event.actorType || 'SYSTEM',
    correlationId: transfer.uetr ?? null,
    sequenceOrder: event.sequenceOrder,
  }));

  if (Array.isArray(transfer?.timeline)) {
    for (const item of transfer.timeline) {
      if (!item || typeof item !== 'object') continue;
      const timestamp = typeof item.completedAt === 'string'
        ? item.completedAt
        : typeof item.timestamp === 'string'
          ? item.timestamp
          : null;
      timelineEvents.push({
        eventType: typeof item.step === 'string' ? item.step : 'TRANSFER_EVENT',
        fromStatus: null,
        toStatus: item.status === 'COMPLETED' ? 'COMPLETED' : transfer.status,
        timestamp,
        description: safeDescription(item.label),
        source: item.actorType || item.source || 'SYSTEM',
        correlationId: transfer.uetr ?? null,
        sequenceOrder: null,
        details: item.step === 'ROUTE_SELECTED' ? {
          selectedRoute: item.routingDecision?.selectedRoute?.providerAdapter?.id ?? null,
          strategy: item.routingDecision?.strategy ?? null,
          executionMode: item.routingDecision?.executionMode || 'SIMULATED',
        } : undefined,
      });
    }
  }

  timelineEvents.sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
    return at - bt || (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0);
  });

  return {
    currentStatus: transfer?.status ?? 'UNKNOWN',
    presentation: getTransferStatusPresentation(transfer?.status),
    terminal: TERMINAL_TRANSFER_STATUSES.includes(transfer?.status),
    timeline: timelineEvents,
  };
}
