/**
 * API Server
 * Fastify-based REST API service for NexusAgent-Cluster
 */

import fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getOrchestrator } from '../orchestrator/Orchestrator.js';
import { getSkillManager } from '../skills/SkillManager.js';
import { getInputValidator } from '../security/InputValidator.js';
import { getBlackboard } from '../state/Blackboard.js';
import { EventType, getEventBus } from '../state/EventBus.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('APIServer');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
type ApiRequest = any;
type ApiReply = any;
type FastifyPluginInstance = any;
type WebsocketConnection = any;

export interface APIServerConfig {
  host?: string;
  port?: number;
  logger?: boolean;
  api?: {
    host?: string;
    port?: number;
  };
}

export class APIServer {
  private server: ReturnType<typeof fastify>;
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
    this.server.setErrorHandler((error: any, _request: ApiRequest, reply: ApiReply) => {
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
    const inputValidator = getInputValidator();

    try {
      // Serve static files (web interface)
      const webRoot = join(__dirname, '../../web');
      logger.info({ webRoot }, 'Registering static file serving');

      await this.server.register(staticPlugin, {
        root: webRoot,
        prefix: '/',
      });

      logger.info('Static file serving registered');

      // Serve index.html at root
      this.server.get('/', async (_request: ApiRequest, reply: ApiReply) => {
        return reply.sendFile('index.html');
      });

      // Health check
      this.server.get('/health', async (_request: ApiRequest, reply: ApiReply) => {
        reply.send({
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '4.2.0',
        });
      });

    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Failed to register routes');
      throw error;
    }

    // Task routes
    this.server.post('/api/v1/tasks/submit', async (request: ApiRequest, reply: ApiReply) => {
      try {
        const { user_input, session_id, context } = request.body as any;

        if (!user_input || typeof user_input !== 'string') {
          reply.code(400).send({
            success: false,
            error: 'Missing required field: user_input',
          });
          return;
        }

        const validation = inputValidator.validateUserInput(user_input, { isPrompt: true });
        if (!validation.valid) {
          reply.code(400).send({
            success: false,
            error: `Invalid user_input: ${validation.errors.join('; ')}`,
            data: {
              warnings: validation.warnings,
              riskLevel: validation.riskLevel,
            },
          });
          return;
        }

        const sessionId = session_id || `api-${Date.now()}`;
        const result = await this.orchestrator.processRequest({
          sessionId,
          userInput: validation.sanitized || user_input,
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
    this.server.get('/api/v1/tasks/:taskId', async (request: ApiRequest, reply: ApiReply) => {
      try {
        const { taskId } = request.params as { taskId: string };
        const blackboard = getBlackboard();
        const state = await blackboard.getStateByTask(taskId);

        if (!state) {
          reply.code(404).send({
            success: false,
            error: `Task not found: ${taskId}`,
          });
          return;
        }

        const taskState = state.tasks.get(taskId);
        reply.send({
          success: true,
          data: {
            taskId,
            sessionId: state.sessionId,
            task: taskState || null,
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
    this.server.get('/api/v1/sessions/:sessionId/tasks', async (request: ApiRequest, reply: ApiReply) => {
      try {
        const { sessionId } = request.params as { sessionId: string };
        const blackboard = getBlackboard();
        const state = await blackboard.getState(sessionId);

        if (!state) {
          reply.code(404).send({
            success: false,
            error: `Session not found: ${sessionId}`,
          });
          return;
        }

        reply.send({
          success: true,
          data: {
            sessionId,
            status: state.status,
            metrics: state.metrics,
            tasks: Array.from(state.tasks.values()),
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
    this.server.delete('/api/v1/tasks/:taskId', async (request: ApiRequest, reply: ApiReply) => {
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
    this.server.get('/api/v1/skills', async (_request: ApiRequest, reply: ApiReply) => {
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

    this.server.get('/api/v1/skills/:skillName', async (request: ApiRequest, reply: ApiReply) => {
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
    this.server.get('/api/v1/agents', async (_request: ApiRequest, reply: ApiReply) => {
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
    const eventBus = getEventBus();
    this.server.register(async function (fastify: FastifyPluginInstance) {
      fastify.get('/ws', { websocket: true }, (connection: WebsocketConnection, _req: ApiRequest) => {
        const socket: any = (connection as any)?.socket ?? connection;
        if (!socket || typeof socket.on !== 'function' || typeof socket.send !== 'function') {
          logger.error({ connectionType: typeof connection }, 'Invalid websocket connection object');
          return;
        }

        socket.on('message', async (message: any) => {
          let sessionIdForError: string | undefined;
          try {
            const data = JSON.parse(message.toString());
            sessionIdForError = data?.sessionId;

            if (data.type === 'task') {
              const sessionId = data.sessionId || `ws-${Date.now()}`;
              sessionIdForError = sessionId;
              const validation = inputValidator.validateUserInput(data.userInput || '', { isPrompt: true });

              if (!validation.valid) {
                socket.send(JSON.stringify({
                  type: 'error',
                  sessionId,
                  error: `Invalid user input: ${validation.errors.join('; ')}`,
                  warnings: validation.warnings,
                  riskLevel: validation.riskLevel,
                  timestamp: new Date().toISOString(),
                }));
                return;
              }

              socket.send(JSON.stringify({
                type: 'task.accepted',
                sessionId,
                timestamp: new Date().toISOString(),
              }));

              const publishProgress = (eventType: EventType, payload: any) => {
                if (payload?.sessionId !== sessionId) {
                  return;
                }
                socket.send(JSON.stringify({
                  type: 'task.progress',
                  eventType,
                  sessionId,
                  payload,
                  timestamp: new Date().toISOString(),
                }));
              };

              const onTaskUpdated = (payload: any) => publishProgress(EventType.TASK_UPDATED, payload);
              const onTaskCompleted = (payload: any) => publishProgress(EventType.TASK_COMPLETED, payload);
              const onTaskFailed = (payload: any) => publishProgress(EventType.TASK_FAILED, payload);
              const onSessionCompleted = (payload: any) => publishProgress(EventType.SESSION_COMPLETED, payload);
              const onSessionFailed = (payload: any) => publishProgress(EventType.SESSION_FAILED, payload);

              eventBus.on(EventType.TASK_UPDATED, onTaskUpdated);
              eventBus.on(EventType.TASK_COMPLETED, onTaskCompleted);
              eventBus.on(EventType.TASK_FAILED, onTaskFailed);
              eventBus.on(EventType.SESSION_COMPLETED, onSessionCompleted);
              eventBus.on(EventType.SESSION_FAILED, onSessionFailed);

              try {
                const result = await orchestrator.processRequest({
                  sessionId,
                  userInput: validation.sanitized || data.userInput,
                  context: data.context || {},
                });

                socket.send(JSON.stringify({
                  type: 'result',
                  sessionId,
                  data: result,
                }));
              } finally {
                eventBus.off(EventType.TASK_UPDATED, onTaskUpdated);
                eventBus.off(EventType.TASK_COMPLETED, onTaskCompleted);
                eventBus.off(EventType.TASK_FAILED, onTaskFailed);
                eventBus.off(EventType.SESSION_COMPLETED, onSessionCompleted);
                eventBus.off(EventType.SESSION_FAILED, onSessionFailed);
              }
            } else if (data.type === 'ping') {
              socket.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString(),
              }));
            }
          } catch (error: any) {
            logger.error({ error }, 'WebSocket message error');
            socket.send(JSON.stringify({
              type: 'error',
              sessionId: sessionIdForError,
              error: error.message,
            }));
          }
        });

        socket.on('close', () => {
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
