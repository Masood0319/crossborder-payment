import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { loadBackendEnvironment } from '../src/gateway/environment.js';

const require = createRequire(import.meta.url);
loadBackendEnvironment();

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return 'unavailable';
  }
}

function describeError(error) {
  const code = error?.code || error?.errorCode || 'UNKNOWN';
  const messages = {
    P1000: 'Database authentication failed. Verify the database username and password.',
    P1001: 'Prisma could not reach the configured database host and port.',
    P1002: 'The database connection timed out. Check endpoint availability and connection limits.',
    P1011: 'Prisma could not establish a TLS connection. Check SSL mode and certificate validation.',
    ENOTFOUND: 'DNS could not resolve the database hostname.',
    ECONNREFUSED: 'The database host refused the TCP connection.',
    ETIMEDOUT: 'The database connection timed out.',
    '28P01': 'PostgreSQL rejected the database credentials.',
    '3D000': 'The configured PostgreSQL database does not exist.',
    SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate verification failed; use the provider CA chain and do not disable certificate validation.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'The TLS certificate does not match the database hostname.',
  };
  return { code, message: messages[code] || 'See the error code and verify database configuration.' };
}

function printResult(name, result) {
  console.log(`${name}: ${JSON.stringify(result)}`);
}

const report = {
  nodeVersion: process.version,
  prismaCliVersion: packageVersion('prisma'),
  prismaClientVersion: packageVersion('@prisma/client'),
};
printResult('runtime', report);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  printResult('configuration', {
    databaseUrlPresent: false,
    error: 'DATABASE_URL is missing. Set it in backend/.env or the process environment.',
  });
  process.exitCode = 1;
} else {
  let url;
  try {
    url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('Unsupported database protocol');
    }
  } catch {
    printResult('configuration', {
      databaseUrlPresent: true,
      validPostgresUrl: false,
      error: 'DATABASE_URL is not a valid PostgreSQL URL.',
    });
    process.exitCode = 1;
  }

  if (url) {
    const sslMode = url.searchParams.get('sslmode');
    const host = url.hostname;
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(host);
    const sslConfigured = Boolean(sslMode && sslMode !== 'disable') || url.searchParams.has('ssl');
    printResult('configuration', {
      databaseUrlPresent: true,
      hostname: host,
      database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
      credentialsPresent: Boolean(url.username && url.password),
      sslConfigured,
      sslMode: sslMode || (url.searchParams.has('ssl') ? 'ssl parameter configured' : 'not specified'),
      neonPooledEndpoint: host.includes('-pooler'),
    });

    try {
      const addresses = await dns.lookup(host, { all: true, verbatim: true });
      printResult('dns', addresses.map(({ address, family }) => ({ address, family })));
    } catch (error) {
      printResult('dns', { error: describeError(error) });
      process.exitCode = 1;
    }

    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      await prisma.$connect();
      const result = await prisma.$queryRaw`SELECT 1 AS connection_test`;
      printResult('prisma', { connected: true, readOnlyQuery: result });
    } catch (error) {
      printResult('prisma', { connected: false, error: describeError(error) });
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect().catch(() => {});
    }

    const { Client } = pg;
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10000,
      ...(sslConfigured ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    try {
      await client.connect();
      const result = await client.query('SELECT 1 AS connection_test');
      printResult('postgres-driver', {
        connected: true,
        readOnlyQuery: result.rows,
        tlsEncrypted: Boolean(client.connection.stream.encrypted),
      });
    } catch (error) {
      printResult('postgres-driver', { connected: false, error: describeError(error) });
      process.exitCode = 1;
    } finally {
      await client.end().catch(() => {});
    }
  }
}
