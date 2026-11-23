import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, validateBackendEnvironment } from './gateway/server.js';
import { verifyPrismaConnection } from './gateway/database.js';
import { loadBackendEnvironment } from './gateway/environment.js';

loadBackendEnvironment();

let starting = false;
let activeRuntime = null;

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

function safeStartupError(error) {
  const code = error?.code || error?.errorCode || 'CONFIGURATION';
  const messages = {
    P1000: 'Database authentication failed; check the configured database credentials.',
    P1001: 'Prisma could not reach the configured database host and port.',
    P1002: 'Database connection timed out; check endpoint availability and connection limits.',
    P1011: 'Prisma could not establish TLS; check SSL mode and certificate validation.',
    ENOTFOUND: 'DNS could not resolve the database hostname.',
    ECONNREFUSED: 'The database host refused the TCP connection.',
    ETIMEDOUT: 'The database connection timed out.',
    EADDRINUSE: 'The configured backend port is already in use.',
  };
  if (messages[code]) return { code, message: messages[code] };
  const message = error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]')
    : 'Backend startup failed due to invalid configuration or an unavailable dependency.';
  return { code, message };
}

export async function startBackend({
  environment = process.env,
  serverFactory = createServer,
} = {}) {
  if (starting || activeRuntime) {
    throw new Error('Backend server has already been started');
  }
  starting = true;

  let prisma;
  let server;
  try {
    validateBackendEnvironment(environment);
    const { app, prisma: prismaClient } = serverFactory();
    prisma = prismaClient;
    await verifyPrismaConnection(prisma);

    const port = Number(environment.PORT || 5001);
    const host = environment.HOST || '0.0.0.0';
    server = await new Promise((resolve, reject) => {
      const listeningServer = createHttpServer(app);
      listeningServer.once('error', reject);
      listeningServer.listen(port, host, () => resolve(listeningServer));
    });

    let shutdownPromise;
    const shutdown = () => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        try {
          await closeHttpServer(server);
        } finally {
          try {
            await prisma.$disconnect();
          } finally {
            activeRuntime = null;
          }
        }
        console.log('[SERVER] Backend stopped cleanly');
      })();
      return shutdownPromise;
    };

    activeRuntime = { server, prisma, shutdown };
    console.log(`[SERVER] Cross-Border Payment API ready on port ${server.address().port}`);
    return activeRuntime;
  } catch (error) {
    if (server?.listening) await closeHttpServer(server).catch(() => {});
    if (prisma) await prisma.$disconnect().catch(() => {});
    const safeError = safeStartupError(error);
    console.error(`[SERVER] Startup failed (${safeError.code}): ${safeError.message}`);
    throw error;
  } finally {
    starting = false;
  }
}

async function main() {
  const runtime = await startBackend();
  const stop = () => {
    runtime.shutdown().catch(error => {
      const safeError = safeStartupError(error);
      console.error(`[SERVER] Shutdown failed (${safeError.code}): ${safeError.message}`);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
