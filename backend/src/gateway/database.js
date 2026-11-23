function withTimeout(operation, timeoutMs, code, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} timed out`), { code }));
    }, timeoutMs);
    Promise.resolve(operation).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function verifyPrismaConnection(prisma, timeoutMs = 10000) {
  await withTimeout(prisma.$connect(), timeoutMs, 'ETIMEDOUT', 'Database connection');
  return withTimeout(
    prisma.$queryRaw`SELECT 1 AS connection_test`,
    timeoutMs,
    'ETIMEDOUT',
    'Database readiness query'
  );
}

export function verifyPrismaReadiness(prisma, timeoutMs = 3000) {
  return withTimeout(
    prisma.$queryRaw`SELECT 1`,
    timeoutMs,
    'ETIMEDOUT',
    'Database readiness query'
  );
}
