/**
 * Logger Configuration
 * Structured logging with pino
 */

import pino from 'pino';

let logger: pino.Logger | null = null;

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
}

/**
 * Get configured logger instance
 */
export function getLogger(name: string, options: LoggerOptions = {}): pino.Logger {
  if (logger) {
    return logger;
  }

  const config = {
    level: options.level || process.env.LOG_LEVEL || 'info',
    ...(options.pretty !== false && process.env.NODE_ENV !== 'production'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  };

  logger = pino({
    ...config,
    base: { name },
  });

  return logger;
}

/**
 * Create a child logger with additional context
 */
export function childLogger(parent: pino.Logger, context: Record<string, any>): pino.Logger {
  return parent.child(context);
}
