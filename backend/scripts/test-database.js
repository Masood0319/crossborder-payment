import { safeDatabaseError, verifyDatabaseConnection } from './database-utils.js';

try {
  const { endpoint, result } = await verifyDatabaseConnection();
  console.log(`Database endpoint: ${JSON.stringify(endpoint)}`);
  console.log(`Prisma connection and read-only query succeeded: ${JSON.stringify(result)}`);
} catch (error) {
  const safeError = safeDatabaseError(error);
  console.error(`Prisma connection test failed (${safeError.code}): ${safeError.message}`);
  process.exitCode = 1;
}
