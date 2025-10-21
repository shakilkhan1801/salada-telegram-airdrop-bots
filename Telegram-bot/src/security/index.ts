/**
 * Security Module - Unified Architecture
 * 
 * This module provides a consolidated security system through the UnifiedSecurityEngine.
 * Legacy fragmented detectors have been removed to eliminate redundancy and confusion.
 * 
 * Primary Interface:
 * - Use unifiedSecurityEngine.analyzeUser() for comprehensive security analysis
 * - Use unifiedSecurityEngine.quickSecurityCheck() for lightweight checks
 * - BehavioralAnalyzer and ThreatAnalyzer remain for specialized use cases
 */

// UNIFIED SECURITY ENGINE - Primary Interface
export { 
  UnifiedSecurityEngine,
  type UnifiedSecurityAnalysis,
  type MultiAccountViolation,
  type DeviceCollision,
  type BehavioralAnomaly,
  type ThreatPattern,
  type SecurityEvidence,
  type DetectionConfig
} from './unified-security-engine';

// Import the singleton instance
import { unifiedSecurityEngine as _unifiedSecurityEngine } from './unified-security-engine';

// Re-export the singleton instance
export const unifiedSecurityEngine = _unifiedSecurityEngine;

// CORE SERVICES - Still actively used
export { DeviceFingerprintService, type EnhancedDeviceData } from './device-fingerprint.service';
export { DeviceBanService } from './device-ban.service';
export { AccountProtectionService } from './account-protection.service';

// MIDDLEWARE AND UTILITIES
export { SecurityMiddleware } from './security-middleware';
export { RateLimiter } from './rate-limiter.service';
export { SecurityUtils } from './security-utils';

// ANALYZERS AND UTILITIES - Active services
export { BehavioralAnalyzer } from './behavioral-analyzer.service';
export { ThreatAnalyzer } from './threat-analyzer.service';

// NOTE: Legacy multi-account detectors have been removed in favor of UnifiedSecurityEngine
// Use unifiedSecurityEngine.analyzeUser() for comprehensive multi-account detection

/**
 * Compatibility wrapper for existing code
 * @deprecated Use unifiedSecurityEngine.analyzeUser() instead
 */
export class SecurityManager {
  private static instance: SecurityManager;
  
  public static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  /**
   * @deprecated Use unifiedSecurityEngine.analyzeUser() instead
   */
  async analyzeUser(user: any, deviceData: any, behaviorData?: any, ipAddress?: string) {
    console.warn('SecurityManager.analyzeUser() is deprecated. Use unifiedSecurityEngine.analyzeUser() instead.');
    return unifiedSecurityEngine.analyzeUser(user, deviceData, behaviorData, ipAddress);
  }

  /**
   * @deprecated Use unifiedSecurityEngine.quickSecurityCheck() instead
   */
  async quickCheck(user: any) {
    console.warn('SecurityManager.quickCheck() is deprecated. Use unifiedSecurityEngine.quickSecurityCheck() instead.');
    return unifiedSecurityEngine.quickSecurityCheck(user);
  }
}

/**
 * Security initialization function
 */
export const initializeSecurity = async (): Promise<void> => {
  // Initialize the unified security engine
  // This is a placeholder implementation
  console.log('Security system initialized');
};

/**
 * Quick access functions for common security operations
 */

// Primary security analysis
export const analyzeUserSecurity = async (
  user: any, 
  deviceData: any, 
  behaviorData?: any, 
  ipAddress?: string
) => {
  return unifiedSecurityEngine.analyzeUser(user, deviceData, behaviorData, ipAddress);
};

// Quick security check
export const quickSecurityCheck = async (user: any) => {
  return unifiedSecurityEngine.quickSecurityCheck(user);
};

// Device collision detection
export const checkDeviceCollisions = async (user: any, deviceData: any) => {
  const analysis = await unifiedSecurityEngine.analyzeUser(user, deviceData);
  return {
    hasCollisions: analysis.device.collisions.length > 0,
    collisions: analysis.device.collisions,
    trustScore: analysis.device.trustScore
  };
};

// Multi-account detection
export const detectMultiAccount = async (user: any, deviceData: any) => {
  const analysis = await unifiedSecurityEngine.analyzeUser(user, deviceData);
  return {
    detected: analysis.multiAccount.detected,
    confidence: analysis.multiAccount.confidence,
    violations: analysis.multiAccount.violations,
    relatedAccounts: analysis.multiAccount.relatedAccounts
  };
};

// Behavioral analysis
export const analyzeBehavior = async (user: any, behaviorData: any) => {
  const minimalDeviceData = {
    hardware: {
      screenResolution: 'unknown',
      screenColorDepth: 'unknown',
      availableScreenSize: 'unknown',
      timezone: 'unknown',
      timezoneOffset: 0,
      language: 'unknown',
      languages: [],
      platform: 'unknown',
      hardwareConcurrency: 0,
      deviceMemory: 0,
      maxTouchPoints: 0
    },
    browser: {
      userAgent: '',
      vendor: 'unknown',
      vendorSub: '',
      product: 'unknown',
      productSub: '',
      appName: 'unknown',
      appVersion: 'unknown',
      appCodeName: 'unknown',
      cookieEnabled: true,
      doNotTrack: undefined,
      onLine: true,
      javaEnabled: false,
      mimeTypes: [],
      plugins: []
    },
    rendering: {},
    network: {},
    behavioral: behaviorData || {},
    sessionData: {
      sessionId: 'unknown',
      timestamp: Date.now(),
      userAgent: '',
      referrer: '',
      url: ''
    }
  };

  const analysis = await unifiedSecurityEngine.analyzeUser(user, minimalDeviceData, behaviorData);
  return {
    automationScore: analysis.behavioral.automationScore,
    humanLikelihood: analysis.behavioral.humanLikelihood,
    anomalies: analysis.behavioral.anomalies
  };
};

// Export types from security types module
export type {
  DeviceFingerprint,
  ThreatAnalysis,
  MultiAccountDetectionResult,
  RiskFactor,
  SecurityAction,
  MultiAccountDetection,
  MultiAccountEvidence,
  MultiAccountViolation as LegacyMultiAccountViolation,
  SecurityAuditLog
} from '../types/security.types';

/**
 * MIGRATION EXAMPLES:
 * 
 * OLD WAY (Fragmented - REMOVED):
 * Multiple separate detector classes were removed to eliminate redundancy.
 * All multi-account detection is now unified in UnifiedSecurityEngine.
 * 
 * ```typescript
 * // REMOVED: EnhancedMultiAccountDetector, MultiAccountDetector, etc.
 * // Use UnifiedSecurityEngine instead for all detection needs
 * ```
 * 
 * NEW WAY (Unified):
 * ```typescript
 * import { unifiedSecurityEngine } from './security';
 * 
 * const analysis = await unifiedSecurityEngine.analyzeUser(
 *   user, 
 *   deviceData, 
 *   behaviorData, 
 *   ipAddress
 * );
 * 
 * // All analysis results in one place with coordinated decision making
 * console.log(analysis.overall.threatLevel);
 * console.log(analysis.overall.recommendedAction);
 * console.log(analysis.suggestedActions);
 * ```
 */

// Default export for convenience
export default _unifiedSecurityEngine;