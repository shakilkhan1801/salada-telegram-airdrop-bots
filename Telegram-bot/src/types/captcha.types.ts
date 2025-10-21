export interface CaptchaSession {
  id: string;
  userId: string;
  type: CaptchaType;
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

export type CaptchaType = 'svg' | 'miniapp';

export interface CaptchaChallenge {
  type: CaptchaType;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options?: string[];
  imageUrl?: string;

  svgContent?: string;
  instructions: string;
  expectedFormat?: string;
  hints?: string[];
}

export interface CaptchaSessionMetadata {
  challengeGenerated: boolean;
  deviceVerified: boolean;
  botDetectionScore: number;
  suspiciousPatterns: string[];
  geoLocation?: string;
  browserFingerprint?: string;
  verificationMethod: 'automatic' | 'manual';
  qualityScore: number;
  customData?: Record<string, any>;
}

export interface CaptchaVerificationResult {
  sessionId: string;
  userId: string;
  success: boolean;
  attempts: number;
  timeTaken: number;
  confidence: number;
  deviceFingerprint: string;
  qualityMetrics: CaptchaQualityMetrics;
  suspiciousActivity: boolean;
  timestamp: string;
}

export interface CaptchaQualityMetrics {
  fingerprintQuality: number;
  deviceConsistency: number;
  behavioralScore: number;
  timingAnalysis: number;
  interactionPattern: number;
  overall: number;
}

export interface CaptchaConfig {
  enabled: boolean;
  requiredForNewUsers: boolean;
  requiredForExistingUsers: boolean;
  requireAtLeastOne: boolean;
  sessionTimeout: number;
  maxAttempts: number;
  difficultyLevels: CaptchaDifficultyConfig;
  geoBlocking: CaptchaGeoConfig;
  deviceFingerprinting: CaptchaDeviceConfig;
  botDetection: CaptchaBotDetectionConfig;
}

export interface CaptchaDifficultyConfig {
  easy: {
    imageDistortion: number;
    characterCount: number;
  };
  medium: {
    imageDistortion: number;
    characterCount: number;
  };
  hard: {
    imageDistortion: number;
    characterCount: number;
  };
}

export interface CaptchaGeoConfig {
  enabled: boolean;
  blockedCountries: string[];
  allowedCountries: string[];
  suspiciousCountries: string[];
}

export interface CaptchaDeviceConfig {
  fingerprintRequired: boolean;
  qualityThreshold: number;
  consistencyCheck: boolean;
  deviceBinding: boolean;
}

export interface CaptchaBotDetectionConfig {
  enabled: boolean;
  sensitivityLevel: number;
  patterns: string[];
  automatedBehaviorThreshold: number;
  suspiciousTimingThreshold: number;
}

export interface CaptchaStats {
  totalSessions: number;
  successfulCompletions: number;
  failedAttempts: number;
  blockedSessions: number;
  averageCompletionTime: number;
  successRate: number;
  botDetectionRate: number;
  qualityDistribution: Record<string, number>;
  difficultyPerformance: Record<string, CaptchaPerformanceMetrics>;
}

export interface CaptchaPerformanceMetrics {
  attempts: number;
  successes: number;
  failures: number;
  averageTime: number;
  successRate: number;
  qualityScore: number;
}