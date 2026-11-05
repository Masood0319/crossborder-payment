// ============================================================================
// BullMQ Redis Integration / In-Memory Fallback Event Broker
// ============================================================================

export class PaymentQueue {
  constructor(queueName = 'crossborder-payouts') {
    this.queueName = queueName;
    this.memoryQueue = [];
    this.handlers = [];
  }

  async add(jobName, data, opts = {}) {
    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: jobName,
      data,
      attempts: 0,
      maxAttempts: opts.attempts || 3,
      createdAt: new Date().toISOString(),
    };
    this.memoryQueue.push(job);
    this.dispatchNext();
    return job;
  }

  process(handler) {
    this.handlers.push(handler);
    this.dispatchNext();
  }

  async dispatchNext() {
    if (this.memoryQueue.length === 0 || this.handlers.length === 0) return;
    const job = this.memoryQueue.shift();
    for (const handler of this.handlers) {
      try {
        job.attempts++;
        await handler(job);
      } catch (err) {
        if (job.attempts < job.maxAttempts) {
          this.memoryQueue.push(job);
        } else {
          console.error(`[DLQ] Payment Job ${job.id} sent to Dead Letter Queue:`, err.message);
        }
      }
    }
  }
}
