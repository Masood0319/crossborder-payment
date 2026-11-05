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
