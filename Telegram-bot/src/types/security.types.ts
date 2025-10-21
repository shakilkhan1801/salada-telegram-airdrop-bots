/**
 * Enterprise Security Configuration Types
 * 
 * Comprehensive TypeScript interfaces for large-scale security configurations,
 * including rate limiting, IPv6 support, and monitoring systems.
 * 
 * @version 1.0.0
 * @author Security Engineering Team
 */

import { Request } from 'express';

/**
 * Enhanced rate limiting configuration with enterprise features
 */
export interface EnterpriseRateLimitConfig {
  /** Global rate limiting enablement */
  enabled: boolean;
  
  /** Default time window in milliseconds */
  defaultWindowMs: number;
  
  /** Default maximum requests per window */
  defaultMaxRequests: number;
  
  /** IPv6 support configuration */
  ipv6: {
    /** Enable IPv6 address handling */
    enabled: boolean;
    /** Normalize IPv6 addresses for consistency */
    normalize: boolean;
    /** Track IPv6 vs IPv4 metrics separately */
    separateMetrics: boolean;
  };
  
  /** Proxy and load balancer configuration */
  proxy: {
    /** Trust proxy headers */
    trustProxy: boolean;
    /** Expected proxy header names */
    expectedHeaders: string[];
    /** Maximum proxy hops to consider */
    maxHops: number;
  };
  
  /** Advanced security features */
  security: {
    /** Enable device fingerprinting */
    enableFingerprinting: boolean;
    /** Enable geographic rate limiting */
    enableGeoLimiting: boolean;
    /** Enable suspicious pattern detection */
    enableAnomalyDetection: boolean;
    /** Whitelist for trusted IPs */
    whitelist: string[];
    /** Blacklist for blocked IPs */
    blacklist: string[];
  };
}

export interface DeviceFingerprint {
  hash: string;
  userId: string;
  components: DeviceFingerprintComponents;
  quality: FingerprintQuality;
  registeredAt: string;
  lastSeenAt: string;
  usageCount: number;
  isBlocked: boolean;
  blockedAt?: string;
  blockReason?: string;
  riskScore: number;
  metadata: DeviceFingerprintMetadata;
}

export interface DeviceFingerprintComponents {
  hardware: HardwareFingerprint;
  browser: BrowserFingerprint;
  rendering: RenderingFingerprint;
  network: NetworkFingerprint;
  behavioral: BehavioralFingerprint;
}

export interface HardwareFingerprint {
  screenResolution: string;
  screenColorDepth: string;
  availableScreenSize: string;
  timezone: string;
  timezoneOffset: number;
  language: string;
  languages: string[];
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  maxTouchPoints: number;
}

export interface BrowserFingerprint {
  userAgent: string;
  vendor: string;
  vendorSub: string;
  product: string;
  productSub: string;
  appName: string;
  appVersion: string;
  appCodeName: string;
  cookieEnabled: boolean;
  doNotTrack?: string;
  onLine: boolean;
  javaEnabled: boolean;
  mimeTypes: string[];
  plugins: string[];
}

export interface RenderingFingerprint {
  canvasFingerprint?: string;
  webGLVendor?: string;
  webGLRenderer?: string;
  webGLVersion?: string;
  webGLShadingLanguageVersion?: string;
  webGLExtensions?: string[];
  audioFingerprint?: string;
  fontFingerprint?: string;
}

export interface NetworkFingerprint {
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  webRTCIPs?: string[];
  dnsOverHttps?: boolean;
}

export interface BehavioralFingerprint {
  mouseMovementPattern?: string;
  keyboardPattern?: string;
  scrollPattern?: string;
  interactionTiming?: number[];
  focusEvents?: number;
  clickPattern?: string;
}

export interface FingerprintQuality {
  overall: number;
  hardware: number;
  browser: number;
  rendering: number;
  network: number;
  uniqueness: number;
  stability: number;
}

export interface DeviceFingerprintMetadata {
  collisionCount: number;
  similarDevices: string[];
  riskFactors: RiskFactor[];
  verificationHistory: DeviceVerificationRecord[];
  lastCollisionCheck?: string;
  customData?: Record<string, any>;
}

export interface RiskFactor {
  type: RiskFactorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  evidence: Record<string, any>;
  detectedAt: string;
}

export type RiskFactorType = 
  | 'device_collision'
  | 'ip_collision'
  | 'device_fingerprint_mismatch'
  | 'critical_device_violation'
  | 'multiple_account_violation'
  | 'automated_pattern'
  | 'geo_block_violation'
  | 'rapid_registration'
  | 'behavioral_anomaly'
  | 'vpn_detected'
  | 'proxy_detected'
  | 'bot_detected';

export interface DeviceVerificationRecord {
  timestamp: string;
  action: 'registered' | 'verified' | 'updated' | 'blocked' | 'unblocked';
  reason?: string;
  performedBy?: string;
  changes?: Record<string, any>;
}

export interface ThreatAnalysis {
  userId: string;
  deviceHash?: string;
  ipAddress?: string;
  overallRiskScore: number;
  threatLevel: ThreatLevel;
  riskFactors: RiskFactor[];
  recommendations: SecurityRecommendation[];
  analysisTimestamp: string;
  metadata: ThreatAnalysisMetadata;
}

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityRecommendation {
  action: SecurityAction;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  reason: string;
  automated: boolean;
  requiresAdmin: boolean;
}

export type SecurityAction = 
  | 'monitor'
  | 'additional_verification'
  | 'temporary_block'
  | 'permanent_block'
  | 'admin_review'
  | 'enhanced_monitoring'
  | 'device_reset'
  | 'ip_block';

export interface ThreatAnalysisMetadata {
  analysisVersion: string;
  detectionMethods: string[];
  confidence: number;
  falsePositiveRisk: number;
  adminNotified: boolean;
  automaticAction?: SecurityAction;
  customData?: Record<string, any>;
}

export interface MultiAccountDetection {
  userId: string;
  riskScore: number;
  riskFactors: RiskFactor[];
  suspiciousAccounts: string[];
  detectionMethods: string[];
  confidence: number;
  timestamp: Date;
  actionRequired: boolean;
}

export interface MultiAccountDetectionResult {
  userId: string;
  violations: MultiAccountViolation[];
  totalRiskScore: number;
  isViolation: boolean;
  relatedAccounts: string[];
  recommendedAction: SecurityAction;
  banDuration?: number;
  gracePeriodHours: number;
  metadata: MultiAccountDetectionMetadata;
}

export interface MultiAccountViolation {
  type: MultiAccountViolationType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  description: string;
  evidence: MultiAccountEvidence;
  detectedAt: string;
}

export type MultiAccountViolationType = 
  | 'ip_violation'
  | 'device_violation'
  | 'telegram_violation'
  | 'behavioral_violation'
  | 'cross_reference_violation';

export interface MultiAccountEvidence {
  primaryAccount?: string;
  conflictingAccounts: string[];
  sharedIdentifiers: string[];
  patterns: Record<string, any>;
  confidence: number;
  additionalData?: Record<string, any>;
}

export interface MultiAccountDetectionMetadata {
  detectionMethod: string;
  analysisDepth: 'shallow' | 'deep' | 'comprehensive';
  crossReferenceChecked: boolean;
  behavioralAnalysisPerformed: boolean;
  adminNotified: boolean;
  automatedActionTaken?: SecurityAction;
  customData?: Record<string, any>;
}

export interface SecurityConfig {
  deviceFingerprintingEnabled: boolean;
  strictDeviceChecking: boolean;
  permanentDeviceBinding: boolean;
  bypassDetectionEnabled: boolean;
  autoBlockViolations: boolean;
  ipTrackingEnabled: boolean;
  maxUsersPerIp: number;
  maxDevicesPerUser: number;
  similarityThreshold: number;
  rapidRegistrationLimit: number;
  rapidRegistrationWindowHours: number;
  adminNotificationsEnabled: boolean;
  deviceCleanupDays: number;
  multiAccountDetectionEnabled: boolean;
  crossReferenceDetection: boolean;
  behavioralPatternDetection: boolean;
  detectionSensitivity: number;
  whitelistIps: string[];
  blacklistIps: string[];
}

export interface IPBlockRecord {
  ip: string;
  blockedAt: string;
  blockedBy: string;
  reason: string;
  expiresAt?: string;
  violationCount: number;
  lastViolationAt: string;
  isActive: boolean;
  metadata: Record<string, any>;
}

export interface SecurityAuditLog {
  id: string;
  timestamp: string;
  action: SecurityAuditAction;
  performedBy: string;
  targetUserId?: string;
  targetDeviceHash?: string;
  targetIp?: string;
  details: SecurityAuditDetails;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata: Record<string, any>;
}

export type SecurityAuditAction = 
  | 'user_blocked'
  | 'user_unblocked'
  | 'device_blocked'
  | 'device_unblocked'
  | 'ip_blocked'
  | 'ip_unblocked'
  | 'violation_detected'
  | 'threat_analyzed'
  | 'security_alert'
  | 'admin_override'
  | 'automated_action';

export interface SecurityAuditDetails {
  reason: string;
  riskScore?: number;
  evidence?: Record<string, any>;
  adminNotes?: string;
  automatedAction: boolean;
  appealable: boolean;
}

export interface CaptchaSession {
  id: string;
  userId: string;
  type: 'svg';
  challenge: CaptchaChallenge;
  answer: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  metadata: CaptchaSessionMetadata;
}

export interface CaptchaChallenge {
  type: 'math' | 'text' | 'pattern' | 'device_verification';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options?: string[];
  imageUrl?: string;

  instructions: string;
}

export interface CaptchaSessionMetadata {
  challengeGenerated: boolean;
  deviceVerified: boolean;
  botDetectionScore: number;
  suspiciousPatterns: string[];
  geoLocation?: string;
  browserFingerprint?: string;
  customData?: Record<string, any>;
}