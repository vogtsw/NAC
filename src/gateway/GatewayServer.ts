/**
 * Gateway Server
 * WebSocket Gateway for multi-platform message routing (inspired by clawdbot)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createHttpServer } from 'http';
import { getOrchestrator } from '../orchestrator/Orchestrator.js';
import { getLogger } from '../monitoring/logger.js';
import { EventEmitter } from 'events';

const logger = getLogger('GatewayServer');

export interface GatewayConfig {
  port?: number;
  host?: string;
}

export interface GatewaySession {
  sessionId: string;
  platform: string;
  userId: string;
  connection: WebSocket;
  status: 'idle' | 'processing' | 'error';
  currentRunId?: string;
}

export interface StreamChunk {
  type: 'lifecycle' | 'assistant' | 'chat' | 'tick' | 'health';
  seq: number;
  run?: string;
  session?: string;
  stream?: string;
  aseq?: number;
  phase?: 'start' | 'end';
  text?: string;
  clients?: number;
  dropIfSlow?: boolean;
}

/**
 * Gateway Server - WebSocket Gateway for real-time communication
 */
export class GatewayServer extends EventEmitter {
  private wss: WebSocketServer;
  private port: number;
  private host: string;
  private sessions: Map<string, GatewaySession> = new Map();
  private orchestrator: any;
  private eventSeq: number = 0;
  private started: boolean = false;

  constructor(config: GatewayConfig = {}) {
    super();
    this.port = config.port || 18789;
    this.host = config.host || '127.0.0.1';

    // Create HTTP server
    const httpServer = createHttpServer();

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleError.bind(this));

    // Store HTTP server for listening
    (this as any).httpServer = httpServer;
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Gateway server already started');
      return;
    }

    // Initialize orchestrator
    this.orchestrator = getOrchestrator();
    await this.orchestrator.initialize();

    return new Promise((resolve, reject) => {
      (this as any).httpServer.listen(this.port, this.host, (err: any) => {
        if (err) {
          reject(err);
        } else {
          this.started = true;
          logger.info(`Gateway listening on ws://${this.host}:${this.port}`);

          // Start health ticker
          this.startHealthTicker();

          resolve();
        }
      });
    });
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.started = false;
        logger.info('Gateway server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: any) {
    const sessionId = this.generateSessionId();
    const platform = req.headers['x-platform'] || 'default';

    logger.info({ sessionId, platform }, 'New connection');

    const session: GatewaySession = {
      sessionId,
      platform,
      userId: 'unknown',
      connection: ws,
      status: 'idle',
    };

    this.sessions.set(sessionId, session);

    // Send welcome event
    this.sendEvent(sessionId, {
      type: 'health',
      seq: ++this.eventSeq,
      clients: this.sessions.size,
      presenceVersion: 1,
      healthVersion: 1,
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(sessionId, message);
      } catch (error: any) {
        logger.error({ error, sessionId }, 'Message handling error');
      }
    });

    ws.on('close', () => {
      logger.info({ sessionId }, 'Connection closed');
      this.sessions.delete(sessionId);
      this.sendEvent(sessionId, {
        type: 'health',
        seq: ++this.eventSeq,
        clients: this.sessions.size,
      });
    });

    ws.on('error', (error) => {
      logger.error({ error, sessionId }, 'WebSocket error');
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(sessionId: string, message: any) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { type, content, userId } = message;

    if (userId) {
      session.userId = userId;
    }

    if (type === 'chat' || type === 'message') {
      await this.processChatMessage(session, content);
    } else if (type === 'ping') {
      session.connection.send(JSON.stringify({ type: 'pong' }));
    }
  }

  /**
   * Process chat message through orchestrator
   */
  private async processChatMessage(session: GatewaySession, userInput: string) {
    const runId = this.generateRunId();
    session.currentRunId = runId;
    session.status = 'processing';

    // Send lifecycle start event
    this.sendEvent(session.sessionId, {
      type: 'lifecycle',
      seq: ++this.eventSeq,
      run: runId,
      session: `${session.platform}:${session.userId}`,
      stream: 'lifecycle',
      phase: 'start',
    });

    try {
      // Process through orchestrator with streaming callback
      const result = await this.orchestrator.processRequest({
        sessionId: session.sessionId,
        userInput,
        context: {
          userId: session.userId,
          platform: session.platform,
          streaming: true,
          onChunk: (chunk: string) => {
            // Send streaming text chunks
            this.sendEvent(session.sessionId, {
              type: 'assistant',
              seq: ++this.eventSeq,
              run: runId,
              session: `${session.platform}:${session.userId}`,
              stream: 'assistant',
              text: chunk,
            });
          },
        },
      });

      // Send lifecycle end event
      this.sendEvent(session.sessionId, {
        type: 'lifecycle',
        seq: ++this.eventSeq,
        run: runId,
        session: `${session.platform}:${session.userId}`,
        stream: 'lifecycle',
        phase: 'end',
      });

      session.status = 'idle';
      session.currentRunId = undefined;

      logger.info({
        sessionId: session.sessionId,
        runId,
        duration: 'completed',
      }, 'Chat completed');

    } catch (error: any) {
      logger.error({ error, runId }, 'Chat processing failed');
      session.status = 'error';

      this.sendEvent(session.sessionId, {
        type: 'lifecycle',
        seq: ++this.eventSeq,
        run: runId,
        session: `${session.platform}:${session.userId}`,
        stream: 'lifecycle',
        phase: 'end',
      });
    }
  }

  /**
   * Send event to specific session or broadcast to all
   */
  private sendEvent(sessionId: string, event: StreamChunk) {
    const session = this.sessions.get(sessionId);

    if (session && session.connection.readyState === WebSocket.OPEN) {
      session.connection.send(JSON.stringify(event));
    }

    // Emit for any listeners
    this.emit('event', { sessionId, event });
  }

  /**
   * Broadcast event to all sessions
   */
  broadcast(event: StreamChunk) {
    const data = JSON.stringify(event);
    for (const [sessionId, session] of this.sessions) {
      if (session.connection.readyState === WebSocket.OPEN) {
        session.connection.send(data);
      }
    }
  }

  /**
   * Start health ticker (sends periodic health events)
   */
  private startHealthTicker() {
    const tickInterval = setInterval(() => {
      if (!this.started) {
        clearInterval(tickInterval);
        return;
      }

      this.broadcast({
        type: 'tick',
        seq: ++this.eventSeq,
        clients: this.sessions.size,
        dropIfSlow: true,
      });
    }, 30000); // Every 30 seconds

    // Send health every minute
    const healthInterval = setInterval(() => {
      if (!this.started) {
        clearInterval(healthInterval);
        return;
      }

      this.broadcast({
        type: 'health',
        seq: ++this.eventSeq,
        clients: this.sessions.size,
        presenceVersion: 1,
        healthVersion: Math.floor(Date.now() / 1000),
      });
    }, 60000);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(error: Error) {
    logger.error({ error }, 'WebSocket server error');
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique run ID
   */
  private generateRunId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): GatewaySession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}

// Singleton instance
let gatewayServer: GatewayServer | null = null;

export function getGatewayServer(config?: GatewayConfig): GatewayServer {
  if (!gatewayServer) {
    gatewayServer = new GatewayServer(config);
  }
  return gatewayServer;
}

export function createGatewayServer(config?: GatewayConfig): GatewayServer {
  return new GatewayServer(config);
}
