import { Logger } from '../services/logger';
import { StorageManager } from '../storage';
import { getConfig } from '../config';
import { MemoryManager } from '../services/memory-manager.service';

export interface BehavioralPattern {
  userId: string;
  sessionId: string;
  pattern: 'rapid_attempts' | 'consistent_timing' | 'mouse_patterns' | 'keyboard_patterns' | 'session_replay';
  confidence: number;
  evidence: any;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface MouseBehavior {
  movements: Array<{x: number, y: number, timestamp: number}>;
  clicks: Array<{x: number, y: number, timestamp: number, button: number}>;
  velocity: number[];
  acceleration: number[];
  jitter: number;
  naturalness: number;
}

export interface KeyboardBehavior {
  keystrokeTimings: number[];
  averageSpeed: number;
  consistency: number;
  patterns: string[];
  suspiciousSequences: boolean;
}

export interface SessionReplayDetection {
  fingerprint: string;
  suspiciousIdenticalSessions: number;
  timePatterns: number[];
  interactionSequences: string[];
  replayProbability: number;
}

export class BehavioralAnalyzer {
  private static instance: BehavioralAnalyzer;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  private readonly memoryManager = MemoryManager.getInstance();
  private patternCache: any;

  private constructor() {
    // Initialize managed LRU cache for pattern storage
    this.patternCache = this.memoryManager.createCache<string, BehavioralPattern[]>(
      'behavioral-patterns',
      'Behavioral analysis pattern cache',
      { max: 5000, ttl: 30 * 60 * 1000 } // Max 5000 sessions, 30min TTL
    );
  }

  static getInstance(): BehavioralAnalyzer {
    if (!BehavioralAnalyzer.instance) {
      BehavioralAnalyzer.instance = new BehavioralAnalyzer();
    }
    return BehavioralAnalyzer.instance;
  }

  /**
   * Analyze user behavior patterns
   */
  async analyzeBehavior(
    userId: string,
    sessionId: string,
    behaviorData: {
      mouseBehavior?: MouseBehavior;
      keyboardBehavior?: KeyboardBehavior;
      timingData?: number[];
      interactionSequence?: string[];
    }
  ): Promise<BehavioralPattern[]> {
    const patterns: BehavioralPattern[] = [];
    
    try {
      // Analyze mouse behavior if available
      if (behaviorData.mouseBehavior) {
        const mousePatterns = await this.analyzeMouseBehavior(
          userId, 
          sessionId, 
          behaviorData.mouseBehavior
        );
        patterns.push(...mousePatterns);
      }

      // Analyze keyboard behavior if available
      if (behaviorData.keyboardBehavior) {
        const keyboardPatterns = await this.analyzeKeyboardBehavior(
          userId,
          sessionId,
          behaviorData.keyboardBehavior
        );
        patterns.push(...keyboardPatterns);
      }

      // Analyze timing patterns
      if (behaviorData.timingData) {
        const timingPatterns = await this.analyzeTimingPatterns(
          userId,
          sessionId,
          behaviorData.timingData
        );
        patterns.push(...timingPatterns);
      }

      // Detect session replay attempts
      if (behaviorData.interactionSequence) {
        const replayPatterns = await this.detectSessionReplay(
          userId,
          sessionId,
          behaviorData.interactionSequence
        );
        patterns.push(...replayPatterns);
      }

      // Cache patterns for future analysis
      this.patternCache.set(sessionId, patterns);

      // Log significant patterns
      const criticalPatterns = patterns.filter(p => p.severity === 'critical');
      if (criticalPatterns.length > 0) {
        this.logger.warn('Critical behavioral patterns detected', {
          userId,
          sessionId,
          patterns: criticalPatterns.map(p => ({ pattern: p.pattern, confidence: p.confidence }))
        });
      }

      return patterns;
    } catch (error) {
      this.logger.error('Behavioral analysis error:', error);
      return [];
    }
  }

  /**
   * Analyze mouse movement patterns
   */
  private async analyzeMouseBehavior(
    userId: string,
    sessionId: string,
    mouseBehavior: MouseBehavior
  ): Promise<BehavioralPattern[]> {
    const patterns: BehavioralPattern[] = [];

    // Analyze movement naturalness
    if (mouseBehavior.naturalness < 0.3) {
      patterns.push({
        userId,
        sessionId,
        pattern: 'mouse_patterns',
        confidence: 1 - mouseBehavior.naturalness,
        evidence: {
          naturalness: mouseBehavior.naturalness,
          jitter: mouseBehavior.jitter,
          type: 'unnatural_movement'
        },
        timestamp: new Date(),
        severity: mouseBehavior.naturalness < 0.1 ? 'critical' : 'high'
      });
    }

    // Analyze movement velocity consistency
    const velocityVariance = this.calculateVariance(mouseBehavior.velocity);
    if (velocityVariance < 0.05) { // Too consistent, likely automated
      patterns.push({
        userId,
        sessionId,
        pattern: 'mouse_patterns',
        confidence: 0.8,
        evidence: {
          velocityVariance,
          type: 'consistent_velocity'
        },
        timestamp: new Date(),
        severity: 'high'
      });
    }

    // Analyze click patterns
    const clickIntervals = mouseBehavior.clicks.map((click, i) => 
      i > 0 ? click.timestamp - mouseBehavior.clicks[i - 1].timestamp : 0
    ).filter(interval => interval > 0);

    if (clickIntervals.length > 2) {
      const clickVariance = this.calculateVariance(clickIntervals);
      if (clickVariance < 10) { // Very consistent click timing
        patterns.push({
          userId,
          sessionId,
          pattern: 'mouse_patterns',
          confidence: 0.7,
          evidence: {
            clickVariance,
            intervals: clickIntervals,
            type: 'consistent_clicking'
          },
          timestamp: new Date(),
          severity: 'medium'
        });
      }
    }

    return patterns;
  }

  /**
   * Analyze keyboard behavior patterns
   */
  private async analyzeKeyboardBehavior(
    userId: string,
    sessionId: string,
    keyboardBehavior: KeyboardBehavior
  ): Promise<BehavioralPattern[]> {
    const patterns: BehavioralPattern[] = [];

    // Check for suspicious sequences
    if (keyboardBehavior.suspiciousSequences) {
      patterns.push({
        userId,
        sessionId,
        pattern: 'keyboard_patterns',
        confidence: 0.9,
        evidence: {
          patterns: keyboardBehavior.patterns,
          type: 'suspicious_sequences'
        },
        timestamp: new Date(),
        severity: 'critical'
      });
    }

    // Check typing consistency
    if (keyboardBehavior.consistency > 0.95) {
      patterns.push({
        userId,
        sessionId,
        pattern: 'keyboard_patterns',
        confidence: keyboardBehavior.consistency,
        evidence: {
          consistency: keyboardBehavior.consistency,
          averageSpeed: keyboardBehavior.averageSpeed,
          type: 'overly_consistent_typing'
        },
        timestamp: new Date(),
        severity: 'high'
      });
    }

    // Check for unrealistic typing speeds
    if (keyboardBehavior.averageSpeed > 200) { // WPM
      patterns.push({
        userId,
        sessionId,
        pattern: 'keyboard_patterns',
        confidence: Math.min((keyboardBehavior.averageSpeed - 200) / 100, 1),
        evidence: {
          averageSpeed: keyboardBehavior.averageSpeed,
          type: 'unrealistic_speed'
        },
        timestamp: new Date(),
        severity: keyboardBehavior.averageSpeed > 300 ? 'critical' : 'high'
      });
    }

    return patterns;
  }

  /**
   * Analyze timing patterns for automation detection
   */
  private async analyzeTimingPatterns(
    userId: string,
    sessionId: string,
    timingData: number[]
  ): Promise<BehavioralPattern[]> {
    const patterns: BehavioralPattern[] = [];

    if (timingData.length < 3) return patterns;

    const intervals = timingData.map((time, i) => 
      i > 0 ? time - timingData[i - 1] : 0
    ).filter(interval => interval > 0);

    const variance = this.calculateVariance(intervals);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Check for overly consistent timing (automation)
    if (variance < mean * 0.1) {
      patterns.push({
        userId,
        sessionId,
        pattern: 'consistent_timing',
        confidence: 1 - (variance / mean),
        evidence: {
          variance,
          mean,
          intervals: intervals.slice(0, 10), // First 10 intervals
          type: 'consistent_timing'
        },
        timestamp: new Date(),
        severity: variance < mean * 0.05 ? 'critical' : 'high'
      });
    }

    // Check for rapid attempts
    const rapidAttempts = intervals.filter(interval => interval < 500).length;
    if (rapidAttempts > intervals.length * 0.7) {
      patterns.push({
        userId,
        sessionId,
        pattern: 'rapid_attempts',
        confidence: rapidAttempts / intervals.length,
        evidence: {
          rapidCount: rapidAttempts,
          totalCount: intervals.length,
          type: 'rapid_attempts'
        },
        timestamp: new Date(),
        severity: 'high'
      });
    }

    return patterns;
  }

  /**
   * Detect session replay attacks
   */
  private async detectSessionReplay(
    userId: string,
    sessionId: string,
    interactionSequence: string[]
  ): Promise<BehavioralPattern[]> {
    const patterns: BehavioralPattern[] = [];

    try {
      // Generate sequence fingerprint
      const sequenceFingerprint = this.generateSequenceFingerprint(interactionSequence);
      
      // Get recent sessions for this user
      const recentSessions = await this.storage.getRecentCaptchaSessions(24 * 60 * 60 * 1000); // Last 24 hours
      const userSessions = recentSessions.filter(session => session.userId === userId);

      let identicalSequences = 0;
      for (const session of userSessions) {
        if (session.metadata?.sequenceFingerprint === sequenceFingerprint) {
          identicalSequences++;
        }
      }

      // Check for suspicious identical sequences
      if (identicalSequences > 2) {
        patterns.push({
          userId,
          sessionId,
          pattern: 'session_replay',
          confidence: Math.min(identicalSequences / 3, 1),
          evidence: {
            identicalSequences,
            sequenceFingerprint,
            type: 'identical_sequence_replay'
          },
          timestamp: new Date(),
          severity: identicalSequences > 5 ? 'critical' : 'high'
        });
      }

      // Store sequence fingerprint for future comparisons
      await this.storeSequenceFingerprint(sessionId, sequenceFingerprint);

    } catch (error) {
      this.logger.error('Session replay detection error:', error);
    }

    return patterns;
  }

  /**
   * Generate a fingerprint for interaction sequences
   */
  private generateSequenceFingerprint(sequence: string[]): string {
    // Create a hash of the interaction sequence
    const sequenceString = sequence.join(',');
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(sequenceString).digest('hex');
  }

  /**
   * Store sequence fingerprint for future analysis
   */
  private async storeSequenceFingerprint(sessionId: string, fingerprint: string): Promise<void> {
    try {
      await this.storage.saveCaptchaSession({
        id: sessionId,
        metadata: { sequenceFingerprint: fingerprint }
      });
    } catch (error) {
      this.logger.error('Failed to store sequence fingerprint:', error);
    }
  }

  /**
   * Calculate variance of a numeric array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Get behavioral analysis summary for a user
   */
  async getBehavioralSummary(userId: string): Promise<{
    totalPatterns: number;
    severityDistribution: Record<string, number>;
    mostCommonPatterns: Array<{pattern: string, count: number}>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }> {
    try {
      // This would query stored behavioral patterns
      // For now, return a mock summary
      return {
        totalPatterns: 0,
        severityDistribution: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0
        },
        mostCommonPatterns: [],
        riskLevel: 'low'
      };
    } catch (error) {
      this.logger.error('Failed to get behavioral summary:', error);
      return {
        totalPatterns: 0,
        severityDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        mostCommonPatterns: [],
        riskLevel: 'low'
      };
    }
  }

  /**
   * Clean up old behavioral patterns
   */
  async cleanupOldPatterns(olderThanDays: number = 30): Promise<number> {
    // Implementation would clean up old behavioral patterns from storage
    // Clean up the managed cache
    const sizeBefore = this.patternCache.size;
    this.patternCache.clear();
    const cleaned = sizeBefore;
    
    this.logger.info('Behavioral pattern cache cleaned', { patternsRemoved: cleaned });
    return cleaned;
  }

  /**
   * Stop the analyzer and cleanup resources
   */
  stop(): void {
    // Clear managed cache will be handled automatically by MemoryManager
    this.logger.info('Behavioral analyzer stopped');
  }
}

export default BehavioralAnalyzer;

// Ensure cleanup on process exit
process.on('SIGTERM', () => {
  const instance = BehavioralAnalyzer.getInstance();
  instance.stop();
});

process.on('SIGINT', () => {
  const instance = BehavioralAnalyzer.getInstance();
  instance.stop();
});