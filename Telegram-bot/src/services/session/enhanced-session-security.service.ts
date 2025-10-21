import { Logger } from '../logger';
import { storage } from '../../storage';
import SessionSecurityService from './session-security-service';
import { AdminUser, AdminRole } from '../../types/admin.types';
import { getConfig } from '../../config';

/**
 * Enhanced Session Security Service
 * Provides additional security layers on top of base SessionSecurityService
 */
export class EnhancedSessionSecurityService {
  private static instance: EnhancedSessionSecurityService;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly sessionService = SessionSecurityService;
  
  // Enhanced security settings
  private readonly MAX_SESSIONS_PER_ROLE: Record<AdminRole, number> = {
    'super_admin': 5,
    'admin': 3,
    'moderator': 2,
    'viewer': 1,
    'support': 2
  };
  
  private readonly SESSION_MONITORING_ENABLED = true;
  private readonly SUSPICIOUS_ACTIVITY_THRESHOLD = 3;
  private readonly AUTO_LOCK_SUSPICIOUS_ACCOUNTS = true;
  
  private constructor() {}

  public static getInstance(): EnhancedSessionSecurityService {
    if (!EnhancedSessionSecurityService.instance) {
      EnhancedSessionSecurityService.instance = new EnhancedSessionSecurityService();
    }
    return EnhancedSessionSecurityService.instance;
  }

  /**
   * Enhanced session creation with role-based limits
   */
  async createEnhancedSecureSession(
    adminUser: AdminUser,
    request: {
      ip: string;
      userAgent: string;
      acceptLanguage?: string;
      acceptEncoding?: string;
      screenResolution?: string;
      timeZone?: string;
    },
    options: {
      rememberMe?: boolean;
      forceRegenerate?: boolean;
      loginMethod?: string;
      enforceRoleLimits?: boolean;
    } = {}
  ) {
    try {
      // Enforce role-based session limits
      if (options.enforceRoleLimits !== false) {
        await this.enforceRoleBasedSessionLimits(adminUser);
      }

      // Check for suspicious activity patterns
      await this.checkSuspiciousActivity(adminUser.id, request.ip);

      // Create session using base service
      const session = await this.sessionService.createSecureSession(
        adminUser, 
        request, 
        options
      );

      // Additional enhanced security logging
      await this.logEnhancedSecurityEvent({
        adminId: adminUser.id,
        eventType: 'enhanced_session_created',
        sessionId: session.sessionId,
        securityMetadata: {
          roleBasedLimitEnforced: options.enforceRoleLimits !== false,
          suspiciousActivityChecked: true,
          roleMaxSessions: this.MAX_SESSIONS_PER_ROLE[adminUser.role],
          loginMethod: options.loginMethod || 'password'
        }
      });

      return session;
    } catch (error) {
      this.logger.error('Enhanced session creation failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced session validation with additional security checks
   */
  async validateEnhancedSession(
    sessionId: string,
    request: {
      ip: string;
      userAgent: string;
      acceptLanguage?: string;
      acceptEncoding?: string;
    },
    adminUser: AdminUser
  ) {
    try {
      // Base session validation
      const baseValidation = await this.sessionService.validateSession(sessionId, request);

      if (!baseValidation.valid) {
        return baseValidation;
      }

      // Enhanced security validations
      const enhancedChecks = await this.performEnhancedSecurityChecks(
        sessionId,
        request,
        adminUser
      );

      if (!enhancedChecks.passed) {
        await this.handleSecurityViolation(adminUser.id, sessionId, enhancedChecks.reasons);
        return {
          valid: false,
          reason: enhancedChecks.reasons.join(', '),
          requiresRegeneration: false
        };
      }

      return {
        ...baseValidation,
        enhancedSecurityPassed: true
      };

    } catch (error) {
      this.logger.error('Enhanced session validation failed:', error);
      return { valid: false, reason: 'enhanced_validation_error' };
    }
  }

  /**
   * Handle role changes with comprehensive session security
   */
  async handleRoleChangeWithSecurity(
    adminId: string,
    oldRole: AdminRole,
    newRole: AdminRole,
    changedByAdminId: string,
    request: { ip: string; userAgent: string }
  ) {
    try {
      // Log role change initiation
      this.logger.info(`Initiating secure role change for admin ${adminId}`, {
        oldRole,
        newRole,
        changedBy: changedByAdminId
      });

      // Get all active sessions for the admin
      const activeSessions = await this.sessionService.getUserSessions(adminId);

      // Regenerate all sessions due to privilege change
      const regenerationPromises = activeSessions.map(async (session) => {
        if (session.isActive) {
          return await this.sessionService.regenerateSession(
            session.sessionId,
            'role_change',
            newRole
          );
        }
        return null;
      });

      const regeneratedSessions = await Promise.all(regenerationPromises);

      // Enforce new role session limits
      const admin = await storage.get<AdminUser>('admin_users', adminId);
      if (admin) {
        admin.role = newRole;
        await this.enforceRoleBasedSessionLimits(admin);
      }

      // Log comprehensive role change completion
      await this.logEnhancedSecurityEvent({
        adminId,
        eventType: 'role_change_completed',
        securityMetadata: {
          oldRole,
          newRole,
          changedBy: changedByAdminId,
          sessionsRegenerated: regeneratedSessions.length,
          activeSessions: activeSessions.length,
          ip: request.ip,
          userAgent: request.userAgent
        }
      });

      return {
        success: true,
        sessionsRegenerated: regeneratedSessions.length
      };

    } catch (error) {
      this.logger.error('Role change with security failed:', error);
      throw error;
    }
  }

  /**
   * Automated security cleanup and monitoring
   */
  async performSecurityMaintenance() {
    try {
      this.logger.info('Starting enhanced session security maintenance');

      const results = {
        expiredSessionsCleanedUp: 0,
        suspiciousSessionsInvestigated: 0,
        securityViolationsProcessed: 0,
        roleLimitViolationsFixed: 0
      };

      // 1. Clean up expired sessions
      results.expiredSessionsCleanedUp = await this.sessionService.cleanupExpiredSessions();

      // 2. Investigate suspicious sessions
      results.suspiciousSessionsInvestigated = await this.investigateSuspiciousSessions();

      // 3. Process security violations
      results.securityViolationsProcessed = await this.processSecurityViolations();

      // 4. Fix role limit violations
      results.roleLimitViolationsFixed = await this.fixRoleLimitViolations();

      this.logger.info('Enhanced session security maintenance completed', results);
      return results;

    } catch (error) {
      this.logger.error('Security maintenance failed:', error);
      throw error;
    }
  }

  // Private helper methods

  private async enforceRoleBasedSessionLimits(adminUser: AdminUser): Promise<void> {
    const maxSessions = this.MAX_SESSIONS_PER_ROLE[adminUser.role];
    const activeSessions = await this.sessionService.getUserSessions(adminUser.id);

    if (activeSessions.length >= maxSessions) {
      // Sort by last activity and remove oldest sessions
      activeSessions.sort((a, b) => 
        new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      );

      const sessionsToRemove = activeSessions.length - maxSessions + 1;
      for (let i = 0; i < sessionsToRemove; i++) {
        await this.sessionService.invalidateSession(
          activeSessions[i].sessionId, 
          'admin_action'
        );
      }

      this.logger.info(`Enforced role-based session limit for ${adminUser.role}`, {
        adminId: adminUser.id,
        maxSessions,
        sessionsRemoved: sessionsToRemove
      });
    }
  }

  private async checkSuspiciousActivity(adminId: string, ip: string): Promise<void> {
    // Check for rapid session creation from different IPs
    const recentSessions = await this.getRecentSessionsForAdmin(adminId, 3600000); // Last hour

    const uniqueIPs = new Set(recentSessions.map(s => s.ipAddress));
    if (uniqueIPs.size > this.SUSPICIOUS_ACTIVITY_THRESHOLD) {
      await this.logEnhancedSecurityEvent({
        adminId,
        eventType: 'suspicious_activity_detected',
        securityMetadata: {
          suspiciousReason: 'multiple_ips_rapid_sessions',
          uniqueIPs: uniqueIPs.size,
          recentSessions: recentSessions.length,
          threshold: this.SUSPICIOUS_ACTIVITY_THRESHOLD
        }
      });

      if (this.AUTO_LOCK_SUSPICIOUS_ACCOUNTS) {
        await this.temporarilyLockAccount(adminId, 'suspicious_activity');
      }
    }
  }

  private async performEnhancedSecurityChecks(
    sessionId: string,
    request: { ip: string; userAgent: string },
    adminUser: AdminUser
  ): Promise<{ passed: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Check session count against role limits
    const activeSessions = await this.sessionService.getUserSessions(adminUser.id);
    const maxSessions = this.MAX_SESSIONS_PER_ROLE[adminUser.role];
    
    if (activeSessions.length > maxSessions) {
      reasons.push(`exceeded_role_session_limit_${adminUser.role}`);
    }

    // Check for geographical anomalies (if enabled)
    if (this.SESSION_MONITORING_ENABLED) {
      const geoAnomaly = await this.checkGeographicalAnomaly(adminUser.id, request.ip);
      if (geoAnomaly) {
        reasons.push('geographical_anomaly_detected');
      }
    }

    return {
      passed: reasons.length === 0,
      reasons
    };
  }

  private async handleSecurityViolation(
    adminId: string,
    sessionId: string,
    reasons: string[]
  ): Promise<void> {
    await this.logEnhancedSecurityEvent({
      adminId,
      eventType: 'security_violation',
      sessionId,
      securityMetadata: {
        violationReasons: reasons,
        actionTaken: 'session_invalidated'
      }
    });

    // Invalidate the violating session
    await this.sessionService.invalidateSession(sessionId, 'security_event');
  }

  private async getRecentSessionsForAdmin(adminId: string, timeWindowMs: number) {
    const allSessions = await this.sessionService.getUserSessions(adminId);
    const cutoffTime = new Date(Date.now() - timeWindowMs);

    return allSessions.filter(session => 
      new Date(session.createdAt) > cutoffTime
    );
  }

  private async temporarilyLockAccount(adminId: string, reason: string): Promise<void> {
    // Invalidate all sessions
    await this.sessionService.invalidateAllUserSessions(adminId, undefined, reason);
    
    // Add temporary lock flag
    await storage.update('admin_users', {
      metadata: {
        securityFlags: {
          temporarilyLocked: true,
          lockReason: reason,
          lockedAt: new Date().toISOString(),
          lockDurationMinutes: 30
        }
      }
    }, adminId);

    this.logger.warn(`Admin account temporarily locked`, {
      adminId,
      reason,
      duration: '30 minutes'
    });
  }

  private async checkGeographicalAnomaly(adminId: string, currentIP: string): Promise<boolean> {
    // Simplified geo check - in production, you'd use a proper GeoIP service
    const recentSessions = await this.getRecentSessionsForAdmin(adminId, 86400000); // Last 24 hours
    
    // Check if this IP is significantly different from recent IPs
    // This is a simplified version - real implementation would use geo-location services
    const recentIPs = recentSessions.map(s => s.ipAddress);
    const isNewIP = !recentIPs.includes(currentIP);
    
    return isNewIP && recentSessions.length > 0;
  }

  private async investigateSuspiciousSessions(): Promise<number> {
    // Implementation would check for patterns indicating suspicious behavior
    return 0;
  }

  private async processSecurityViolations(): Promise<number> {
    // Implementation would process logged security violations
    return 0;
  }

  private async fixRoleLimitViolations(): Promise<number> {
    // Implementation would find and fix role limit violations
    return 0;
  }

  private async logEnhancedSecurityEvent(event: {
    adminId: string;
    eventType: string;
    sessionId?: string;
    securityMetadata: Record<string, any>;
  }): Promise<void> {
    const enhancedEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      eventId: `enhanced_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    await storage.set('enhanced_security_events', enhancedEvent, enhancedEvent.eventId);
    
    this.logger.info(`Enhanced security event: ${event.eventType}`, {
      adminId: event.adminId,
      sessionId: event.sessionId,
      metadata: event.securityMetadata
    });
  }
}

export default EnhancedSessionSecurityService.getInstance();