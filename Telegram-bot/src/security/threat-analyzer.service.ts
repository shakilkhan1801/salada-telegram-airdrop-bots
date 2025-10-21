import { 
  ThreatAnalysis, 
  SecurityAuditLog, 
  DeviceFingerprint, 
  MultiAccountDetection,
  RiskFactor 
} from '../types/security.types';
import { User } from '../types/user.types';
import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { unifiedSecurityEngine } from './unified-security-engine';
import { MemoryManager } from '../services/memory-manager.service';

export interface ThreatScore {
  overall: number;
  categories: {
    deviceRisk: number;
    behaviorRisk: number;
    networkRisk: number;
    accountRisk: number;
  };
  confidence: number;
}

export interface SecurityEvent {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  userId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ThreatPattern {
  id: string;
  name: string;
  description: string;
  indicators: string[];
  riskScore: number;
  confidence: number;
}

export class ThreatAnalyzer {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly fingerprintService = new DeviceFingerprintService();
  private readonly securityEngine = unifiedSecurityEngine;
  private readonly memoryManager = MemoryManager.getInstance();
  private readonly knownThreats: any;

  constructor() {
    // Initialize managed LRU cache for threat patterns (permanent reference data)
    this.knownThreats = this.memoryManager.createCache<string, ThreatPattern>(
      'threat-patterns',
      'Known threat patterns cache',
      { max: 1000 } // Max 1000 threat patterns, no TTL (permanent data)
    );
    this.initializeKnownThreats();
  }

  /**
   * Perform comprehensive threat analysis for a user
   */
  async analyzeUser(
    user: User,
    fingerprint?: DeviceFingerprint,
    relatedUsers: User[] = [],
    relatedFingerprints: DeviceFingerprint[] = [],
    recentActivity: any[] = []
  ): Promise<ThreatAnalysis> {
    const analysisStart = Date.now();
    
    try {
      // Device-based threat analysis (only if fingerprint is available)
      const deviceThreats = fingerprint ? await this.analyzeDeviceThreats(fingerprint) : [];
      
      // Multi-account detection - use unified engine if available via separate flow; fallback to empty analysis here
      const multiAccountAnalysis = {
        userId: user.telegramId,
        riskScore: 0, 
        riskFactors: [],
        suspiciousAccounts: [],
        detectionMethods: [],
        confidence: 0,
        timestamp: new Date(),
        actionRequired: false
      };

      // Behavioral analysis
      const behaviorThreats = await this.analyzeBehaviorThreats(user, recentActivity);

      // Network-based threats (only if fingerprint is available)
      const networkThreats = fingerprint ? await this.analyzeNetworkThreats(user, fingerprint) : [];

      // Account-specific threats
      const accountThreats = await this.analyzeAccountThreats(user);

      // Aggregate all threats
      const allThreats = [
        ...deviceThreats,
        ...multiAccountAnalysis.riskFactors,
        ...behaviorThreats,
        ...networkThreats,
        ...accountThreats
      ];

      // Calculate overall threat score
      const threatScore = this.calculateThreatScore(allThreats);

      // Determine action recommendations
      const recommendations = this.generateRecommendations(allThreats, threatScore);

      // Check against known threat patterns
      const matchedPatterns = this.matchThreatPatterns(allThreats);

      // Determine threat level based on overall score
      const threatLevel: 'low' | 'medium' | 'high' | 'critical' = 
        threatScore.overall >= 0.8 ? 'critical' :
        threatScore.overall >= 0.6 ? 'high' :
        threatScore.overall >= 0.4 ? 'medium' : 'low';

      // Convert recommendations to SecurityRecommendation format
      const securityRecommendations = recommendations.map(rec => ({
        action: 'monitor' as const,
        priority: threatLevel === 'critical' ? 'urgent' as const : 
                 threatLevel === 'high' ? 'high' as const :
                 threatLevel === 'medium' ? 'medium' as const : 'low' as const,
        description: rec,
        reason: `Threat analysis indicates ${threatLevel} risk`,
        automated: true,
        requiresAdmin: threatLevel === 'critical' || threatLevel === 'high'
      }));

      const analysis: ThreatAnalysis = {
        userId: user.telegramId,
        overallRiskScore: threatScore.overall,
        threatLevel,
        riskFactors: allThreats,
        recommendations: securityRecommendations,
        analysisTimestamp: new Date().toISOString(),
        metadata: {
          analysisVersion: '1.0',
          detectionMethods: matchedPatterns,
          confidence: threatScore.confidence,
          falsePositiveRisk: Math.max(0, 1 - threatScore.confidence),
          adminNotified: false,
          automaticAction: threatLevel === 'critical' ? 'permanent_block' :
                          threatLevel === 'high' ? 'temporary_block' : undefined,
          customData: {
            categories: {
              deviceSecurity: threatScore.categories.deviceRisk,
              behaviorAnalysis: threatScore.categories.behaviorRisk,
              networkSecurity: threatScore.categories.networkRisk,
              accountSecurity: threatScore.categories.accountRisk
            },
            multiAccountRisk: multiAccountAnalysis.riskScore,
            processingTimeMs: Date.now() - analysisStart
          }
        }
      };

      this.logger.info('Threat analysis completed', {
        userId: user.telegramId,
        overallRiskScore: analysis.overallRiskScore,
        threatLevel: analysis.threatLevel,
        riskFactors: allThreats.length,
        processingTime: analysis.metadata.customData?.processingTimeMs
      });

      return analysis;
    } catch (error) {
      this.logger.error('Threat analysis failed:', error);
      throw error;
    }
  }

  /**
   * Analyze threats across multiple users for patterns
   */
  async analyzeBatch(
    users: User[],
    fingerprints: DeviceFingerprint[]
  ): Promise<{
    individualAnalyses: ThreatAnalysis[];
    clusterThreats: Array<{
      users: string[];
      threatType: string;
      riskScore: number;
      description: string;
    }>;
    emergingPatterns: ThreatPattern[];
  }> {
    const individualAnalyses: ThreatAnalysis[] = [];
    
    // Analyze each user individually
    for (const user of users) {
      const userFingerprint = fingerprints.find(fp => fp.userId === user.telegramId);
      if (!userFingerprint) continue;

      const relatedUsers = users.filter(u => u.telegramId !== user.telegramId);
      const relatedFingerprints = fingerprints.filter(fp => fp.userId !== user.telegramId);

      const analysis = await this.analyzeUser(
        user, 
        userFingerprint, 
        relatedUsers, 
        relatedFingerprints
      );
      
      individualAnalyses.push(analysis);
    }

    // Analyze cluster threats
    const clusterThreats = await this.analyzeClusterThreats(users, fingerprints);

    // Detect emerging patterns
    const emergingPatterns = this.detectEmergingPatterns(individualAnalyses);

    return {
      individualAnalyses,
      clusterThreats,
      emergingPatterns
    };
  }

  /**
   * Real-time threat monitoring for active sessions
   */
  async monitorRealTime(
    userId: string,
    event: SecurityEvent
  ): Promise<{
    immediateThreats: RiskFactor[];
    shouldBlock: boolean;
    shouldFlag: boolean;
    responseActions: string[];
  }> {
    const immediateThreats: RiskFactor[] = [];
    let shouldBlock = false;
    let shouldFlag = false;
    const responseActions: string[] = [];

    // Analyze the specific event
    const eventThreats = await this.analyzeSecurityEvent(event);
    immediateThreats.push(...eventThreats);

    // Check for rapid-fire suspicious activities
    const rapidFire = await this.detectRapidFireActivity(userId, event);
    if (rapidFire.detected) {
      immediateThreats.push({
        type: 'behavioral_anomaly',
        severity: 'high',
        score: rapidFire.confidence,
        description: `Rapid-fire ${event.type} detected`,
        evidence: rapidFire,
        detectedAt: new Date().toISOString()
      });
      shouldFlag = true;
    }

    // Check for known attack patterns
    const attackPattern = this.detectAttackPattern(event);
    if (attackPattern) {
      immediateThreats.push({
        type: 'critical_device_violation',
        severity: 'critical',
        score: attackPattern.confidence,
        description: `Known attack pattern: ${attackPattern.name}`,
        evidence: { pattern: attackPattern },
        detectedAt: new Date().toISOString()
      });
      shouldBlock = true;
      responseActions.push('block_user', 'log_security_incident');
    }

    // Calculate overall immediate risk
    const overallRisk = this.calculateImmediateRisk(immediateThreats);
    
    if (overallRisk >= 0.8) {
      shouldBlock = true;
      responseActions.push('immediate_suspension');
    } else if (overallRisk >= 0.6) {
      shouldFlag = true;
      responseActions.push('enhanced_monitoring');
    }

    // Log the real-time analysis
    this.logger.warn('Real-time threat analysis', {
      userId,
      event: event.type,
      immediateRisk: overallRisk,
      shouldBlock,
      shouldFlag,
      threatsDetected: immediateThreats.length
    });

    return {
      immediateThreats,
      shouldBlock,
      shouldFlag,
      responseActions
    };
  }

  /**
   * Generate security audit log entry
   */
  createAuditLog(
    analysis: ThreatAnalysis,
    actionTaken?: string
  ): SecurityAuditLog {
    const severityMap: Record<ThreatAnalysis['threatLevel'], 'info' | 'warning' | 'error' | 'critical'> = {
      low: 'info',
      medium: 'warning',
      high: 'error',
      critical: 'critical'
    };

    return {
      id: `audit_${Date.now()}_${analysis.userId}`,
      timestamp: new Date().toISOString(),
      action: 'threat_analyzed',
      performedBy: analysis.userId,
      targetUserId: analysis.userId,
      details: {
        reason: `Threat analysis completed with score ${analysis.overallRiskScore.toFixed(2)}`,
        riskScore: analysis.overallRiskScore,
        automatedAction: false,
        appealable: true
      },
      severity: severityMap[analysis.threatLevel],
      metadata: {
        riskFactors: analysis.riskFactors.length
      }
    } as SecurityAuditLog;
  }

  private async analyzeDeviceThreats(
    fingerprint: DeviceFingerprint
  ): Promise<RiskFactor[]> {
    const threats: RiskFactor[] = [];

    const timestamp = new Date().toISOString();

    // Check for bot behavior
    const botAnalysis = this.fingerprintService.detectBotBehavior(fingerprint);
    if (botAnalysis.isBot) {
      threats.push({
        type: 'bot_detected',
        severity: 'high',
        score: botAnalysis.confidence,
        description: `Bot behavior detected: ${botAnalysis.indicators.join(', ')}`,
        evidence: { indicators: botAnalysis.indicators },
        detectedAt: timestamp
      });
    }

    // Check device risk score
    if (fingerprint.riskScore >= 0.7) {
      threats.push({
        type: 'critical_device_violation',
        severity: 'medium',
        score: fingerprint.riskScore,
        description: 'Device exhibits high-risk characteristics',
        evidence: { riskScore: fingerprint.riskScore },
        detectedAt: timestamp
      });
    }

    // Check for suspicious fingerprint changes
    const suspiciousChanges = (fingerprint.metadata as any)?.suspiciousChanges as string[] | undefined;
    if (suspiciousChanges && suspiciousChanges.length > 0) {
      threats.push({
        type: 'device_fingerprint_mismatch',
        severity: 'medium',
        score: 0.8,
        description: `Suspicious device changes: ${suspiciousChanges.join(', ')}`,
        evidence: { changes: suspiciousChanges },
        detectedAt: timestamp
      });
    }

    return threats;
  }

  private async analyzeBehaviorThreats(
    user: User,
    recentActivity: any[]
  ): Promise<RiskFactor[]> {
    const threats: RiskFactor[] = [];

    const timestamp = new Date().toISOString();

    // Check for unusual activity patterns
    const activityPattern = this.analyzeBehaviorPattern(user, recentActivity);
    if (activityPattern.suspicious) {
      threats.push({
        type: 'behavioral_anomaly',
        severity: activityPattern.severity,
        score: activityPattern.confidence,
        description: activityPattern.description,
        evidence: activityPattern.details,
        detectedAt: timestamp
      });
    }

    // Check for rapid point accumulation
    if (user.points > 0) {
      const pointsPerDay = this.calculatePointsPerDay(user);
      const maxPerDay = this.config.security?.detectionSensitivity
        ? Math.max(1000, Math.floor(10000 * this.config.security.detectionSensitivity))
        : 10000;
      if (pointsPerDay > maxPerDay) {
        threats.push({
          type: 'behavioral_anomaly',
          severity: 'high',
          score: 0.9,
          description: `Excessive point accumulation: ${pointsPerDay} points/day`,
          evidence: { pointsPerDay, threshold: maxPerDay },
          detectedAt: timestamp
        });
      }
    }

    return threats;
  }

  private async analyzeNetworkThreats(
    user: User,
    fingerprint: DeviceFingerprint
  ): Promise<RiskFactor[]> {
    const threats: RiskFactor[] = [];

    const timestamp = new Date().toISOString();

    // Check for VPN/Proxy usage
    const vpnRisk = this.detectVPNUsage(fingerprint);
    if (vpnRisk.detected) {
      threats.push({
        type: 'vpn_detected',
        severity: 'medium',
        score: vpnRisk.confidence,
        description: 'VPN or proxy usage detected',
        evidence: vpnRisk,
        detectedAt: timestamp
      });
    }

    return threats;
  }

  private async analyzeAccountThreats(user: User): Promise<RiskFactor[]> {
    const threats: RiskFactor[] = [];

    // Check account age (handle both registeredAt and joinedAt field names)
    try {
      // Try different field names for compatibility
      const dateString = (user as any).registeredAt || (user as any).firstSeen || (user as any).joinedAt;
      
      if (!dateString) {
        this.logger.warn(`No registration date found for user ${user.id}`);
        return threats;
      }
      
      const joinedDate = new Date(dateString);
      
      // Validate date
      if (isNaN(joinedDate.getTime())) {
        this.logger.warn(`Invalid registration date for user ${user.id}: ${dateString}`);
        return threats;
      }
      
      const accountAge = Date.now() - joinedDate.getTime();
      const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);
    
    if (accountAgeDays < 1 && user.points > 100) {
      threats.push({
        type: 'behavioral_anomaly',
        severity: 'medium',
        score: 0.7,
        description: 'New account with unusually high activity',
        evidence: { accountAgeDays, points: user.points },
        detectedAt: new Date().toISOString()
      });
    }
    } catch (error) {
      this.logger.error('Error analyzing account age:', error);
    }

    // Check for suspicious wallet patterns
    if (user.walletAddress) {
      const walletRisk = this.analyzeWalletRisk(user.walletAddress);
      if (walletRisk.risky) {
        threats.push({
          type: 'behavioral_anomaly',
          severity: walletRisk.severity,
          score: walletRisk.confidence,
          description: walletRisk.description,
          evidence: { walletAddress: user.walletAddress },
          detectedAt: new Date().toISOString()
        });
      }
    }

    return threats;
  }

  private calculateThreatScore(riskFactors: RiskFactor[]): ThreatScore {
    let deviceRisk = 0;
    let behaviorRisk = 0;
    let networkRisk = 0;
    let accountRisk = 0;
    let totalScore = 0;

    const categoryMapping: Record<string, 'device' | 'behavior' | 'network' | 'account'> = {
      bot_detected: 'device',
      critical_device_violation: 'device',
      device_fingerprint_mismatch: 'device',
      behavioral_anomaly: 'behavior',
      vpn_detected: 'network',
      proxy_detected: 'network'
    };

    riskFactors.forEach(factor => {
      const severityWeight = {
        low: 0.1,
        medium: 0.3,
        high: 0.6,
        critical: 1.0
      }[factor.severity];

      const risk = severityWeight * factor.score;
      const category = categoryMapping[factor.type] || 'account';

      switch (category) {
        case 'device':
          deviceRisk += risk;
          break;
        case 'behavior':
          behaviorRisk += risk;
          break;
        case 'network':
          networkRisk += risk;
          break;
        case 'account':
          accountRisk += risk;
          break;
      }

      totalScore += factor.score;
    });

    // Normalize scores
    deviceRisk = Math.min(deviceRisk, 1.0);
    behaviorRisk = Math.min(behaviorRisk, 1.0);
    networkRisk = Math.min(networkRisk, 1.0);
    accountRisk = Math.min(accountRisk, 1.0);

    const overall = (deviceRisk + behaviorRisk + networkRisk + accountRisk) / 4;
    const confidence = riskFactors.length > 0 ? totalScore / riskFactors.length : 0;

    return {
      overall: Math.min(overall, 1.0),
      categories: {
        deviceRisk,
        behaviorRisk,
        networkRisk,
        accountRisk
      },
      confidence
    };
  }

  private generateRecommendations(
    riskFactors: RiskFactor[],
    threatScore: ThreatScore
  ): string[] {
    const recommendations: string[] = [];

    if (threatScore.overall >= 0.8) {
      recommendations.push('Immediate account suspension recommended');
      recommendations.push('Manual review required');
    } else if (threatScore.overall >= 0.6) {
      recommendations.push('Enhanced monitoring required');
      recommendations.push('Restrict high-value operations');
    } else if (threatScore.overall >= 0.4) {
      recommendations.push('Increased verification requirements');
      recommendations.push('Monitor for escalating behavior');
    }

    // Category-specific recommendations
    if (threatScore.categories.deviceRisk >= 0.7) {
      recommendations.push('Device fingerprint verification required');
    }

    if (threatScore.categories.behaviorRisk >= 0.7) {
      recommendations.push('Behavioral analysis and pattern monitoring');
    }

    if (threatScore.categories.networkRisk >= 0.7) {
      recommendations.push('Network security verification required');
    }

    if (threatScore.categories.accountRisk >= 0.7) {
      recommendations.push('Account verification and documentation review');
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }

  private matchThreatPatterns(riskFactors: RiskFactor[]): string[] {
    const matched: string[] = [];
    const factorTypes: string[] = riskFactors.map(f => f.type as unknown as string);

    for (const [patternId, pattern] of this.knownThreats) {
      const hasAllIndicators = pattern.indicators.every(
        (indicator: string) => factorTypes.includes(indicator)
      );

      if (hasAllIndicators) {
        matched.push(patternId);
      }
    }

    return matched;
  }

  private initializeKnownThreats(): void {
    // Bot farm pattern
    this.knownThreats.set('bot_farm', {
      id: 'bot_farm',
      name: 'Bot Farm',
      description: 'Coordinated bot accounts for farming',
      indicators: ['bot_detection', 'identical_device_fingerprint', 'rapid_referrals'],
      riskScore: 0.9,
      confidence: 0.95
    });

    // Multi-account abuse
    this.knownThreats.set('multi_account_abuse', {
      id: 'multi_account_abuse',
      name: 'Multi-Account Abuse',
      description: 'Single user operating multiple accounts',
      indicators: ['shared_wallet_address', 'similar_device_fingerprint', 'circular_referrals'],
      riskScore: 0.8,
      confidence: 0.9
    });

    // Automated farming
    this.knownThreats.set('automated_farming', {
      id: 'automated_farming',
      name: 'Automated Farming',
      description: 'Automated point farming behavior',
      indicators: ['excessive_point_accumulation', 'identical_behavior_patterns', 'bot_detection'],
      riskScore: 0.85,
      confidence: 0.9
    });
  }

  private async analyzeClusterThreats(
    users: User[],
    fingerprints: DeviceFingerprint[]
  ): Promise<Array<{
    users: string[];
    threatType: string;
    riskScore: number;
    description: string;
  }>> {
    const clusterThreats: Array<{
      users: string[];
      threatType: string;
      riskScore: number;
      description: string;
    }> = [];

    // Detect account clusters using unified security engine
    const clusters: any = { clusters: [], stats: { totalClusters: 0, highRiskClusters: 0 } }; // Fallback for now

    clusters.clusters.forEach((cluster: any) => {
      if (cluster.riskScore >= 0.6) {
        clusterThreats.push({
          users: cluster.users.map((u: any) => u.telegramId),
          threatType: 'suspicious_cluster',
          riskScore: cluster.riskScore,
          description: `Suspicious account cluster: ${cluster.commonFactors.join(', ')}`
        });
      }
    });

    return clusterThreats;
  }

  private detectEmergingPatterns(analyses: ThreatAnalysis[]): ThreatPattern[] {
    // This would analyze patterns across multiple analyses
    // For now, return empty array
    return [];
  }

  private async analyzeSecurityEvent(event: SecurityEvent): Promise<RiskFactor[]> {
    const threats: RiskFactor[] = [];

    // Analyze based on event type and severity
    if (event.severity === 'critical') {
      threats.push({
        type: 'critical_device_violation',
        severity: 'critical',
        score: 0.95,
        description: `Critical security event: ${event.description}`,
        evidence: event.metadata || {},
        detectedAt: new Date().toISOString()
      });
    }

    return threats;
  }

  private async detectRapidFireActivity(
    userId: string,
    event: SecurityEvent
  ): Promise<{ detected: boolean; confidence: number; count?: number; timespan?: number }> {
    // This would check recent activity for rapid-fire patterns
    // Implementation would depend on activity storage structure
    return { detected: false, confidence: 0 };
  }

  private detectAttackPattern(event: SecurityEvent): ThreatPattern | null {
    // Check event against known attack patterns
    for (const [_, pattern] of this.knownThreats) {
      if (pattern.indicators.includes(event.type)) {
        return pattern;
      }
    }
    return null;
  }

  private calculateImmediateRisk(threats: RiskFactor[]): number {
    if (threats.length === 0) return 0;

    const totalRisk = threats.reduce((sum, threat) => {
      const severityWeight = {
        low: 0.1,
        medium: 0.3,
        high: 0.6,
        critical: 1.0
      }[threat.severity];

      return sum + (severityWeight * threat.score);
    }, 0);

    return Math.min(totalRisk / threats.length, 1.0);
  }

  private mapThreatScoreToSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  }

  private analyzeBehaviorPattern(
    user: User,
    recentActivity: any[]
  ): {
    suspicious: boolean;
    severity: 'low' | 'medium' | 'high';
    description: string;
    confidence: number;
    details: any;
  } {
    // Analyze behavior patterns - placeholder implementation
    return {
      suspicious: false,
      severity: 'low',
      description: 'Normal behavior pattern',
      confidence: 0.5,
      details: {}
    };
  }

  private calculatePointsPerDay(user: User): number {
    try {
      // Handle different field names for registration date
      const registrationDate = (user as any).registeredAt || (user as any).firstSeen || (user as any).joinedAt;
      
      let joinedAtTime: number;
      if (registrationDate instanceof Date) {
        joinedAtTime = registrationDate.getTime();
      } else if (typeof registrationDate === 'string') {
        const dateObj = new Date(registrationDate);
        if (isNaN(dateObj.getTime())) {
          // Default to current time if invalid date
          joinedAtTime = Date.now();
        } else {
          joinedAtTime = dateObj.getTime();
        }
      } else {
        // Default to current time if no registration date available
        joinedAtTime = Date.now();
      }
      
      const accountAge = Date.now() - joinedAtTime;
      const accountAgeDays = Math.max(1, accountAge / (1000 * 60 * 60 * 24));
      return user.points / accountAgeDays;
    } catch (error) {
      // Return a safe default on any error
      return user.points;
    }
  }

  private analyzeGeolocationRisk(geolocation: any): {
    risky: boolean;
    severity: 'low' | 'medium' | 'high';
    description: string;
    confidence: number;
  } {
    // Placeholder implementation
    return {
      risky: false,
      severity: 'low',
      description: 'Normal geolocation',
      confidence: 0.5
    };
  }

  private detectVPNUsage(fingerprint: DeviceFingerprint): {
    detected: boolean;
    confidence: number;
    type?: string;
  } {
    // Placeholder implementation
    return {
      detected: false,
      confidence: 0
    };
  }

  private analyzeWalletRisk(walletAddress: string): {
    risky: boolean;
    severity: 'low' | 'medium' | 'high';
    description: string;
    confidence: number;
  } {
    // Placeholder implementation for wallet risk analysis
    return {
      risky: false,
      severity: 'low',
      description: 'Normal wallet address',
      confidence: 0.5
    };
  }

  /**
   * Clean up threat pattern cache
   */
  cleanupThreats(): number {
    const sizeBefore = this.knownThreats.size;
    this.knownThreats.clear();
    const cleaned = sizeBefore;
    
    this.logger.info('Threat pattern cache cleaned', { patternsRemoved: cleaned });
    return cleaned;
  }

  /**
   * Stop the analyzer and cleanup resources
   */
  stop(): void {
    // Clear managed cache will be handled automatically by MemoryManager
    this.logger.info('Threat analyzer stopped');
  }
}

// Ensure cleanup on process exit
process.on('SIGTERM', () => {
  // ThreatAnalyzer is not a singleton, so we can't get a global instance
  // Cleanup will be handled by MemoryManager
});

process.on('SIGINT', () => {
  // ThreatAnalyzer is not a singleton, so we can't get a global instance
  // Cleanup will be handled by MemoryManager
});