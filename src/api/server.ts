/**
 * API Server
 * Fastify-based REST API and WebSocket server
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';
import { getOrchestrator } from '../orchestrator/Orchestrator.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { skillRoutes } from './routes/skills.js';
import { healthRoutes } from './routes/health.js';

const logger = getLogger('APIServer');

/**
 * Create and configure Fastify server
 */
export async function createServer(): Promise<FastifyInstance> {
  const config = loadConfig();
  const { host, port, corsOrigins } = config.api;

  const server = Fastify({
    logger: {
      level: config.monitoring.logLevel,
      prettyPrint: config.monitoring.logPretty,
    },
  });

  // Register CORS
  await server.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });

  // Register WebSocket
  await server.register(websocket);

  // Register routes
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(taskRoutes, { prefix: '/api/v1/tasks' });
  await server.register(agentRoutes, { prefix: '/api/v1/agents' });
  await server.register(skillRoutes, { prefix: '/api/v1/skills' });

  // Global error handler
  server.setErrorHandler(async (error, request, reply) => {
    logger.error(error, 'Request error');

    const statusCode = (error as any).statusCode || 500;
    reply.status(statusCode).send({
      error: (error as any).message || 'Internal server error',
      statusCode,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  });

  // Global not found handler
  server.setNotFoundHandler(async (request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
    });
  });

  // Request logging middleware
  server.addHook('onRequest', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
      },
      'Incoming request'
    );
  });

  // Response logging middleware
  server.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.getResponseTime(),
      },
      'Request completed'
    );
  });

  // Initialize orchestrator
  const orchestrator = getOrchestrator();
  await orchestrator.initialize();

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    await orchestrator.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  logger.info({ host, port }, 'API server created');

  return server;
}

/**
 * Start the API server
 */
export async function startServer(): Promise<void> {
  const server = await createServer();
  const config = loadConfig();
  const { host, port } = config.api;

  try {
    await server.listen({ port, host });
    logger.info({ host, port }, 'API server listening');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
}
