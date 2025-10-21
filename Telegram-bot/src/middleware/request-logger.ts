import { Request, Response, NextFunction } from 'express';
import { Logger } from '../services/logger';

interface RequestLogData {
  method: string;
  url: string;
  ip: string;
  userAgent: string;
  responseTime: number;
  statusCode: number;
  contentLength?: number;
  userId?: string;
  adminId?: string;
}

/**
 * Enhanced request logging middleware with structured logging
 * Provides detailed request/response logging with security context
 */
class RequestLogger {
  private static instance: RequestLogger;
  private readonly logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): RequestLogger {
    if (!RequestLogger.instance) {
      RequestLogger.instance = new RequestLogger();
    }
    return RequestLogger.instance;
  }

  /**
   * Express middleware for structured request logging
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const originalJson = res.json;
      let responseBody: any = null;

      // Capture response body for logging (only for errors and important endpoints)
      res.json = function(body: any) {
        if (res.statusCode >= 400 || req.path.includes('/auth/') || req.path.includes('/admin/')) {
          responseBody = body;
        }
        return originalJson.call(this, body);
      };

      // Log request completion
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const logData: RequestLogData = {
          method: req.method,
          url: req.originalUrl || req.url,
          ip: this.getClientIP(req),
          userAgent: req.get('User-Agent') || 'unknown',
          responseTime,
          statusCode: res.statusCode,
          contentLength: res.get('Content-Length') ? parseInt(res.get('Content-Length')!) : undefined,
          userId: (req as any).userId,
          adminId: (req as any).adminId
        };

        // Log based on status code and response time
        if (res.statusCode >= 500) {
          this.logger.error('Server Error Request', {
            ...logData,
            requestBody: this.sanitizeRequestBody(req.body),
            responseBody: responseBody,
            headers: this.sanitizeHeaders(req.headers)
          });
        } else if (res.statusCode >= 400) {
          this.logger.warn('Client Error Request', {
            ...logData,
            requestBody: this.sanitizeRequestBody(req.body),
            responseBody: responseBody
          });
        } else if (responseTime > 1000) {
          this.logger.warn('Slow Request', {
            ...logData,
            performance: {
              threshold: '1000ms',
              actual: `${responseTime}ms`
            }
          });
        } else if (this.shouldLogInfo(req)) {
          this.logger.info('Request Completed', logData);
        } else {
          this.logger.debug('Request Completed', logData);
        }
      });

      next();
    };
  }

  /**
   * Get real client IP address
   */
  private getClientIP(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
           req.headers['x-real-ip'] as string ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
  }

  /**
   * Determine if request should be logged at info level
   */
  private shouldLogInfo(req: Request): boolean {
    // Log auth, admin, and API endpoints at info level
    return req.path.includes('/auth/') ||
           req.path.includes('/admin/') ||
           req.path.includes('/api/') ||
           req.method !== 'GET' ||
           req.query.debug === 'true';
  }

  /**
   * Sanitize request body for logging (remove sensitive data)
   */
  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization', 'cookie'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  private sanitizeHeaders(headers: any): any {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    const sanitized = { ...headers };

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Create request context for other middleware
   */
  public createRequestContext() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Add request ID for tracing
      const requestId = this.generateRequestId();
      (req as any).requestId = requestId;
      res.setHeader('X-Request-ID', requestId);

      // Add request start time
      (req as any).startTime = Date.now();

      next();
    };
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export default RequestLogger;