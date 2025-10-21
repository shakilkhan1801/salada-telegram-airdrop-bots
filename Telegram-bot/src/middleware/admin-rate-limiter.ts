import rateLimit from 'express-rate-limit';
import { Logger } from '../services/logger';

const logger = Logger.getInstance();

/**
 * Rate limiting configurations for different admin endpoints
 * Enterprise-grade rate limiting with different tiers based on endpoint sensitivity
 */

// Strict rate limiting for authentication endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs for auth
  message: {
    success: false,
    error: 'Too many authentication attempts',
    message: 'Too many authentication attempts from this IP. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      timestamp: new Date().toISOString()
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts',
      message: 'Too many authentication attempts from this IP. Please try again in 15 minutes.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: '15 minutes'
    });
  }
});

// Moderate rate limiting for admin API endpoints
export const adminApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs for admin API
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Too many requests from this IP. Please try again later.',
    code: 'API_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/metrics';
  },
  handler: (req, res) => {
    logger.warn('Admin API rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      adminId: (req as any).adminId,
      timestamp: new Date().toISOString()
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many requests from this IP. Please try again later.',
      code: 'API_RATE_LIMIT_EXCEEDED'
    });
  }
});

// Strict rate limiting for sensitive admin operations
export const sensitiveOperationsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 sensitive operations per hour
  message: {
    success: false,
    error: 'Too many sensitive operations',
    message: 'Too many sensitive operations from this IP. Please try again in 1 hour.',
    code: 'SENSITIVE_OPS_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.error('Sensitive operations rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      adminId: (req as any).adminId,
      timestamp: new Date().toISOString(),
      severity: 'high'
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many sensitive operations',
      message: 'Too many sensitive operations from this IP. Please try again in 1 hour.',
      code: 'SENSITIVE_OPS_RATE_LIMIT_EXCEEDED',
      retryAfter: '1 hour'
    });
  }
});

// Very strict rate limiting for user data modifications
export const userDataRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 user data modifications per hour
  message: {
    success: false,
    error: 'Too many user data modifications',
    message: 'Too many user data modifications from this IP. Please try again in 1 hour.',
    code: 'USER_DATA_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.error('User data modification rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      adminId: (req as any).adminId,
      timestamp: new Date().toISOString(),
      severity: 'high'
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many user data modifications',
      message: 'Too many user data modifications from this IP. Please try again in 1 hour.',
      code: 'USER_DATA_RATE_LIMIT_EXCEEDED',
      retryAfter: '1 hour'
    });
  }
});

// General rate limiting for all endpoints
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Too many requests from this IP. Please try again later.',
    code: 'GENERAL_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks, metrics, and Telegram webhook
    return req.path === '/health' || req.path === '/metrics' || req.path === '/api' || req.path === '/webhook';
  },
  handler: (req, res) => {
    logger.warn('General rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      timestamp: new Date().toISOString()
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many requests from this IP. Please try again later.',
      code: 'GENERAL_RATE_LIMIT_EXCEEDED'
    });
  }
});