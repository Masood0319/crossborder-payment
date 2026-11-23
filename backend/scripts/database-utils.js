import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyPrismaConnection } from '../src/gateway/database.js';
import { loadBackendEnvironment } from '../src/gateway/environment.js';

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

loadBackendEnvironment();

export function databaseEndpointInfo(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }

  return {
    hostname: url.hostname,
    database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    credentialsPresent: Boolean(url.username && url.password),
    sslMode: url.searchParams.get('sslmode') || 'default',
    pooledEndpoint: url.hostname.includes('-pooler'),
  };
}

export function safeDatabaseError(error) {
  const code = error?.code || error?.errorCode || 'UNKNOWN';
  const messages = {
    P1000: 'Database authentication failed; check the configured database credentials.',
    P1001: 'Prisma could not reach the configured database host and port.',
    P1002: 'The database connection timed out; check endpoint availability and connection limits.',
    P1011: 'Prisma could not establish TLS; check SSL mode and certificate validation.',
    ENOTFOUND: 'DNS could not resolve the database hostname.',
    ECONNREFUSED: 'The database host refused the TCP connection.',
    ETIMEDOUT: 'The database connection timed out.',
    '28P01': 'PostgreSQL rejected the configured credentials.',
    '3D000': 'The configured PostgreSQL database does not exist.',
  };
  return { code, message: messages[code] || 'Database operation failed; use the error code to investigate.' };
}

export async function verifyDatabaseConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = databaseEndpointInfo(databaseUrl);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const result = await verifyPrismaConnection(prisma);
    return { endpoint, result };
  } finally {
    await prisma.$disconnect();
  }
}

export function prismaCliPath() {
  const packagePath = require.resolve('prisma/package.json');
  return path.join(path.dirname(packagePath), 'build', 'index.js');
}

export function redactCliOutput(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]')
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
