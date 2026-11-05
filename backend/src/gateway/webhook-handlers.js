// ============================================================================
// Bank Webhook Handlers (Inbound Raast Notification & Outbound GCC Dispatch)
// ============================================================================

export function createWebhookHandler(orchestrator, partnerSecret) {
  return async function handlePartnerCallback(req) {
    const { uetr, transactionStatus, originalEndToEndId } = req.body;
    console.log(`[WEBHOOK] Received partner bank callback for UETR: ${uetr}, Status: ${transactionStatus}`);

    return {
      received: true,
      uetr,
      acknowledgedAt: new Date().toISOString(),
    };
  };
}

export async function dispatchPartnerPayout(payoutInstruction) {
  return {
    cleared: true,
    rail: payoutInstruction.corridorCode.endsWith('_AE') ? 'AANI_UAE' : 'SARIE_KSA',
    clearingSystemRef: `FPS-${Date.now().toString().slice(-8)}`,
    payoutDisbursedAt: new Date().toISOString(),
  };
}
