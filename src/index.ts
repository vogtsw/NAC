/**
 * Main Entry Point
 * Start the API server
 */

import 'dotenv/config';
import { startServer } from './api/server.js';
import { getLogger } from './monitoring/logger.js';

const logger = getLogger('index');

async function main() {
  logger.info('Starting NexusAgent-Cluster...');

  try {
    await startServer();
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
