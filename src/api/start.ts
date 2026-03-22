/**
 * API server startup entrypoint.
 */

import { getAPIServer } from './server.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('APIServer-Start');

async function hasHealthyService(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    } as any);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const port = parseInt(process.env.API_PORT || '3000', 10);
  const host = process.env.API_HOST || '0.0.0.0';

  const apiServer = getAPIServer({ port, host });

  try {
    logger.info('Initializing API server...');
    await apiServer.initialize();

    logger.info('Starting API server...');
    await apiServer.start();

    logger.info('');
    logger.info('==========================================');
    logger.info('  NAC API server is running');
    logger.info('==========================================');
    logger.info('');
    logger.info(`  URL:    http://localhost:${port}`);
    logger.info(`  Health: http://localhost:${port}/health`);
    logger.info(`  API:    http://localhost:${port}/api/v1`);
    logger.info('');
    logger.info('  Press Ctrl+C to stop');
    logger.info('==========================================');
    logger.info('');

    process.on('SIGINT', async () => {
      logger.info('Shutting down API server...');
      await apiServer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down API server...');
      await apiServer.stop();
      process.exit(0);
    });
  } catch (error: any) {
    if (error?.code === 'EADDRINUSE') {
      const healthy = await hasHealthyService(port);
      if (healthy) {
        logger.warn(`Port ${port} is already in use, detected healthy API service. Reusing existing service.`);
        logger.info(`Visit: http://localhost:${port}`);
        process.exit(0);
        return;
      }
    }

    logger.error({ error }, 'Failed to start API server');
    logger.error('');
    logger.error('Possible reasons:');
    logger.error(`  1. Port ${port} is occupied`);
    logger.error('  2. .env is missing or invalid');
    logger.error('  3. Dependencies are not installed (run `pnpm install`)');
    logger.error('');
    process.exit(1);
  }
}

main();

