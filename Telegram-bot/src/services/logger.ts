import winston from 'winston';
import path from 'path';
import fs from 'fs-extra';
import { config } from '../config';
import TransportStream from 'winston-transport';

// Database error logger will be lazy-loaded to avoid circular dependencies
let databaseErrorLogger: any = null;

class Logger {
  private logger!: winston.Logger;
  
  constructor() {
    this.initialize();
  }

  private initialize(): void {
    // Determine if all logging should be disabled (no console, no files)
    const disableEnv = (process.env.DISABLE_LOGS || process.env.LOG_DISABLE || '').toLowerCase() === 'true';
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const explicitLevel = (process.env.LOG_LEVEL || '').toLowerCase();
    const consoleExplicitLevel = (process.env.LOG_CONSOLE_LEVEL || '').toLowerCase();
    const effectiveLevel = explicitLevel || (isProd ? 'info' : 'debug');
    const consoleLevel = consoleExplicitLevel || (isProd ? 'warn' : effectiveLevel);
    const silentLevel = explicitLevel === 'silent' || (isProd && disableEnv);

    if (silentLevel || disableEnv) {
      // Create a completely silent logger with no transports and do not touch the filesystem
      this.logger = winston.createLogger({ level: 'silent', transports: [], silent: true, exitOnError: false });
      return;
    }

    const logDir = config.paths.logs;
    fs.ensureDirSync(logDir);

    const traceFormat = winston.format((info) => {
      try {
        const { getTraceId } = require('./trace');
        const t = getTraceId();
        if (t) info.trace_id = t;
      } catch {}
      return info;
    });

    const logFormat = winston.format.combine(
      traceFormat(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaString = '';
        if (Object.keys(meta).length > 0) {
          metaString = `\n${JSON.stringify(meta, null, 2)}`;
        }
        return `${timestamp} [${level}]: ${message}${metaString}`;
      })
    );

    const transports: winston.transport[] = [];

    // Console transport (disabled in production)
    if (!isProd) {
      transports.push(new winston.transports.Console({
        format: consoleFormat,
        level: consoleLevel,
      }));
    }

    // Database transport for errors only
    class DatabaseTransport extends TransportStream {
      constructor(opts?: any) {
        super(opts);
      }

      log(info: any, callback: () => void) {
        setImmediate(() => this.emit('logged', info));
        
        // Only save error level logs to database
        if (info.level === 'error') {
          // Lazy load to avoid circular dependency
          if (!databaseErrorLogger) {
            try {
              const module = require('./database-error-logger.service');
              databaseErrorLogger = module.databaseErrorLogger;
            } catch (err) {
              // Database logger not available yet
              callback();
              return;
            }
          }

          // Save to database async (don't wait)
          databaseErrorLogger.logError(info).catch((err: any) => {
            console.error('Failed to save error to database:', err?.message);
          });
        }
        
        callback();
      }
    }

    transports.push(new DatabaseTransport({ level: 'error' }));

    // File transports (only if enabled)
    if (config.logging.fileEnabled) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          format: logFormat,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'app.log'),
          format: logFormat,
          maxsize: 5242880,
          maxFiles: 10,
          level: effectiveLevel,
        })
      );
    }

    this.logger = winston.createLogger({
      level: effectiveLevel,
      format: logFormat,
      transports,
      exitOnError: false,
    });

    if (config.isDev) {
      this.logger.debug('Logger initialized in development mode');
    }
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  fatal(message: string, meta?: any): void {
    this.logger.error(`FATAL: ${message}`, meta);
  }

  log(level: string, message: string, meta?: any): void {
    this.logger.log(level, message, meta);
  }

  createChild(defaultMeta: any): winston.Logger {
    return this.logger.child(defaultMeta);
  }

  profile(id: string): void {
    this.logger.profile(id);
  }

  startTimer(): { done: (info?: any) => void } {
    return this.logger.startTimer();
  }

  query(options: winston.QueryOptions, callback: (err: any, results: any) => void): void {
    this.logger.query(options, callback);
  }

  stream(options?: any): any {
    return this.logger.stream(options);
  }

  /**
   * Static method to get the singleton instance
   * @returns Logger instance
   */
  static getInstance(): Logger {
    return logger;
  }
}

// Singleton instance
export const logger = new Logger();

/**
 * Create a named logger instance with context
 * @param name - Logger name/context
 * @returns Child logger with the specified name
 */
export function createLogger(name: string): winston.Logger {
  return logger.createChild({ service: name });
}

/**
 * Legacy error logging function for backward compatibility
 * @param level - Log level
 * @param message - Log message
 * @param error - Optional error object
 * @param context - Optional context object
 */
export function logError(level: string, message: string, error?: any, context: Record<string, any> = {}): void {
  const logData = {
    ...context,
    ...(error && { error: error.stack || error.message || error })
  };
  
  switch (level.toLowerCase()) {
    case 'error':
      logger.error(message, logData);
      break;
    case 'warn':
    case 'warning':
      logger.warn(message, logData);
      break;
    case 'info':
      logger.info(message, logData);
      break;
    case 'debug':
      logger.debug(message, logData);
      break;
    default:
      logger.info(message, logData);
  }
}

export { Logger };
export default logger;