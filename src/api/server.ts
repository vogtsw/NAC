/**
 * API Server
 * Fastify-based REST API service for NexusAgent-Cluster
 */

import fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { getOrchestrator } from '../orchestrator/Orchestrator.js';
import { getSkillManager } from '../skills/SkillManager.js';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('APIServer');

const config = loadConfig();

export interface APIServerConfig {
  host?: string;
  port?: number;
  logger?: boolean;
}

export class APIServer {
  private server: any;
  private orchestrator: any;
  private skillManager: any;
  private config: APIServerConfig;

  constructor(config: APIServerConfig = {}) {
    this.config = {
      host: config.host || config.api?.host || '0.0.0.0',
      port: config.port || config.api?.port || 3000,
      logger: config.logger ?? true,
    };

    this.server = fastify({
      logger: this.config.logger,
    });
  }

  /**
   * Initialize the API server
   */
  async initialize(): Promise<void> {
    logger.info('API server: Starting initialization...');

    // Register websocket plugin
    logger.info('API server: Registering websocket plugin...');
    await this.server.register(websocketPlugin);
    logger.info('API server: Websocket plugin registered');

    // Initialize core components
    logger.info('API server: Getting orchestrator...');
    this.orchestrator = getOrchestrator();
    logger.info('API server: Initializing orchestrator...');
    await this.orchestrator.initialize();
    logger.info('API server: Orchestrator initialized');

    logger.info('API server: Getting skill manager...');
    this.skillManager = getSkillManager();
    logger.info('API server: Initializing skill manager...');
    await this.skillManager.initialize();
    logger.info('API server: Skill manager initialized');

    // Register routes
    logger.info('API server: Registering routes...');
    await this.registerRoutes();
    logger.info('API server: Routes registered');

    // Register error handler
    this.server.setErrorHandler((error, request, reply) => {
      logger.error({ error }, 'Request error');
      reply.code(error.statusCode || 500).send({
        success: false,
        error: error.message,
      });
    });

    logger.info('API server initialized');
  }

  /**
   * Register all routes
   */
  private async registerRoutes(): Promise<void> {
    // Health check
    this.server.get('/health', async (request, reply) => {
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.1.0',
      });
    });

    // Task routes
    this.server.post('/api/v1/tasks/submit', async (request, reply) => {
      try {
        const { user_input, session_id, context } = request.body as any;

        if (!user_input) {
          reply.code(400).send({
            success: false,
            error: 'Missing required field: user_input',
          });
          return;
        }

        const sessionId = session_id || `api-${Date.now()}`;
        const result = await this.orchestrator.processRequest({
          sessionId,
          userInput: user_input,
          context: context || {},
        });

        reply.send({
          success: true,
          data: {
            session_id: sessionId,
            result,
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Task submission failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // Get task status
    this.server.get('/api/v1/tasks/:taskId', async (request, reply) => {
      try {
        const { taskId } = request.params as { taskId: string };

        // TODO: Implement task status retrieval
        reply.send({
          success: true,
          data: {
            taskId,
            status: 'not_implemented',
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Get task status failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // Get session tasks
    this.server.get('/api/v1/sessions/:sessionId/tasks', async (request, reply) => {
      try {
        const { sessionId } = request.params as { sessionId: string };

        // TODO: Implement session task list retrieval
        reply.send({
          success: true,
          data: {
            sessionId,
            tasks: [],
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Get session tasks failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // Cancel task
    this.server.delete('/api/v1/tasks/:taskId', async (request, reply) => {
      try {
        const { taskId } = request.params as { taskId: string };

        const cancelled = await this.orchestrator.cancelTask(taskId);

        reply.send({
          success: cancelled,
          data: {
            taskId,
            message: cancelled ? 'Task cancelled' : 'Task not found',
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Cancel task failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // Skills routes
    this.server.get('/api/v1/skills', async (request, reply) => {
      try {
        const skills = this.skillManager.listSkills();
        reply.send({
          success: true,
          data: {
            skills,
            total: skills.length,
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Get skills failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    this.server.get('/api/v1/skills/:skillName', async (request, reply) => {
      try {
        const { skillName } = request.params as { skillName: string };
        const skill = this.skillManager.getSkill(skillName);

        if (!skill) {
          reply.code(404).send({
            success: false,
            error: `Skill not found: ${skillName}`,
          });
          return;
        }

        reply.send({
          success: true,
          data: skill,
        });
      } catch (error: any) {
        logger.error({ error }, 'Get skill failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // Agents routes
    this.server.get('/api/v1/agents', async (request, reply) => {
      try {
        const agents = await this.orchestrator.getActiveAgents();
        reply.send({
          success: true,
          data: {
            agents,
            total: agents.length,
          },
        });
      } catch (error: any) {
        logger.error({ error }, 'Get agents failed');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    });

    // WebSocket route
    const orchestrator = this.orchestrator;
    this.server.register(async function (fastify) {
      fastify.get('/ws', { websocket: true }, (connection, req) => {
        connection.socket.on('message', async (message) => {
          try {
            const data = JSON.parse(message.toString());

            if (data.type === 'task') {
              const result = await orchestrator.processRequest({
                sessionId: data.sessionId || `ws-${Date.now()}`,
                userInput: data.userInput,
                context: data.context || {},
              });

              connection.socket.send(JSON.stringify({
                type: 'result',
                sessionId: result.sessionId || data.sessionId,
                data: result,
              }));
            } else if (data.type === 'ping') {
              connection.socket.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString(),
              }));
            }
          } catch (error: any) {
            logger.error({ error }, 'WebSocket message error');
            connection.socket.send(JSON.stringify({
              type: 'error',
              error: error.message,
            }));
          }
        });

        connection.socket.on('close', () => {
          logger.info('WebSocket connection closed');
        });
      });
    });

    logger.info('Routes registered');
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    try {
      await this.listen();
      logger.info(`API server listening on ${this.config.host}:${this.config.port}`);
    } catch (error: any) {
      logger.error({ error }, 'Failed to start API server');
      throw error;
    }
  }

  /**
   * Listen for connections
   */
  private async listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen({ port: this.config.port, host: this.config.host }, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    try {
      await this.server.close();
      await this.orchestrator.shutdown();
      logger.info('API server stopped');
    } catch (error: any) {
      logger.error({ error }, 'Error stopping API server');
    }
  }

  /**
   * Get the Fastify instance
   */
  getServer() {
    return this.server;
  }
}

// Singleton instance
let apiServer: APIServer | null = null;

export function getAPIServer(config?: APIServerConfig): APIServer {
  if (!apiServer) {
    apiServer = new APIServer(config);
  }
  return apiServer;
}

export function createAPIServer(config?: APIServerConfig): APIServer {
  return new APIServer(config);
}
