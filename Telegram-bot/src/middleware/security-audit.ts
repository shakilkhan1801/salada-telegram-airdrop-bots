import { Request, Response, NextFunction } from 'express';
import { Logger } from '../services/logger';

interface SecurityEvent {
  type: 'suspicious_activity' | 'rate_limit_exceeded' | 'auth_failure' | 'unauthorized_access' | 'data_access';
  severity: 'low' | 'medium' | 'high' | 'critical';
  ip: string;
  userAgent: string;
  endpoint: string;
  adminId?: string;
  userId?: string;
  details: any;
  timestamp: string;
}

/**
 * Security Audit Middleware
 * Tracks and logs security-related events for compliance and monitoring
 */
class SecurityAudit {
  private static instance: SecurityAudit;
  private readonly logger = Logger.getInstance();
  private securityEvents: SecurityEvent[] = [];
  private readonly MAX_EVENTS = 1000; // Keep last 1000 events in memory

  private constructor() {}

  public static getInstance(): SecurityAudit {
    if (!SecurityAudit.instance) {
      SecurityAudit.instance = new SecurityAudit();
    }
    return SecurityAudit.instance;
  }

  /**
   * Log a security event
   */
  public logEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString()
    };

    // Add to in-memory store
    this.securityEvents.unshift(securityEvent);
    if (this.securityEvents.length > this.MAX_EVENTS) {
      this.securityEvents.pop();
    }

    // Log based on severity
    const logData = {
      securityEvent: true,
      ...securityEvent
    };

    switch (event.severity) {
      case 'critical':
        this.logger.error('CRITICAL Security Event', logData);
        // Could trigger alerts here
        break;
      case 'high':
        this.logger.error('HIGH Security Event', logData);
        break;
      case 'medium':
        this.logger.warn('MEDIUM Security Event', logData);
        break;
      case 'low':
        this.logger.info('LOW Security Event', logData);
        break;
    }
  }

  /**
   * Middleware to track admin access patterns
   */
  public adminAccessTracking() {
    return (req: Request, res: Response, next: NextFunction) => {
      const adminId = (req as any).adminId;
      
      // Track admin access patterns
      if (adminId) {
        // Log sensitive endpoint access
        if (this.isSensitiveEndpoint(req.path)) {
          this.logEvent({
            type: 'data_access',
            severity: 'medium',
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent') || 'unknown',
            endpoint: req.originalUrl,
            adminId,
            details: {
              method: req.method,
              sensitiveEndpoint: true,
              query: req.query,
              bodyKeys: Object.keys(req.body || {})
            }
          });
        }

        // Track unusual access patterns
        if (this.isUnusualAccess(req)) {
          this.logEvent({
            type: 'suspicious_activity',
            severity: 'medium',
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent') || 'unknown',
            endpoint: req.originalUrl,
            adminId,
            details: {
              reason: 'unusual_access_pattern',
              method: req.method,
              time: new Date().getHours()
            }
          });
        }
      }

      next();
    };
  }

  /**
   * Middleware to track authentication failures
   */
  public authFailureTracking() {
    return (req: Request, res: Response, next: NextFunction) => {
      const originalSend = res.send;
      
      res.send = function(data: any) {
        try {
          const responseData = typeof data === 'string' ? JSON.parse(data) : data;
          
          // Track authentication failures
          if (req.path.includes('/auth/') && res.statusCode === 401) {
            SecurityAudit.getInstance().logEvent({
              type: 'auth_failure',
              severity: 'medium',
              ip: SecurityAudit.getInstance().getClientIP(req),
              userAgent: req.get('User-Agent') || 'unknown',
              endpoint: req.originalUrl,
              details: {
                statusCode: res.statusCode,
                attempt: req.body?.username || req.body?.email || 'unknown',
                error: responseData?.error || responseData?.message
              }
            });
          }
          
          // Track unauthorized access attempts
          if (res.statusCode === 403) {
            SecurityAudit.getInstance().logEvent({
              type: 'unauthorized_access',
              severity: 'high',
              ip: SecurityAudit.getInstance().getClientIP(req),
              userAgent: req.get('User-Agent') || 'unknown',
              endpoint: req.originalUrl,
              adminId: (req as any).adminId,
              details: {
                statusCode: res.statusCode,
                method: req.method,
                error: responseData?.error || responseData?.message
              }
            });
          }
        } catch (error) {
          // Ignore JSON parsing errors
        }
        
        return originalSend.call(this, data);
      };
      
      next();
    };
  }

  /**
   * Get recent security events
   */
  public getRecentEvents(limit: number = 50, severity?: string): SecurityEvent[] {
    let events = this.securityEvents;
    
    if (severity) {
      events = events.filter(event => event.severity === severity);
    }
    
    return events.slice(0, limit);
  }

  /**
   * Get security statistics
   */
  public getSecurityStats(): {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    recentActivity: {
      last24Hours: number;
      lastHour: number;
    };
  } {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let recentActivity = { last24Hours: 0, lastHour: 0 };

    for (const event of this.securityEvents) {
      // Count by severity
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      
      // Count by type
      byType[event.type] = (byType[event.type] || 0) + 1;
      
      // Count recent activity
      const eventTime = new Date(event.timestamp);
      if (eventTime > last24Hours) {
        recentActivity.last24Hours++;
        if (eventTime > lastHour) {
          recentActivity.lastHour++;
        }
      }
    }

    return {
      total: this.securityEvents.length,
      bySeverity,
      byType,
      recentActivity
    };
  }

  /**
   * Check if endpoint is sensitive
   */
  private isSensitiveEndpoint(path: string): boolean {
    const sensitivePatterns = [
      '/users',
      '/security',
      '/audit',
      '/broadcast',
      '/tasks'
    ];
    
    return sensitivePatterns.some(pattern => path.includes(pattern));
  }

  /**
   * Check if access pattern is unusual
   */
  private isUnusualAccess(req: Request): boolean {
    // Check for unusual access times (e.g., very late night or early morning)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      return true;
    }
    
    // Check for rapid successive requests (basic check)
    // This could be enhanced with more sophisticated pattern detection
    
    return false;
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
}

export default SecurityAudit;