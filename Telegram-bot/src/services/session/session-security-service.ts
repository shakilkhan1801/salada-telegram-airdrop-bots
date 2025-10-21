import crypto from 'crypto';
import { Logger } from '../logger';
import { storage } from '../../storage';
import { AdminUser } from '../../types/admin.types';
import { getConfig } from '../../config';

export interface SessionFingerprint {
  userAgent: string;
  ip: string;
  acceptLanguage: string;
  acceptEncoding: string;
  screenResolution?: string;
  timeZone?: string;
  hash: string;
}

export interface SecureSessionData {
  sessionId: string;
  adminId: string;
  role: string;
  fingerprint: SessionFingerprint;
  ipAddress: string;
  createdAt: string;
  lastActivity: string;
  expiresAt: string;
  isActive: boolean;
  regenerationCount: number;
  securityFlags: {
    roleChanged: boolean;
    ipChanged: boolean;
    fingerprintChanged: boolean;
    forceRegenerated: boolean;
  };
  metadata: {
    loginMethod?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    previousSessionId?: string;
  };
}

export interface SessionSecurityEvent {
  eventType: 'created' | 'regenerated' | 'invalidated' | 'expired' | 'hijack_detected' | 'role_changed';
  adminId: string;
  sessionId: string;
  ipAddress: string;
  timestamp: string;
  details: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Enterprise-grade session security service
 * Prevents session fixation, hijacking, and implements secure session management
 */
export class SessionSecurityService {
  private static instance: SessionSecurityService;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  
  // Session security configuration
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  private readonly ACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours of inactivity
  private readonly MAX_CONCURRENT_SESSIONS = 3;
  private readonly REGENERATION_INTERVAL = 15 * 60 * 1000; // 15 minutes
  private readonly SESSION_ID_LENGTH = 64;
  private readonly FINGERPRINT_TOLERANCE = 0.8; // 80% similarity threshold

  private constructor() {}

  public static getInstance(): SessionSecurityService {
    if (!SessionSecurityService.instance) {
      SessionSecurityService.instance = new SessionSecurityService();
    }
    return SessionSecurityService.instance;
  }

  /**
   * Create new secure session with fingerprinting
   */
  async createSecureSession(
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
    } = {}
  ): Promise<SecureSessionData> {
    try {
      // Generate secure session ID
      const sessionId = this.generateSecureSessionId();
      
      // Create session fingerprint
      const fingerprint = this.createSessionFingerprint(request);
      
      // Calculate expiration
      const expiresAt = new Date(
        Date.now() + (options.rememberMe ? 7 * 24 * 60 * 60 * 1000 : this.SESSION_TIMEOUT)
      );

      // Invalidate old sessions if limit exceeded
      await this.enforceSessionLimit(adminUser.id);

      // Create session data
      const sessionData: SecureSessionData = {
        sessionId,
        adminId: adminUser.id,
        role: adminUser.role,
        fingerprint,
        ipAddress: request.ip,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        isActive: true,
        regenerationCount: 0,
        securityFlags: {
          roleChanged: false,
          ipChanged: false,
          fingerprintChanged: false,
          forceRegenerated: options.forceRegenerate || false
        },
        metadata: {
          loginMethod: options.loginMethod || 'password',
          deviceType: this.detectDeviceType(request.userAgent),
          browser: this.extractBrowser(request.userAgent),
          os: this.extractOS(request.userAgent)
        }
      };

      // Store session securely
      await this.storeSecureSession(sessionData);

      // Log security event
      await this.logSecurityEvent({
        eventType: 'created',
        adminId: adminUser.id,
        sessionId,
        ipAddress: request.ip,
        timestamp: new Date().toISOString(),
        details: {
          loginMethod: options.loginMethod,
          rememberMe: options.rememberMe,
          deviceType: sessionData.metadata.deviceType,
          browser: sessionData.metadata.browser
        },
        riskLevel: 'low'
      });

      this.logger.info(`Secure session created for admin ${adminUser.id}`, {
        sessionId,
        fingerprint: fingerprint.hash,
        ipAddress: request.ip
      });

      return sessionData;

    } catch (error) {
      this.logger.error('Failed to create secure session:', error);
      throw new Error('Session creation failed');
    }
  }

  /**
   * Regenerate session on security events (login, role change, etc.)
   */
  async regenerateSession(
    currentSessionId: string,
    reason: 'login' | 'role_change' | 'periodic' | 'security_event',
    newRole?: string
  ): Promise<SecureSessionData> {
    try {
      // Get current session
      const currentSession = await this.getSecureSession(currentSessionId);
      if (!currentSession || !currentSession.isActive) {
        throw new Error('Invalid session for regeneration');
      }

      // Generate new session ID
      const newSessionId = this.generateSecureSessionId();

      // Create regenerated session
      const regeneratedSession: SecureSessionData = {
        ...currentSession,
        sessionId: newSessionId,
        role: newRole || currentSession.role,
        lastActivity: new Date().toISOString(),
        regenerationCount: currentSession.regenerationCount + 1,
        securityFlags: {
          ...currentSession.securityFlags,
          roleChanged: newRole !== undefined && newRole !== currentSession.role,
          forceRegenerated: reason === 'security_event'
        },
        metadata: {
          ...currentSession.metadata,
          previousSessionId: currentSessionId
        }
      };

      // Store new session and invalidate old one
      await Promise.all([
        this.storeSecureSession(regeneratedSession),
        this.invalidateSession(currentSessionId, 'regenerated')
      ]);

      // Log security event
      await this.logSecurityEvent({
        eventType: 'regenerated',
        adminId: currentSession.adminId,
        sessionId: newSessionId,
        ipAddress: currentSession.ipAddress,
        timestamp: new Date().toISOString(),
        details: {
          reason,
          previousSessionId: currentSessionId,
          roleChanged: regeneratedSession.securityFlags.roleChanged,
          regenerationCount: regeneratedSession.regenerationCount
        },
        riskLevel: reason === 'security_event' ? 'high' : 'low'
      });

      this.logger.info(`Session regenerated for admin ${currentSession.adminId}`, {
        oldSessionId: currentSessionId,
        newSessionId,
        reason
      });

      return regeneratedSession;

    } catch (error) {
      this.logger.error('Failed to regenerate session:', error);
      throw new Error('Session regeneration failed');
    }
  }

  /**
   * Validate session with comprehensive security checks
   */
  async validateSession(
    sessionId: string,
    request: {
      ip: string;
      userAgent: string;
      acceptLanguage?: string;
      acceptEncoding?: string;
    }
  ): Promise<{
    valid: boolean;
    session?: SecureSessionData;
    reason?: string;
    requiresRegeneration?: boolean;
  }> {
    try {
      // Get session data
      const session = await this.getSecureSession(sessionId);
      
      if (!session) {
        return { valid: false, reason: 'session_not_found' };
      }

      if (!session.isActive) {
        return { valid: false, reason: 'session_inactive' };
      }

      // Check expiration
      if (new Date(session.expiresAt) < new Date()) {
        await this.invalidateSession(sessionId, 'expired');
        return { valid: false, reason: 'session_expired' };
      }

      // Check activity timeout
      const lastActivity = new Date(session.lastActivity);
      const now = new Date();
      if (now.getTime() - lastActivity.getTime() > this.ACTIVITY_TIMEOUT) {
        await this.invalidateSession(sessionId, 'inactive');
        return { valid: false, reason: 'session_inactive_timeout' };
      }

      // Check IP address binding
      if (session.ipAddress !== request.ip) {
        await this.logSecurityEvent({
          eventType: 'hijack_detected',
          adminId: session.adminId,
          sessionId,
          ipAddress: request.ip,
          timestamp: new Date().toISOString(),
          details: {
            originalIp: session.ipAddress,
            newIp: request.ip,
            suspiciousActivity: true
          },
          riskLevel: 'critical'
        });

        // For high security, invalidate session on IP change
        if ((this.config as any).security?.strictIpBinding) {
          await this.invalidateSession(sessionId, 'ip_mismatch');
          return { valid: false, reason: 'ip_mismatch' };
        }
        
        // Mark as requiring regeneration for IP change
        session.securityFlags.ipChanged = true;
      }

      // Check fingerprint similarity
      const currentFingerprint = this.createSessionFingerprint(request);
      const fingerprintSimilarity = this.compareFingerprintSimilarity(
        session.fingerprint,
        currentFingerprint
      );

      if (fingerprintSimilarity < this.FINGERPRINT_TOLERANCE) {
        await this.logSecurityEvent({
          eventType: 'hijack_detected',
          adminId: session.adminId,
          sessionId,
          ipAddress: request.ip,
          timestamp: new Date().toISOString(),
          details: {
            originalFingerprint: session.fingerprint.hash,
            newFingerprint: currentFingerprint.hash,
            similarity: fingerprintSimilarity,
            suspiciousActivity: true
          },
          riskLevel: 'high'
        });

        session.securityFlags.fingerprintChanged = true;
      }

      // Check if regeneration is needed
      const needsRegeneration = this.shouldRegenerateSession(session);

      // Update last activity
      await this.updateSessionActivity(sessionId);

      return {
        valid: true,
        session,
        requiresRegeneration: needsRegeneration
      };

    } catch (error) {
      this.logger.error('Session validation error:', error);
      return { valid: false, reason: 'validation_error' };
    }
  }

  /**
   * Invalidate session with reason tracking
   */
  async invalidateSession(
    sessionId: string,
    reason: 'logout' | 'expired' | 'regenerated' | 'security_event' | 'inactive' | 'ip_mismatch' | 'admin_action'
  ): Promise<void> {
    try {
      const session = await this.getSecureSession(sessionId);
      if (!session) {
        return; // Already invalid
      }

      // Mark session as inactive
      session.isActive = false;
      await this.storeSecureSession(session);

      // Log security event
      await this.logSecurityEvent({
        eventType: 'invalidated',
        adminId: session.adminId,
        sessionId,
        ipAddress: session.ipAddress,
        timestamp: new Date().toISOString(),
        details: { reason },
        riskLevel: reason === 'security_event' ? 'high' : 'low'
      });

      this.logger.info(`Session invalidated for admin ${session.adminId}`, {
        sessionId,
        reason
      });

    } catch (error) {
      this.logger.error('Failed to invalidate session:', error);
      throw new Error('Session invalidation failed');
    }
  }

  /**
   * Invalidate all sessions for an admin user
   */
  async invalidateAllUserSessions(
    adminId: string,
    excludeSessionId?: string,
    reason: string = 'admin_action'
  ): Promise<void> {
    try {
      const sessions = await this.getUserSessions(adminId);
      
      const invalidationPromises = sessions
        .filter(session => session.sessionId !== excludeSessionId && session.isActive)
        .map(session => this.invalidateSession(session.sessionId, 'admin_action'));

      await Promise.all(invalidationPromises);

      this.logger.info(`All sessions invalidated for admin ${adminId}`, {
        excludeSessionId,
        reason,
        sessionCount: invalidationPromises.length
      });

    } catch (error) {
      this.logger.error('Failed to invalidate all user sessions:', error);
      throw new Error('Bulk session invalidation failed');
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(adminId: string): Promise<SecureSessionData[]> {
    try {
      const sessionIds = await storage.list('secure_sessions');
      const sessions: SecureSessionData[] = [];
      for (const id of sessionIds) {
        const session = await storage.get<SecureSessionData>('secure_sessions', id);
        if (session && session.adminId === adminId && session.isActive) {
          sessions.push(session);
        }
      }
      return sessions;
    } catch (error) {
      this.logger.error('Failed to get user sessions:', error);
      return [];
    }
  }

  /**
   * Cleanup expired sessions (scheduled task)
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      // Check if storage is ready before proceeding
      if (!storage.isReady()) {
        this.logger.warn('Storage not ready, skipping session cleanup');
        return 0;
      }

      // Get list of session IDs first
      const sessionIds = await storage.list('secure_sessions');
      const now = new Date();
      let cleanedCount = 0;

      for (const sessionId of sessionIds) {
        const session = await storage.get<SecureSessionData>('secure_sessions', sessionId);
        if (!session) continue;
        if (session.isActive && new Date(session.expiresAt) < now) {
          await this.invalidateSession(session.sessionId, 'expired');
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`Cleaned up ${cleanedCount} expired sessions`);
      }

      return cleanedCount;

    } catch (error) {
      this.logger.error('Failed to cleanup expired sessions:', error);
      return 0;
    }
  }

  // Private helper methods

  private generateSecureSessionId(): string {
    return crypto.randomBytes(this.SESSION_ID_LENGTH).toString('hex');
  }

  private createSessionFingerprint(request: {
    ip: string;
    userAgent: string;
    acceptLanguage?: string;
    acceptEncoding?: string;
    screenResolution?: string;
    timeZone?: string;
  }): SessionFingerprint {
    const fingerprintData = {
      userAgent: request.userAgent || '',
      ip: request.ip,
      acceptLanguage: request.acceptLanguage || '',
      acceptEncoding: request.acceptEncoding || '',
      screenResolution: request.screenResolution || '',
      timeZone: request.timeZone || ''
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(fingerprintData))
      .digest('hex');

    return {
      ...fingerprintData,
      hash
    };
  }

  private compareFingerprintSimilarity(fp1: SessionFingerprint, fp2: SessionFingerprint): number {
    const fields = ['userAgent', 'acceptLanguage', 'acceptEncoding', 'screenResolution', 'timeZone'];
    let matches = 0;

    for (const field of fields) {
      if (fp1[field as keyof SessionFingerprint] === fp2[field as keyof SessionFingerprint]) {
        matches++;
      }
    }

    return matches / fields.length;
  }

  private shouldRegenerateSession(session: SecureSessionData): boolean {
    const lastActivity = new Date(session.lastActivity);
    const now = new Date();
    
    return (
      now.getTime() - lastActivity.getTime() > this.REGENERATION_INTERVAL ||
      session.securityFlags.ipChanged ||
      session.securityFlags.fingerprintChanged ||
      session.securityFlags.roleChanged
    );
  }

  private async enforceSessionLimit(adminId: string): Promise<void> {
    const sessions = await this.getUserSessions(adminId);
    
    if (sessions.length >= this.MAX_CONCURRENT_SESSIONS) {
      // Sort by last activity and remove oldest
      sessions.sort((a, b) => 
        new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      );

      const sessionsToRemove = sessions.length - this.MAX_CONCURRENT_SESSIONS + 1;
      for (let i = 0; i < sessionsToRemove; i++) {
        await this.invalidateSession(sessions[i].sessionId, 'admin_action');
      }
    }
  }

  private async storeSecureSession(sessionData: SecureSessionData): Promise<void> {
    await storage.set('secure_sessions', sessionData, sessionData.sessionId);
  }

  private async getSecureSession(sessionId: string): Promise<SecureSessionData | null> {
    return await storage.get<SecureSessionData>('secure_sessions', sessionId);
  }

  private async updateSessionActivity(sessionId: string): Promise<void> {
    const session = await this.getSecureSession(sessionId);
    if (session) {
      session.lastActivity = new Date().toISOString();
      await this.storeSecureSession(session);
    }
  }

  private async logSecurityEvent(event: SessionSecurityEvent): Promise<void> {
    await storage.set('session_security_events', event, `${event.sessionId}_${Date.now()}`);
    
    // Also log to regular logging system
    this.logger.info(`Session security event: ${event.eventType}`, {
      adminId: event.adminId,
      sessionId: event.sessionId,
      riskLevel: event.riskLevel,
      details: event.details
    });
  }

  private detectDeviceType(userAgent: string): string {
    if (/mobile/i.test(userAgent)) return 'mobile';
    if (/tablet/i.test(userAgent)) return 'tablet';
    return 'desktop';
  }

  private extractBrowser(userAgent: string): string {
    if (/chrome/i.test(userAgent)) return 'Chrome';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    if (/edge/i.test(userAgent)) return 'Edge';
    return 'Unknown';
  }

  private extractOS(userAgent: string): string {
    if (/windows/i.test(userAgent)) return 'Windows';
    if (/mac/i.test(userAgent)) return 'macOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    if (/android/i.test(userAgent)) return 'Android';
    if (/ios/i.test(userAgent)) return 'iOS';
    return 'Unknown';
  }
}

export default SessionSecurityService.getInstance();