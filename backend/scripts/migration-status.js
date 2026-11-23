import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  backendRoot,
  prismaCliPath,
  redactCliOutput,
  safeDatabaseError,
  verifyDatabaseConnection,
} from './database-utils.js';

try {
  const { endpoint } = await verifyDatabaseConnection();
  console.log(`Database connection verified: ${JSON.stringify(endpoint)}`);
} catch (error) {
  const safeError = safeDatabaseError(error);
  console.error(`Migration status unavailable (${safeError.code}): ${safeError.message}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  prismaCliPath(),
  'migrate',
  'status',
  '--schema',
  path.join(backendRoot, 'prisma', 'schema.prisma'),
], {
  cwd: backendRoot,
  env: process.env,
  encoding: 'utf8',
  timeout: 30000,
  maxBuffer: 1024 * 1024,
});

if (result.stdout) process.stdout.write(redactCliOutput(result.stdout));
if (result.stderr) process.stderr.write(redactCliOutput(result.stderr));
if (result.error) {
  console.error(`Prisma migration status command failed: ${result.error.code || 'UNKNOWN'}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
