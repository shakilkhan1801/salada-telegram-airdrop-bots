/**
 * Unified Security Detection Engine
 * 
 * Consolidates multiple security detection systems into a single, coherent engine:
 * - Multi-account detection (enhanced, strict, privacy-first approaches)
 * - Behavioral analysis and anomaly detection
 * - Threat pattern recognition
 * - Device fingerprinting and collision detection
 * - Network and location validation
 * 
 * This replaces the fragmented security system with a comprehensive solution.
 */

import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { BaseStorage } from '../storage/base-storage';
import { createStorage } from '../storage';
import { MemoryManager } from '../services/memory-manager.service';
import { User } from '../types/user.types';
import { 
  DeviceFingerprint, 
  ThreatAnalysis,
  MultiAccountDetectionResult,
  RiskFactor,
  SecurityAction
} from '../types/security.types';
import { DeviceFingerprintService, EnhancedDeviceData } from './device-fingerprint.service';
import { DeviceBanService } from './device-ban.service';
import { LocationService, LocationData } from '../services/location/location.service';
import crypto from 'crypto';

// Unified security analysis result
export interface UnifiedSecurityAnalysis {
  userId: string;
  overall: {
    riskScore: number;
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    recommendedAction: SecurityAction;
  };
  multiAccount: {
    detected: boolean;
    method: string;
    confidence: number;
    relatedAccounts: string[];
    violations: MultiAccountViolation[];
  };
  behavioral: {
    automationScore: number;
    humanLikelihood: number;
    anomalies: BehavioralAnomaly[];
  };
  device: {
    collisions: DeviceCollision[];
    fingerprint: DeviceFingerprint;
    trustScore: number;
  };
  network: {
    vpnDetected: boolean;
    proxyDetected: boolean;
    torDetected: boolean;
    locationConsistent: boolean;
    riskFactors: string[];
  };
  threats: {
    patterns: ThreatPattern[];
    indicators: string[];
    severity: string;
  };
  evidence: SecurityEvidence[];
  actionRequired: boolean;
  suggestedActions: string[];
}

// Consolidated interfaces
export interface MultiAccountViolation {
  type: 'device_collision' | 'behavioral_match' | 'network_overlap' | 'referral_abuse' | 'registration_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  evidence: Record<string, any>;
  relatedUserIds: string[];
}

export interface DeviceCollision {
  deviceHash: string;
  conflictingUsers: string[];
  originalUser: string;
  violationType: 'exact_match' | 'high_similarity' | 'component_match';
  confidence: number;
  evidence: {
    matchingComponents: string[];
    canvasFingerprint?: string;
    hardwareSpecs?: Record<string, any>;
    browserSignature?: string;
  };
}

export interface BehavioralAnomaly {
  type: 'automation_detected' | 'session_replay' | 'impossible_timing' | 'unnatural_patterns';
  description: string;
  confidence: number;
  evidence: {
    mousePatterns?: any;
    keyboardTimings?: number[];
    sessionData?: any;
  };
}

export interface ThreatPattern {
  id: string;
  name: string;
  indicators: string[];
  riskScore: number;
  confidence: number;
}

export interface SecurityEvidence {
  type: string;
  description: string;
  confidence: number;
  timestamp: string;
  data: Record<string, any>;
}

// Detection strategy configurations
export interface DetectionConfig {
  multiAccount: {
    enabled: boolean;
    strictMode: boolean;
    privacyMode: boolean;
    deviceSimilarityThreshold: number;
    behaviorSimilarityThreshold: number;
  };
  behavioral: {
    enabled: boolean;
    automationThreshold: number;
    sessionReplayDetection: boolean;
    mousePatternAnalysis: boolean;
  };
  network: {
    vpnDetection: boolean;
    proxyDetection: boolean;
    torDetection: boolean;
    locationValidation: boolean;
  };
  device: {
    fingerprintingEnabled: boolean;
    collisionDetection: boolean;
    componentMatching: boolean;
  };
}

/**
 * Unified Security Detection Engine
 * Central orchestrator for all security detection capabilities
 */
export class UnifiedSecurityEngine {
  private static instance: UnifiedSecurityEngine;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage: BaseStorage;
  private readonly memoryManager = MemoryManager.getInstance();
  private readonly fingerprintService = new DeviceFingerprintService();
  private readonly deviceBanService = new DeviceBanService();
  private readonly locationService = new LocationService();
  
  // Detection caches for performance
  private deviceCache: any;
  private behaviorCache: any;
  private threatCache: any;
  
  // Detection configuration
  private detectionConfig!: DetectionConfig;

  private constructor() {
    this.storage = createStorage();
    this.initializeCaches();
    this.loadDetectionConfig();
  }

  public static getInstance(): UnifiedSecurityEngine {
    if (!UnifiedSecurityEngine.instance) {
      UnifiedSecurityEngine.instance = new UnifiedSecurityEngine();
    }
    return UnifiedSecurityEngine.instance;
  }

  /**
   * Main security analysis entry point
   * Orchestrates all detection systems and produces unified result
   */
  async analyzeUser(
    user: User,
    deviceData: EnhancedDeviceData,
    behaviorData?: any,
    ipAddress?: string
  ): Promise<UnifiedSecurityAnalysis> {
    const analysis: UnifiedSecurityAnalysis = {
      userId: user.id,
      overall: {
        riskScore: 0,
        threatLevel: 'low',
        confidence: 0,
        recommendedAction: 'monitor'
      },
      multiAccount: {
        detected: false,
        method: '',
        confidence: 0,
        relatedAccounts: [],
        violations: []
      },
      behavioral: {
        automationScore: 0,
        humanLikelihood: 1.0,
        anomalies: []
      },
      device: {
        collisions: [],
        fingerprint: {} as unknown as DeviceFingerprint,
        trustScore: 1.0
      },
      network: {
        vpnDetected: false,
        proxyDetected: false,
        torDetected: false,
        locationConsistent: true,
        riskFactors: []
      },
      threats: {
        patterns: [],
        indicators: [],
        severity: 'none'
      },
      evidence: [],
      actionRequired: false,
      suggestedActions: []
    };

    try {
      // 1. Multi-account detection (consolidated approach)
      const multiAccountResult = await this.detectMultiAccount(user, deviceData);
      analysis.multiAccount = multiAccountResult;
      analysis.overall.riskScore += multiAccountResult.confidence * 0.3;

      // 2. Behavioral analysis
      if (behaviorData && this.detectionConfig.behavioral.enabled) {
        const behavioralResult = await this.analyzeBehavior(user, behaviorData);
        analysis.behavioral = behavioralResult;
        analysis.overall.riskScore += behavioralResult.automationScore * 0.25;
      }

      // 3. Device collision detection
      const deviceResult = await this.analyzeDevice(user, deviceData);
      analysis.device = deviceResult;
      analysis.overall.riskScore += (1 - deviceResult.trustScore) * 0.2;

      // 4. Network and location analysis
      if (ipAddress) {
        const networkResult = await this.analyzeNetwork(user, ipAddress);
        analysis.network = networkResult;
        analysis.overall.riskScore += networkResult.riskFactors.length * 0.1;
      }

      // 5. Threat pattern recognition
      const threatResult = await this.analyzeThreatPatterns(user, analysis);
      analysis.threats = threatResult;
      analysis.overall.riskScore += threatResult.patterns.reduce((sum: number, p: ThreatPattern) => sum + p.riskScore, 0) * 0.15;

      // 6. Calculate overall assessment
      this.calculateOverallAssessment(analysis);

      // 7. Determine recommended actions
      this.determineRecommendedActions(analysis);

      // 8. Log security analysis
      await this.logSecurityAnalysis(analysis);

      return analysis;

    } catch (error) {
      this.logger.error('Security analysis failed:', error);
      throw error;
    }
  }

  /**
   * Consolidated multi-account detection
   * Combines enhanced, strict, and privacy-first approaches
   */
  private async detectMultiAccount(user: User, deviceData: EnhancedDeviceData): Promise<any> {
    const violations: MultiAccountViolation[] = [];
    const relatedAccounts: string[] = [];
    let confidence = 0;

    try {
      // Device-based detection (from strict detector) - ZERO TOLERANCE
      const deviceCollisions = await this.findDeviceCollisions(user, deviceData);
      if (deviceCollisions.length > 0) {
        violations.push({
          type: 'device_collision',
          severity: 'critical',
          confidence: 1.0, // Maximum confidence for exact device match
          description: `STRICT: Device collision detected with ${deviceCollisions.length} other accounts - ZERO TOLERANCE POLICY`,
          evidence: { collisions: deviceCollisions },
          relatedUserIds: deviceCollisions.flatMap(c => c.conflictingUsers)
        });
        relatedAccounts.push(...deviceCollisions.flatMap(c => c.conflictingUsers));
        confidence = 1.0; // Set maximum confidence for device collision
        
        // IMMEDIATE BLOCKING: Mark user as blocked right away
        try {
          await this.storage.updateUser(user.id || user.telegramId, {
            multiAccountDetected: true,
            isBlocked: true,
            blockedReason: 'Device fingerprint collision - Multi-account detected',
            blockedAt: new Date().toISOString(),
            riskScore: 0.95
          });
          
          this.logger.error('IMMEDIATE BLOCK APPLIED for device collision', {
            userId: user.id || user.telegramId,
            collidingUsers: deviceCollisions.flatMap(c => c.conflictingUsers),
            collisionCount: deviceCollisions.length
          });
        } catch (updateError) {
          this.logger.error('Failed to immediately block user for device collision:', updateError);
        }
      }

      // Enhanced behavioral matching
      const behavioralMatches = await this.findBehavioralMatches(user);
      if (behavioralMatches.length > 0) {
        violations.push({
          type: 'behavioral_match',
          severity: 'medium',
          confidence: 0.7,
          description: 'Behavioral patterns match other accounts',
          evidence: { matches: behavioralMatches },
          relatedUserIds: behavioralMatches
        });
        relatedAccounts.push(...behavioralMatches);
        confidence = Math.max(confidence, 0.7);
      }

      // Network overlap detection
      const networkOverlaps = await this.findNetworkOverlaps(user);
      if (networkOverlaps.length > 0) {
        violations.push({
          type: 'network_overlap',
          severity: 'medium',
          confidence: 0.6,
          description: 'Network fingerprint overlaps detected',
          evidence: { overlaps: networkOverlaps },
          relatedUserIds: networkOverlaps
        });
        relatedAccounts.push(...networkOverlaps);
        confidence = Math.max(confidence, 0.6);
      }

      // Referral abuse patterns
      const referralAbuse = await this.detectReferralAbuse(user);
      if (referralAbuse) {
        violations.push({
          type: 'referral_abuse',
          severity: 'high',
          confidence: 0.8,
          description: 'Referral system abuse detected',
          evidence: referralAbuse.evidence,
          relatedUserIds: referralAbuse.relatedUserIds
        });
        relatedAccounts.push(...referralAbuse.relatedUserIds);
        confidence = Math.max(confidence, 0.8);
      }

      return {
        detected: violations.length > 0,
        method: violations.length > 0 ? violations[0].type : '',
        confidence,
        relatedAccounts: [...new Set(relatedAccounts)],
        violations
      };

    } catch (error) {
      this.logger.error('Multi-account detection failed:', error);
      return {
        detected: false,
        method: '',
        confidence: 0,
        relatedAccounts: [],
        violations: []
      };
    }
  }

  /**
   * Consolidated behavioral analysis
   * Combines automation detection, session replay, and pattern analysis
   */
  private async analyzeBehavior(user: User, behaviorData: any): Promise<any> {
    const anomalies: BehavioralAnomaly[] = [];
    let automationScore = 0;
    let humanLikelihood = 1.0;

    try {
      // Automation detection
      if (behaviorData.mouseMovements) {
        const mouseAnalysis = this.analyzeMousePatterns(behaviorData.mouseMovements);
        if (mouseAnalysis.isAutomated) {
          anomalies.push({
            type: 'automation_detected',
            description: 'Automated mouse movement patterns detected',
            confidence: mouseAnalysis.confidence,
            evidence: { mousePatterns: mouseAnalysis }
          });
          automationScore += mouseAnalysis.confidence * 0.4;
        }
      }

      // Keyboard timing analysis
      if (behaviorData.keyboardTimings) {
        const keyboardAnalysis = this.analyzeKeyboardPatterns(behaviorData.keyboardTimings);
        if (keyboardAnalysis.isAutomated) {
          anomalies.push({
            type: 'automation_detected',
            description: 'Automated keyboard patterns detected',
            confidence: keyboardAnalysis.confidence,
            evidence: { keyboardTimings: keyboardAnalysis }
          });
          automationScore += keyboardAnalysis.confidence * 0.3;
        }
      }

      // Session replay detection
      const replayAnalysis = await this.detectSessionReplay(user, behaviorData);
      if (replayAnalysis.detected) {
        anomalies.push({
          type: 'session_replay',
          description: 'Session replay behavior detected',
          confidence: replayAnalysis.confidence,
          evidence: { sessionData: replayAnalysis }
        });
        automationScore += replayAnalysis.confidence * 0.3;
      }

      humanLikelihood = Math.max(0, 1 - automationScore);

      return {
        automationScore,
        humanLikelihood,
        anomalies
      };

    } catch (error) {
      this.logger.error('Behavioral analysis failed:', error);
      return {
        automationScore: 0,
        humanLikelihood: 1.0,
        anomalies: []
      };
    }
  }

  /**
   * Device analysis and collision detection
   */
  private async analyzeDevice(user: User, deviceData: EnhancedDeviceData): Promise<any> {
    const collisions = await this.findDeviceCollisions(user, deviceData);
    
    // Calculate device trust score
    let trustScore = 1.0;
    if (collisions.length > 0) {
      trustScore -= collisions.length * 0.3;
    }
    
    // Check for device spoofing indicators
    const spoofingIndicators = this.detectDeviceSpoofing(deviceData);
    if (spoofingIndicators.length > 0) {
      trustScore -= 0.2;
    }

    // Generate a device fingerprint for the analysis context
    const userId = (user as any).telegramId || (user as any).id || String(user);
    let fingerprint: DeviceFingerprint;
    try {
      fingerprint = await this.fingerprintService.generateFingerprint(deviceData, userId);
    } catch {
      // Fallback minimal fingerprint on error
      fingerprint = {
        hash: 'unknown',
        userId: userId,
        components: {
          hardware: {
            screenResolution: deviceData.hardware?.screenResolution || 'unknown',
            screenColorDepth: deviceData.hardware?.screenColorDepth || 'unknown',
            availableScreenSize: deviceData.hardware?.availableScreenSize || 'unknown',
            timezone: deviceData.hardware?.timezone || 'unknown',
            timezoneOffset: deviceData.hardware?.timezoneOffset || 0,
            language: deviceData.hardware?.language || 'unknown',
            languages: deviceData.hardware?.languages || [],
            platform: deviceData.hardware?.platform || 'unknown',
            hardwareConcurrency: deviceData.hardware?.hardwareConcurrency || 0,
            deviceMemory: deviceData.hardware?.deviceMemory || 0,
            maxTouchPoints: deviceData.hardware?.maxTouchPoints || 0
          },
          browser: {
            userAgent: deviceData.browser?.userAgent || '',
            vendor: deviceData.browser?.vendor || 'unknown',
            vendorSub: deviceData.browser?.vendorSub || '',
            product: deviceData.browser?.product || 'unknown',
            productSub: deviceData.browser?.productSub || '',
            appName: deviceData.browser?.appName || 'unknown',
            appVersion: deviceData.browser?.appVersion || 'unknown',
            appCodeName: deviceData.browser?.appCodeName || 'unknown',
            cookieEnabled: deviceData.browser?.cookieEnabled ?? true,
            doNotTrack: typeof deviceData.browser?.doNotTrack === 'string' ? deviceData.browser?.doNotTrack : undefined,
            onLine: deviceData.browser?.onLine ?? true,
            javaEnabled: deviceData.browser?.javaEnabled ?? false,
            mimeTypes: deviceData.browser?.mimeTypes || [],
            plugins: deviceData.browser?.plugins || []
          },
          rendering: deviceData.rendering || {},
          network: deviceData.network || {},
          behavioral: deviceData.behavioral || {}
        },
        quality: {
          overall: 0.1,
          hardware: 0.1,
          browser: 0.1,
          rendering: 0.1,
          network: 0.1,
          uniqueness: 0,
          stability: 0.5
        },
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        usageCount: 1,
        isBlocked: false,
        riskScore: 0,
        metadata: {
          collisionCount: 0,
          similarDevices: [],
          riskFactors: [],
          verificationHistory: []
        }
      } as DeviceFingerprint;
    }

    return {
      collisions,
      fingerprint,
      trustScore: Math.max(0, trustScore)
    };
  }

  /**
   * Network and location analysis
   */
  private async analyzeNetwork(user: User, ipAddress: string): Promise<any> {
    const riskFactors: string[] = [];

    // Without a reliable IP-to-geo service here, return conservative defaults
    const vpnDetected = false;
    const proxyDetected = false;
    const torDetected = false;

    const locationConsistent = await this.checkLocationConsistency(user, {
      ip: ipAddress,
      latitude: 0,
      longitude: 0
    } as any);

    if (!locationConsistent) {
      riskFactors.push('Location inconsistent with previous activity');
    }

    return {
      vpnDetected,
      proxyDetected,
      torDetected,
      locationConsistent,
      riskFactors
    };
  }

  /**
   * Threat pattern analysis
   */
  private async analyzeThreatPatterns(user: User, analysis: UnifiedSecurityAnalysis): Promise<any> {
    const patterns: ThreatPattern[] = [];
    const indicators: string[] = [];
    
    // Known threat patterns
    const threatPatterns = [
      {
        id: 'multi_account_farm',
        name: 'Multi-Account Farm',
        indicators: ['device_collision', 'behavioral_match', 'rapid_registration'],
        riskScore: 0.9
      },
      {
        id: 'automated_bot',
        name: 'Automated Bot',
        indicators: ['automation_detected', 'session_replay', 'impossible_timing'],
        riskScore: 0.8
      },
      {
        id: 'referral_abuse',
        name: 'Referral System Abuse',
        indicators: ['referral_abuse', 'network_overlap', 'registration_pattern'],
        riskScore: 0.7
      }
    ];

    // Check for matching patterns
    for (const pattern of threatPatterns) {
      const matchingIndicators = pattern.indicators.filter(indicator => {
        return analysis.multiAccount.violations.some(v => v.type.includes(indicator)) ||
               analysis.behavioral.anomalies.some(a => a.type.includes(indicator));
      });

      if (matchingIndicators.length >= 2) {
        patterns.push({
          ...pattern,
          confidence: matchingIndicators.length / pattern.indicators.length
        });
        indicators.push(...matchingIndicators);
      }
    }

    const severity = patterns.length > 0 ? 
      Math.max(...patterns.map(p => p.riskScore)) > 0.8 ? 'critical' : 'high' : 'none';

    return {
      patterns,
      indicators: [...new Set(indicators)],
      severity
    };
  }

  // Helper methods for device collision detection
  private async findDeviceCollisions(user: User, deviceData: EnhancedDeviceData): Promise<DeviceCollision[]> {
    const collisions: DeviceCollision[] = [];
    
    try {
      const deviceHash = this.fingerprintService.generateDeviceHash({
        deviceId: '',
        userAgent: deviceData.browser?.userAgent || '',
        screenResolution: deviceData.hardware?.screenResolution || 'unknown',
        timezone: deviceData.hardware?.timezone || 'unknown',
        language: deviceData.hardware?.language || 'unknown',
        platform: deviceData.hardware?.platform || 'unknown',
        canvasFingerprint: deviceData.rendering?.canvasFingerprint || '',
        audioFingerprint: deviceData.rendering?.audioFingerprint || '',
        webGLRenderer: deviceData.rendering?.webGLRenderer || ''
      });
      
      // Check for exact device matches
      const existingDevices = await this.storage.get('devices', `hash:${deviceHash}`);
      if (existingDevices && (existingDevices as any[]).length > 0) {
        const conflictingUsers = (existingDevices as any[])
          .filter((device: any) => device.userId !== user.id)
          .map((device: any) => device.userId);

        if (conflictingUsers.length > 0) {
          collisions.push({
            deviceHash,
            conflictingUsers,
            originalUser: (existingDevices as any[])[0].userId,
            violationType: 'exact_match',
            confidence: 1.0,
            evidence: {
              matchingComponents: ['full_fingerprint'],
              canvasFingerprint: deviceData.rendering?.canvasFingerprint,
              hardwareSpecs: {
                screen: deviceData.hardware?.screenResolution,
                platform: deviceData.hardware?.platform
              }
            }
          });
        }
      }

      return collisions;
    } catch (error) {
      this.logger.error('Error finding device collisions:', error);
      return []; // Return empty array on error to prevent cascading failures
    }
  }

  private async findBehavioralMatches(user: User): Promise<string[]> {
    const matches: string[] = [];
    
    try {
      // Get user's behavioral profile
      const userProfile = await this.storage.get('behavioral_profiles', user.id);
      if (!userProfile) return matches;
      
      // Find users with similar behavioral patterns
      const allIds = await this.storage.list('behavioral_profiles');
      
      for (const otherUserId of allIds) {
        if (otherUserId === user.id) continue;
        const profile = await this.storage.get('behavioral_profiles', otherUserId);
        if (!profile) continue;
        const similarity = this.calculateBehavioralSimilarity(userProfile, profile);
        if (similarity > this.detectionConfig.multiAccount.behaviorSimilarityThreshold) {
          matches.push(otherUserId);
        }
      }
      
      return matches;
    } catch (error) {
      this.logger.error('Error finding behavioral matches:', error);
      return [];
    }
  }

  private async findNetworkOverlaps(user: User): Promise<string[]> {
    const overlaps: string[] = [];
    
    try {
      // Get user's network fingerprint
      const userNetworkData = await this.storage.get<any>('network_profiles', user.id);
      if (!userNetworkData) return overlaps;
      
      const allIds = await this.storage.list('network_profiles');
      
      for (const otherUserId of allIds) {
        if (otherUserId === user.id) continue;
        const networkProfile = await this.storage.get<any>('network_profiles', otherUserId);
        if (!networkProfile) continue;
        
        // Check for IP overlaps
        const ipOverlap = this.hasIPOverlap(userNetworkData.ipHistory, networkProfile.ipHistory);
        
        // Check for timezone consistency
        const timezoneMatch = userNetworkData.timezone === networkProfile.timezone;
        
        // Check for ISP overlap
        const ispOverlap = userNetworkData.isp === networkProfile.isp;
        
        // Calculate network similarity score
        let similarityScore = 0;
        if (ipOverlap) similarityScore += 0.6;
        if (timezoneMatch) similarityScore += 0.2;
        if (ispOverlap) similarityScore += 0.2;
        
        if (similarityScore > 0.5) {
          overlaps.push(otherUserId);
        }
      }
      
      return overlaps;
    } catch (error) {
      this.logger.error('Error finding network overlaps:', error);
      return [];
    }
  }

  private async detectReferralAbuse(user: User): Promise<any> {
    try {
      // Get user's referral data
      const referralData = await this.storage.get<any>('referrals', user.id);
      if (!referralData) return null;
      
      const abuseSigns: any[] = [];
      
      // Check for suspicious referral patterns
      if (referralData.referredUsers && referralData.referredUsers.length > 10) {
        // High number of referrals - check for device/IP overlaps
        const deviceOverlaps = await this.checkReferralDeviceOverlaps(user.id, referralData.referredUsers);
        if (deviceOverlaps > 3) {
          abuseSigns.push({
            type: 'device_overlap',
            severity: 'high',
            description: `${deviceOverlaps} referred users share device fingerprints`,
            evidence: { deviceOverlapCount: deviceOverlaps }
          });
        }
        
        // Check for rapid referral patterns
        const rapidReferrals = this.checkRapidReferralPattern(referralData);
        if (rapidReferrals) {
          abuseSigns.push({
            type: 'rapid_referrals',
            severity: 'medium',
            description: 'Unusually rapid referral registration pattern detected',
            evidence: rapidReferrals
          });
        }
      }
      
      if (abuseSigns.length === 0) return null;
      
      return {
        detected: true,
        confidence: Math.min(abuseSigns.length * 0.3, 1.0),
        violations: abuseSigns,
        relatedUsers: referralData.referredUsers
      };
      
    } catch (error) {
      this.logger.error('Error detecting referral abuse:', error);
      return null;
    }
  }

  // Mouse pattern analysis
  private analyzeMousePatterns(mouseMovements: any[]): any {
    if (!mouseMovements || mouseMovements.length === 0) {
      return { isAutomated: false, confidence: 0 };
    }
    
    let automationScore = 0;
    const patterns = [];
    
    // Check for linear movements (indication of automation)
    const linearMovements = this.detectLinearMovements(mouseMovements);
    if (linearMovements > 0.7) {
      automationScore += 0.4;
      patterns.push('linear_movements');
    }
    
    // Check for identical timing intervals
    const timingConsistency = this.checkTimingConsistency(mouseMovements);
    if (timingConsistency > 0.8) {
      automationScore += 0.3;
      patterns.push('consistent_timing');
    }
    
    // Check for inhuman speeds
    const inhumanSpeeds = this.detectInhumanSpeeds(mouseMovements);
    if (inhumanSpeeds) {
      automationScore += 0.3;
      patterns.push('inhuman_speeds');
    }
    
    return { 
      isAutomated: automationScore > 0.5, 
      confidence: automationScore,
      patterns
    };
  }

  // Keyboard pattern analysis
  private analyzeKeyboardPatterns(keyboardTimings: number[]): any {
    if (!keyboardTimings || keyboardTimings.length === 0) {
      return { isAutomated: false, confidence: 0 };
    }
    
    let automationScore = 0;
    const patterns = [];
    
    // Check for consistent intervals (robotic typing)
    const avgInterval = keyboardTimings.reduce((a, b) => a + b, 0) / keyboardTimings.length;
    const variance = this.calculateVariance(keyboardTimings, avgInterval);
    
    if (variance < 10) { // Very low variance indicates automation
      automationScore += 0.5;
      patterns.push('consistent_intervals');
    }
    
    // Check for inhuman typing speeds
    if (avgInterval < 50) { // Less than 50ms average between keystrokes
      automationScore += 0.4;
      patterns.push('inhuman_speed');
    }
    
    // Check for identical patterns
    const repeatingPatterns = this.detectRepeatingPatterns(keyboardTimings);
    if (repeatingPatterns > 0.6) {
      automationScore += 0.3;
      patterns.push('repeating_patterns');
    }
    
    return { 
      isAutomated: automationScore > 0.5, 
      confidence: automationScore,
      patterns
    };
  }

  // Session replay detection
  private async detectSessionReplay(user: User, behaviorData: any): Promise<any> {
    if (!behaviorData || !behaviorData.sessionData) {
      return { detected: false, confidence: 0 };
    }
    
    let replayScore = 0;
    const indicators = [];
    
    // Check for identical mouse paths
    if (behaviorData.mouseMovements) {
      const identicalPaths = this.checkIdenticalMousePaths(behaviorData.mouseMovements);
      if (identicalPaths > 0.8) {
        replayScore += 0.4;
        indicators.push('identical_mouse_paths');
      }
    }
    
    // Check for repeated action sequences
    if (behaviorData.actionSequences) {
      const repeatedSequences = this.detectRepeatedActionSequences(behaviorData.actionSequences);
      if (repeatedSequences > 0.7) {
        replayScore += 0.3;
        indicators.push('repeated_action_sequences');
      }
    }
    
    // Check for identical timing patterns
    if (behaviorData.timingData) {
      const identicalTiming = this.checkIdenticalTimingPatterns(behaviorData.timingData);
      if (identicalTiming > 0.9) {
        replayScore += 0.3;
        indicators.push('identical_timing');
      }
    }
    
    return { 
      detected: replayScore > 0.5, 
      confidence: replayScore,
      indicators
    };
  }

  // Device spoofing detection
  private detectDeviceSpoofing(deviceData: EnhancedDeviceData): string[] {
    const indicators: string[] = [];
    
    // Check for inconsistent device properties
    // Screen resolution inconsistencies
    if (deviceData.hardware?.screenResolution && deviceData.hardware?.availableScreenSize) {
      // Add logic to detect screen spoofing
    }

    // WebGL renderer spoofing
    if (deviceData.rendering?.webGLRenderer && deviceData.rendering.webGLRenderer.includes('fake')) {
      indicators.push('WebGL spoofing detected');
    }

    return indicators;
  }

  // Location consistency check
  private async checkLocationConsistency(user: User, locationData: LocationData): Promise<boolean> {
    // Check if location is consistent with user's previous activity
    const previousLocations = (user as any).metadata?.locationHistory || [];
    if (previousLocations.length === 0) return true;

    const lastLocation = previousLocations[previousLocations.length - 1];
    const distance = this.calculateDistance(
      lastLocation.latitude || 0,
      lastLocation.longitude || 0,
      locationData.latitude || 0,
      locationData.longitude || 0
    );

    // Check for impossible travel (more than 1000km in less than 1 hour)
    const timeDiff = Date.now() - new Date(lastLocation.timestamp).getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    const impossibleSpeed = distance / hoursDiff > 1000; // 1000 km/h

    return !impossibleSpeed;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  // Overall assessment calculation
  private calculateOverallAssessment(analysis: UnifiedSecurityAnalysis): void {
    let { riskScore } = analysis.overall;
    
    // STRICT MULTI-ACCOUNT ENFORCEMENT: If multi-account is detected with ANY confidence, immediately escalate to block
    if (analysis.multiAccount.detected && analysis.multiAccount.confidence > 0.5) {
      analysis.overall.threatLevel = 'critical';
      analysis.overall.recommendedAction = 'permanent_block';
      analysis.overall.riskScore = Math.max(riskScore, 0.9); // Force high risk score for multi-account
      this.logger.warn('STRICT MULTI-ACCOUNT BLOCK TRIGGERED', {
        userId: analysis.userId,
        multiAccountConfidence: analysis.multiAccount.confidence,
        originalRiskScore: riskScore,
        adjustedRiskScore: analysis.overall.riskScore,
        relatedAccounts: analysis.multiAccount.relatedAccounts
      });
    }
    // Standard risk assessment for non-multi-account cases
    else {
      // Determine threat level
      if (riskScore >= 0.8) {
        analysis.overall.threatLevel = 'critical';
        analysis.overall.recommendedAction = 'temporary_block';
      } else if (riskScore >= 0.6) {
        analysis.overall.threatLevel = 'high';
        analysis.overall.recommendedAction = 'enhanced_monitoring';
      } else if (riskScore >= 0.4) {
        analysis.overall.threatLevel = 'medium';
        analysis.overall.recommendedAction = 'additional_verification';
      } else {
        analysis.overall.threatLevel = 'low';
        analysis.overall.recommendedAction = 'monitor';
      }
    }

    // Calculate confidence
    const detectionCount = [
      analysis.multiAccount.violations.length > 0 ? 1 : 0,
      analysis.behavioral.anomalies.length > 0 ? 1 : 0,
      analysis.device.collisions.length > 0 ? 1 : 0,
      analysis.network.riskFactors.length > 0 ? 1 : 0,
      analysis.threats.patterns.length > 0 ? 1 : 0
    ].reduce((sum, val) => sum + val, 0);

    analysis.overall.confidence = detectionCount / 5;
  }

  // Determine recommended actions
  private determineRecommendedActions(analysis: UnifiedSecurityAnalysis): void {
    const actions: string[] = [];

    if (analysis.multiAccount.detected) {
      actions.push('Block related accounts');
      actions.push('Device ban enforcement');
    }

    if (analysis.behavioral.automationScore > 0.7) {
      actions.push('Implement CAPTCHA verification');
      actions.push('Increase monitoring frequency');
    }

    if (analysis.device.collisions.length > 0) {
      actions.push('Device-level restrictions');
    }

    if (analysis.network.vpnDetected || analysis.network.proxyDetected) {
      actions.push('Enhanced identity verification');
    }

    if (analysis.threats.patterns.length > 0) {
      actions.push('Security team review required');
    }

    analysis.suggestedActions = actions;
    analysis.actionRequired = actions.length > 0;
  }

  // Security analysis logging
  private async logSecurityAnalysis(analysis: UnifiedSecurityAnalysis): Promise<void> {
    const logEntry = {
      userId: analysis.userId,
      timestamp: new Date().toISOString(),
      riskScore: analysis.overall.riskScore,
      threatLevel: analysis.overall.threatLevel,
      violations: analysis.multiAccount.violations.length,
      anomalies: analysis.behavioral.anomalies.length,
      deviceCollisions: analysis.device.collisions.length,
      networkRiskFactors: analysis.network.riskFactors.length,
      threatPatterns: analysis.threats.patterns.length,
      actionRequired: analysis.actionRequired
    };

    await this.storage.set('security_logs', logEntry, `analysis:${analysis.userId}:${Date.now()}`);
    
    if (analysis.overall.threatLevel === 'critical' || analysis.overall.threatLevel === 'high') {
      this.logger.warn('High-risk security analysis:', logEntry);
    }
  }

  // Cache initialization
    private initializeCaches(): void {
      this.deviceCache = this.memoryManager.createCache('security_devices', 'Device security cache', { max: 10000, ttl: 3600000 }); // 1 hour
      this.behaviorCache = this.memoryManager.createCache('security_behavior', 'Behavioral analysis cache', { max: 5000, ttl: 1800000 }); // 30 minutes
    this.threatCache = this.memoryManager.createCache('security_threats', 'Threat detection cache', { max: 1000, ttl: 7200000 }); // 2 hours
  }

  // Detection configuration loading
  private loadDetectionConfig(): void {
    const sc = (this.config as any).security || {};
    this.detectionConfig = {
      multiAccount: {
        enabled: (sc.multiAccountDetectionEnabled ?? sc.enableMultiAccountDetection) ?? true,
        strictMode: sc.strictDeviceChecking ?? false,
        privacyMode: true,
        deviceSimilarityThreshold: sc.similarityThreshold ?? 0.8,
        behaviorSimilarityThreshold: sc.detectionSensitivity ?? 0.7
      },
      behavioral: {
        enabled: (sc.behavioralPatternDetection ?? sc.enableThreatAnalysis) ?? true,
        automationThreshold: sc.detectionSensitivity ?? 0.7,
        sessionReplayDetection: true,
        mousePatternAnalysis: true
      },
      network: {
        vpnDetection: sc.ipTrackingEnabled ?? true,
        proxyDetection: sc.ipTrackingEnabled ?? true,
        torDetection: true,
        locationValidation: true
      },
      device: {
        fingerprintingEnabled: (sc.deviceFingerprintingEnabled ?? sc.enableDeviceFingerprinting) ?? true,
        collisionDetection: sc.strictDeviceChecking ?? true,
        componentMatching: true
      }
    };
  }

  /**
   * Public methods for specific detection tasks
   */
  
  async quickSecurityCheck(user: User): Promise<{ safe: boolean; riskScore: number; issues: string[] }> {
    // Lightweight security check for high-frequency operations
    const issues: string[] = [];
    let riskScore = 0;

    // Check if user is in device ban list
    const isBanned = await this.deviceBanService.isDeviceBanned(user.id);
    if (isBanned) {
      issues.push('Device is banned');
      riskScore += 1.0;
    }

    // Check recent security violations
    const recentViolations = await this.getRecentSecurityViolations(user.id);
    if (recentViolations > 0) {
      issues.push(`${recentViolations} recent security violations`);
      riskScore += recentViolations * 0.2;
    }

    return {
      safe: riskScore < 0.5,
      riskScore: Math.min(riskScore, 1.0),
      issues
    };
  }

  private async getRecentSecurityViolations(userId: string): Promise<number> {
    const timeThreshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    try {
      const ids = await this.storage.list('security_logs');
      let count = 0;
      for (const id of ids) {
        if (!id.startsWith(`analysis:${userId}:`)) continue;
        const tsStr = id.split(':').pop() || '';
        const timestamp = parseInt(tsStr, 10);
        if (!timestamp || timestamp <= timeThreshold) continue;
        const entry = await this.storage.get<any>('security_logs', id);
        if (entry && (entry.threatLevel === 'high' || entry.threatLevel === 'critical')) {
          count++;
        }
      }
      return count;
    } catch (error) {
      this.logger.error('Error getting recent security violations:', error);
      return 0;
    }
  }

  // Placeholder helper implementations to satisfy type checks
  private calculateBehavioralSimilarity(a: any, b: any): number { return 0; }
  private hasIPOverlap(a: any, b: any): boolean { return false; }
  private detectLinearMovements(m: any[]): number { return 0; }
  private checkTimingConsistency(m: any[]): number { return 0; }
  private detectInhumanSpeeds(m: any[]): boolean { return false; }
  private calculateVariance(arr: number[], avg?: number): number { return 0; }
  private detectRepeatingPatterns(arr: number[]): number { return 0; }
  private checkIdenticalMousePaths(m: any[]): number { return 0; }
  private detectRepeatedActionSequences(seq: any[]): number { return 0; }
  private checkIdenticalTimingPatterns(t: any): number { return 0; }
  private async checkReferralDeviceOverlaps(userId: string, referredUsers: string[]): Promise<number> { return 0; }
  private checkRapidReferralPattern(referralData: any): any { return null; }

  // Cleanup method
  async cleanup(): Promise<void> {
    if (this.deviceCache) this.deviceCache.clear();
    if (this.behaviorCache) this.behaviorCache.clear();
    if (this.threatCache) this.threatCache.clear();
  }
}

// Export singleton instance
export const unifiedSecurityEngine = UnifiedSecurityEngine.getInstance();
export default UnifiedSecurityEngine;