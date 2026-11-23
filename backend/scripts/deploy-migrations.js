import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  backendRoot,
  prismaCliPath,
  redactCliOutput,
  safeDatabaseError,
  verifyDatabaseConnection,
} from './database-utils.js';

function runPrisma(args) {
  return spawnSync(process.execPath, [
    prismaCliPath(),
    ...args,
    '--schema',
    path.join(backendRoot, 'prisma', 'schema.prisma'),
  ], {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
}

try {
  const { endpoint } = await verifyDatabaseConnection();
  console.log(`Database connection verified: ${JSON.stringify(endpoint)}`);
} catch (error) {
  const safeError = safeDatabaseError(error);
  console.error(`Migration deployment stopped (${safeError.code}): ${safeError.message}`);
  process.exit(1);
}

const status = runPrisma(['migrate', 'status']);
if (status.stdout) process.stdout.write(redactCliOutput(status.stdout));
if (status.stderr) process.stderr.write(redactCliOutput(status.stderr));
if (status.error) {
  console.error(`Prisma migration status command failed: ${status.error.code || 'UNKNOWN'}`);
  process.exit(1);
}

const statusOutput = `${status.stdout || ''}\n${status.stderr || ''}`;
const hasPendingMigrations = /have not yet been applied|not yet applied/i.test(statusOutput);
if (status.status !== 0 && !hasPendingMigrations) {
  console.error('Migration deployment stopped because Prisma could not determine migration status.');
  process.exit(1);
}
if (!hasPendingMigrations) {
  console.log('Database migration status is up to date; no deployment was needed.');
  process.exit(0);
}
if (process.env.CONFIRM_MIGRATION_DEPLOY !== 'YES') {
  console.error('No migrations were applied. Review each pending migration, then set CONFIRM_MIGRATION_DEPLOY=YES to deploy.');
  process.exit(2);
}

const result = runPrisma(['migrate', 'deploy']);
if (result.stdout) process.stdout.write(redactCliOutput(result.stdout));
if (result.stderr) process.stderr.write(redactCliOutput(result.stderr));
if (result.error) {
  console.error(`Prisma migration deployment failed: ${result.error.code || 'UNKNOWN'}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
