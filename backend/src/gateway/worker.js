// ============================================================================
// Asynchronous Payout Queue Worker
// ============================================================================

export function setupPayoutWorker(paymentQueue, dispatchPartnerPayoutFn) {
  paymentQueue.process(async job => {
    console.log(`[WORKER] Processing asynchronous payment job: ${job.id} (${job.name})`);
    const { payoutInstruction } = job.data;
    const result = await dispatchPartnerPayoutFn(payoutInstruction);
    console.log(`[WORKER] Successfully dispatched payout for UETR ${payoutInstruction.uetr}: Rail Ref: ${result.clearingSystemRef}`);
    return result;
  });
}
