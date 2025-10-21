/**
 * Unified Response Handler Service
 * Consolidates all duplicate error handling patterns across controllers
 */

import { Request, Response } from 'express';
import { Logger } from './logger';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: string[];
  message?: string;
  timestamp: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ErrorDetails {
  message: string;
  code?: string;
  field?: string;
  details?: any;
}

export type HttpStatusCode = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/**
 * Unified Response Handler for consistent API responses
 */
export class ResponseHandler {
  private static instance: ResponseHandler;
  private readonly logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): ResponseHandler {
    if (!ResponseHandler.instance) {
      ResponseHandler.instance = new ResponseHandler();
    }
    return ResponseHandler.instance;
  }

  /**
   * Send successful response
   */
  success<T>(
    res: Response, 
    data?: T, 
    message?: string, 
    statusCode: HttpStatusCode = 200,
    meta?: ApiResponse['meta']
  ): void {
    const response: ApiResponse<T> = {
      success: true,
      timestamp: new Date().toISOString()
    };

    if (data !== undefined) {
      response.data = data;
    }

    if (message) {
      response.message = message;
    }

    if (meta) {
      response.meta = meta;
    }

    res.status(statusCode).json(response);
  }

  /**
   * Send created response (201)
   */
  created<T>(res: Response, data?: T, message?: string): void {
    this.success(res, data, message, 201);
  }

  /**
   * Send error response
   */
  error(
    res: Response,
    statusCode: HttpStatusCode,
    error: string | ErrorDetails | ErrorDetails[],
    logMessage?: string,
    logError?: any
  ): void {
    // Log the error
    if (logMessage || logError) {
      if (statusCode >= 500) {
        this.logger.error(logMessage || 'Server error:', logError || error);
      } else if (statusCode >= 400) {
        this.logger.warn(logMessage || 'Client error:', logError || error);
      }
    }

    const response: ApiResponse = {
      success: false,
      timestamp: new Date().toISOString()
    };

    if (typeof error === 'string') {
      response.error = error;
    } else if (Array.isArray(error)) {
      response.errors = error.map(e => e.message);
      response.error = error.length > 0 ? error[0].message : 'Validation failed';
    } else {
      response.error = error.message;
      if (error.field) {
        response.errors = [`${error.field}: ${error.message}`];
      }
    }

    res.status(statusCode).json(response);
  }

  /**
   * Send bad request error (400)
   */
  badRequest(res: Response, error: string | ErrorDetails[], logMessage?: string): void {
    this.error(res, 400, error, logMessage);
  }

  /**
   * Send unauthorized error (401)
   */
  unauthorized(res: Response, error: string = 'Unauthorized access', logMessage?: string): void {
    this.error(res, 401, error, logMessage);
  }

  /**
   * Send forbidden error (403)
   */
  forbidden(res: Response, error: string = 'Forbidden access', logMessage?: string): void {
    this.error(res, 403, error, logMessage);
  }

  /**
   * Send not found error (404)
   */
  notFound(res: Response, error: string = 'Resource not found', logMessage?: string): void {
    this.error(res, 404, error, logMessage);
  }

  /**
   * Send conflict error (409)
   */
  conflict(res: Response, error: string, logMessage?: string): void {
    this.error(res, 409, error, logMessage);
  }

  /**
   * Send validation error (422)
   */
  validationError(res: Response, errors: ErrorDetails[], logMessage?: string): void {
    this.error(res, 422, errors, logMessage);
  }

  /**
   * Send rate limit error (429)
   */
  rateLimitExceeded(res: Response, error: string = 'Rate limit exceeded', logMessage?: string): void {
    this.error(res, 429, error, logMessage);
  }

  /**
   * Send internal server error (500)
   */
  internalError(res: Response, error: string = 'Internal server error', logMessage?: string, logError?: any): void {
    this.error(res, 500, error, logMessage, logError);
  }

  /**
   * Send service unavailable error (503)
   */
  serviceUnavailable(res: Response, error: string = 'Service temporarily unavailable', logMessage?: string): void {
    this.error(res, 503, error, logMessage);
  }

  /**
   * Handle async controller errors with consistent error responses
   */
  asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await handler(req, res);
      } catch (error: any) {
        this.handleUnexpectedError(res, error);
      }
    };
  }

  /**
   * Handle unexpected errors consistently
   */
  private handleUnexpectedError(res: Response, error: any): void {
    // Check if response was already sent
    if (res.headersSent) {
      return;
    }

    // Handle specific error types
    if (error.name === 'ValidationError') {
      this.validationError(res, [{ message: error.message }], 'Validation error');
      return;
    }

    if (error.name === 'CastError') {
      this.badRequest(res, 'Invalid data format', 'Cast error');
      return;
    }

    if (error.code === 11000) {
      this.conflict(res, 'Resource already exists', 'Duplicate key error');
      return;
    }

    if (error.name === 'JsonWebTokenError') {
      this.unauthorized(res, 'Invalid token', 'JWT error');
      return;
    }

    if (error.name === 'TokenExpiredError') {
      this.unauthorized(res, 'Token expired', 'JWT expired error');
      return;
    }

    // Default to internal server error
    this.internalError(res, 'Internal server error', 'Unexpected error', error);
  }

  /**
   * Send paginated response
   */
  paginated<T>(
    res: Response,
    data: T[],
    page: number,
    limit: number,
    total: number,
    message?: string
  ): void {
    const totalPages = Math.ceil(total / limit);

    this.success(res, data, message, 200, {
      page,
      limit,
      total,
      totalPages
    });
  }

  /**
   * Create a wrapped controller method with unified error handling
   */
  wrap(controller: (req: Request, res: Response) => Promise<void>) {
    return this.asyncHandler(controller);
  }

  /**
   * Validate request and send validation error if invalid
   */
  validateOrFail(res: Response, validation: { isValid: boolean; errors: string[] }): boolean {
    if (!validation.isValid) {
      const errorDetails: ErrorDetails[] = validation.errors.map(error => ({ message: error }));
      this.validationError(res, errorDetails, 'Request validation failed');
      return false;
    }
    return true;
  }

  /**
   * Send response based on operation result
   */
  handleResult<T>(
    res: Response,
    result: { success: boolean; data?: T; error?: string; message?: string },
    successMessage?: string,
    successStatusCode: HttpStatusCode = 200
  ): void {
    if (result.success) {
      this.success(res, result.data, result.message || successMessage, successStatusCode);
    } else {
      this.internalError(res, result.error || 'Operation failed', 'Operation result error');
    }
  }

  /**
   * Send no content response (204)
   */
  noContent(res: Response): void {
    res.status(204).send();
  }

  /**
   * Send accepted response (202)
   */
  accepted(res: Response, message?: string): void {
    const response: ApiResponse = {
      success: true,
      message: message || 'Request accepted for processing',
      timestamp: new Date().toISOString()
    };

    res.status(202).json(response);
  }

  /**
   * Check if user has required permissions
   */
  requirePermissions(res: Response, userRoles: string[], requiredRoles: string[]): boolean {
    const hasPermission = requiredRoles.some(role => userRoles.includes(role));
    
    if (!hasPermission) {
      this.forbidden(res, 'Insufficient permissions', 'Permission check failed');
      return false;
    }
    
    return true;
  }

  /**
   * Require authentication
   */
  requireAuth(res: Response, user: any): boolean {
    if (!user) {
      this.unauthorized(res, 'Authentication required', 'Auth check failed');
      return false;
    }
    return true;
  }

  /**
   * Handle file upload responses
   */
  fileUploaded(res: Response, fileInfo: { filename: string; size: number; path?: string }): void {
    this.created(res, fileInfo, 'File uploaded successfully');
  }

  /**
   * Handle bulk operation responses
   */
  bulkOperation(
    res: Response,
    results: { success: number; failed: number; total: number },
    message?: string
  ): void {
    const allSuccessful = results.failed === 0;
    const statusCode = allSuccessful ? 200 : 207; // 207 = Multi-Status

    this.success(
      res,
      results,
      message || `Operation completed: ${results.success}/${results.total} successful`,
      statusCode as HttpStatusCode
    );
  }
}

/**
 * Express middleware for consistent error handling
 */
export function errorHandlerMiddleware(
  error: any,
  req: Request,
  res: Response,
  next: Function
): void {
  const responseHandler = ResponseHandler.getInstance();
  responseHandler.internalError(res, 'Internal server error', 'Unhandled error in middleware', error);
}

/**
 * Create async handler wrapper for controllers
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
) {
  return ResponseHandler.getInstance().asyncHandler(handler);
}

/**
 * Decorator for controller methods to add automatic error handling
 */
export function HandleErrors(target: any, propertyName: string, descriptor: PropertyDescriptor) {
  const method = descriptor.value;

  descriptor.value = async function (req: Request, res: Response) {
    try {
      await method.call(this, req, res);
    } catch (error) {
      const responseHandler = ResponseHandler.getInstance();
      responseHandler.internalError(res, 'Internal server error', `Error in ${propertyName}`, error);
    }
  };

  return descriptor;
}

// Singleton instance
export const responseHandler = ResponseHandler.getInstance();

// Common response helper functions
export const respond = responseHandler;

export default responseHandler;