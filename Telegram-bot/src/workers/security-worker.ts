import { isMainThread, parentPort, workerData } from 'worker_threads';
import { Logger } from '../services/logger';

interface SecurityTask {
  taskId: string;
  taskType: string;
  taskData: any;
}

interface SecurityResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  securityLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

/**
 * Security Worker Thread for CPU-intensive security analysis tasks
 * Handles threat detection, pattern analysis, device fingerprinting, etc.
 */
class SecurityWorker {
  private readonly workerId: string;
  private readonly logger: Logger;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.logger = Logger.getInstance();
    
    process.title = `security-worker-${workerId}`;
    this.logger.info(`🔒 Security worker ${workerId} started`);
  }

  /**
   * Process security analysis tasks
   */
  async processSecurityTask(task: SecurityTask): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`🔍 Analyzing security task ${task.taskId} of type ${task.taskType}`);
      
      let result: any;
      let securityLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
      let confidence = 0;
      
      switch (task.taskType) {
        case 'threat_analysis':
          ({ result, securityLevel, confidence } = await this.analyzeThreat(task.taskData));
          break;
          
        case 'device_fingerprint_analysis':
          ({ result, securityLevel, confidence } = await this.analyzeDeviceFingerprint(task.taskData));
          break;
          
        case 'behavioral_analysis':
          ({ result, securityLevel, confidence } = await this.analyzeBehavior(task.taskData));
          break;
          
        case 'multi_account_detection':
          ({ result, securityLevel, confidence } = await this.detectMultiAccount(task.taskData));
          break;
          
        case 'ip_reputation_analysis':
          ({ result, securityLevel, confidence } = await this.analyzeIpReputation(task.taskData));
          break;
          
        case 'pattern_matching':
          ({ result, securityLevel, confidence } = await this.performPatternMatching(task.taskData));
          break;
          
        case 'risk_scoring':
          ({ result, securityLevel, confidence } = await this.calculateRiskScore(task.taskData));
          break;
          
        case 'anomaly_detection':
          ({ result, securityLevel, confidence } = await this.detectAnomalies(task.taskData));
          break;
          
        default:
          throw new Error(`Unknown security task type: ${task.taskType}`);
      }

      const duration = Date.now() - startTime;

      const response: SecurityResult = {
        taskId: task.taskId,
        success: true,
        result,
        duration,
        securityLevel,
        confidence
      };

      parentPort?.postMessage(response);
      
      this.logger.debug(`✅ Security task ${task.taskId} completed`, {
        duration,
        securityLevel,
        confidence: `${(confidence * 100).toFixed(1)}%`
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const response: SecurityResult = {
        taskId: task.taskId,
        success: false,
        error: errorMessage,
        duration,
        securityLevel: 'low',
        confidence: 0
      };

      parentPort?.postMessage(response);
      
      this.logger.error(`❌ Security task ${task.taskId} failed:`, error);
    }
  }

  /**
   * Analyze threat indicators and patterns
   */
  private async analyzeThreat(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { indicators, context, historicalData } = data;
    
    let riskScore = 0;
    let threatTypes: string[] = [];
    let evidences: any[] = [];
    
    // Analyze IP-based threats
    if (indicators.ipAddress) {
      const ipAnalysis = await this.analyzeIpThreat(indicators.ipAddress, historicalData);
      riskScore += ipAnalysis.score;
      if (ipAnalysis.threats.length > 0) {
        threatTypes.push(...ipAnalysis.threats);
        evidences.push(...ipAnalysis.evidences);
      }
    }
    
    // Analyze user behavior threats
    if (indicators.userBehavior) {
      const behaviorAnalysis = await this.analyzeBehaviorThreat(indicators.userBehavior);
      riskScore += behaviorAnalysis.score;
      if (behaviorAnalysis.threats.length > 0) {
        threatTypes.push(...behaviorAnalysis.threats);
        evidences.push(...behaviorAnalysis.evidences);
      }
    }
    
    // Analyze device-based threats
    if (indicators.deviceFingerprint) {
      const deviceAnalysis = await this.analyzeDeviceThreat(indicators.deviceFingerprint);
      riskScore += deviceAnalysis.score;
      if (deviceAnalysis.threats.length > 0) {
        threatTypes.push(...deviceAnalysis.threats);
        evidences.push(...deviceAnalysis.evidences);
      }
    }
    
    // Normalize risk score (0-100)
    riskScore = Math.min(100, Math.max(0, riskScore));
    
    const securityLevel = this.getSecurityLevel(riskScore);
    const confidence = this.calculateConfidence(evidences, threatTypes);
    
    return {
      result: {
        riskScore,
        threatTypes: [...new Set(threatTypes)],
        evidences,
        recommendation: this.getSecurityRecommendation(riskScore, threatTypes),
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Analyze device fingerprint for suspicious patterns
   */
  private async analyzeDeviceFingerprint(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { fingerprint, userId, comparisonData } = data;
    
    let suspiciousScore = 0;
    const anomalies: any[] = [];
    const deviceFlags: string[] = [];
    
    // Check for device spoofing indicators
    if (fingerprint.userAgent) {
      const uaAnalysis = this.analyzeUserAgent(fingerprint.userAgent);
      suspiciousScore += uaAnalysis.suspiciousScore;
      if (uaAnalysis.flags.length > 0) {
        deviceFlags.push(...uaAnalysis.flags);
      }
    }
    
    // Analyze screen/canvas fingerprinting
    if (fingerprint.screen && fingerprint.canvas) {
      const spoofingScore = this.detectFingerprintSpoofing(fingerprint);
      suspiciousScore += spoofingScore;
      if (spoofingScore > 30) {
        deviceFlags.push('possible_fingerprint_spoofing');
      }
    }
    
    // Check for common device collision patterns
    if (comparisonData && comparisonData.length > 0) {
      const collisionAnalysis = this.analyzeDeviceCollisions(fingerprint, comparisonData);
      suspiciousScore += collisionAnalysis.score;
      anomalies.push(...collisionAnalysis.anomalies);
    }
    
    // Hardware consistency check
    const consistencyScore = this.checkHardwareConsistency(fingerprint);
    suspiciousScore += consistencyScore;
    
    const securityLevel = this.getSecurityLevel(suspiciousScore);
    const confidence = Math.min(1, (deviceFlags.length + anomalies.length) / 10);
    
    return {
      result: {
        suspiciousScore,
        deviceFlags: [...new Set(deviceFlags)],
        anomalies,
        fingerprint: this.sanitizeFingerprint(fingerprint),
        recommendation: suspiciousScore > 60 ? 'block' : suspiciousScore > 30 ? 'monitor' : 'allow',
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Analyze user behavior patterns for anomalies
   */
  private async analyzeBehavior(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { userId, behaviorData, baseline, timeWindow } = data;
    
    let anomalyScore = 0;
    const patterns: any[] = [];
    const alerts: string[] = [];
    
    // Analyze timing patterns
    if (behaviorData.clickTimings && baseline?.clickTimings) {
      const timingAnalysis = this.analyzeTimingPatterns(behaviorData.clickTimings, baseline.clickTimings);
      anomalyScore += timingAnalysis.score;
      if (timingAnalysis.isAnomalous) {
        patterns.push(timingAnalysis);
        alerts.push('unusual_timing_patterns');
      }
    }
    
    // Analyze interaction frequency
    if (behaviorData.interactions) {
      const frequencyAnalysis = this.analyzeInteractionFrequency(behaviorData.interactions, timeWindow);
      anomalyScore += frequencyAnalysis.score;
      if (frequencyAnalysis.isAnomalous) {
        patterns.push(frequencyAnalysis);
        alerts.push('unusual_interaction_frequency');
      }
    }
    
    // Analyze navigation patterns
    if (behaviorData.navigation) {
      const navAnalysis = this.analyzeNavigationPatterns(behaviorData.navigation);
      anomalyScore += navAnalysis.score;
      if (navAnalysis.isAnomalous) {
        patterns.push(navAnalysis);
        alerts.push('unusual_navigation_patterns');
      }
    }
    
    // Bot detection heuristics
    const botScore = this.detectBotBehavior(behaviorData);
    anomalyScore += botScore;
    if (botScore > 40) {
      alerts.push('possible_bot_behavior');
    }
    
    const securityLevel = this.getSecurityLevel(anomalyScore);
    const confidence = Math.min(1, patterns.length / 5);
    
    return {
      result: {
        anomalyScore,
        alerts: [...new Set(alerts)],
        patterns,
        botProbability: botScore / 100,
        recommendation: this.getBehaviorRecommendation(anomalyScore, alerts),
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Detect multiple account usage patterns
   */
  private async detectMultiAccount(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { userId, deviceData, userBehavior, comparisonUsers } = data;
    
    let multiAccountScore = 0;
    const similarities: any[] = [];
    const riskFactors: string[] = [];
    
    // Compare device fingerprints
    if (comparisonUsers && comparisonUsers.length > 0) {
      for (const compUser of comparisonUsers) {
        const deviceSimilarity = this.compareDeviceFingerprints(deviceData, compUser.deviceData);
        if (deviceSimilarity.score > 0.8) {
          multiAccountScore += 30;
          similarities.push({
            userId: compUser.userId,
            type: 'device',
            similarity: deviceSimilarity.score,
            commonFingerprints: deviceSimilarity.commonFingerprints
          });
          riskFactors.push('high_device_similarity');
        }
        
        // Compare behavioral patterns
        if (userBehavior && compUser.behavior) {
          const behaviorSimilarity = this.compareBehaviorPatterns(userBehavior, compUser.behavior);
          if (behaviorSimilarity.score > 0.7) {
            multiAccountScore += 25;
            similarities.push({
              userId: compUser.userId,
              type: 'behavior',
              similarity: behaviorSimilarity.score,
              commonPatterns: behaviorSimilarity.commonPatterns
            });
            riskFactors.push('similar_behavior_patterns');
          }
        }
      }
    }
    
    // Check for timing correlation
    const timingCorrelation = this.analyzeAccountTimingCorrelation(userId, comparisonUsers);
    if (timingCorrelation.score > 0.6) {
      multiAccountScore += 20;
      riskFactors.push('correlated_activity_timing');
    }
    
    const securityLevel = this.getSecurityLevel(multiAccountScore);
    const confidence = Math.min(1, similarities.length / 3);
    
    return {
      result: {
        multiAccountScore,
        riskFactors: [...new Set(riskFactors)],
        similarities,
        timingCorrelation,
        recommendation: multiAccountScore > 70 ? 'flag_account' : multiAccountScore > 40 ? 'monitor_closely' : 'normal',
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Analyze IP reputation and geolocation risks
   */
  private async analyzeIpReputation(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { ipAddress, geolocation, historicalData } = data;
    
    let reputationScore = 0;
    const risks: string[] = [];
    const geolocationRisks: any[] = [];
    
    // Check against known malicious IP patterns
    const maliciousCheck = this.checkMaliciousIpPatterns(ipAddress);
    reputationScore += maliciousCheck.score;
    if (maliciousCheck.risks.length > 0) {
      risks.push(...maliciousCheck.risks);
    }
    
    // Analyze geolocation risks
    if (geolocation) {
      const geoRisk = this.analyzeGeolocationRisk(geolocation, historicalData);
      reputationScore += geoRisk.score;
      geolocationRisks.push(...geoRisk.risks);
    }
    
    // Check for proxy/VPN usage
    const proxyCheck = this.detectProxyVpnUsage(ipAddress);
    reputationScore += proxyCheck.score;
    if (proxyCheck.detected) {
      risks.push('proxy_vpn_usage');
    }
    
    // Analyze connection patterns
    const connectionAnalysis = this.analyzeConnectionPatterns(ipAddress, historicalData);
    reputationScore += connectionAnalysis.score;
    
    const securityLevel = this.getSecurityLevel(reputationScore);
    const confidence = Math.min(1, (risks.length + geolocationRisks.length) / 8);
    
    return {
      result: {
        reputationScore,
        risks: [...new Set(risks)],
        geolocationRisks,
        proxyVpnDetected: proxyCheck.detected,
        connectionPatterns: connectionAnalysis.patterns,
        recommendation: this.getIpRecommendation(reputationScore, risks),
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Perform pattern matching analysis
   */
  private async performPatternMatching(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { patterns, targetData, threshold = 0.7 } = data;
    
    const matches: any[] = [];
    let maxScore = 0;
    
    for (const pattern of patterns) {
      const matchResult = this.matchPattern(pattern, targetData);
      if (matchResult.score >= threshold) {
        matches.push({
          patternId: pattern.id,
          patternType: pattern.type,
          score: matchResult.score,
          matchedFields: matchResult.matchedFields,
          confidence: matchResult.confidence
        });
        maxScore = Math.max(maxScore, matchResult.score * 100);
      }
    }
    
    const securityLevel = this.getSecurityLevel(maxScore);
    const confidence = matches.length > 0 ? Math.max(...matches.map(m => m.confidence)) : 0;
    
    return {
      result: {
        matches,
        totalPatterns: patterns.length,
        matchCount: matches.length,
        maxScore,
        recommendation: matches.length > 0 ? 'investigate' : 'normal',
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Calculate comprehensive risk score
   */
  private async calculateRiskScore(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { factors, weights = {}, context } = data;
    
    let totalScore = 0;
    let weightSum = 0;
    const scoreBreakdown: any = {};
    
    // Apply weighted scoring
    for (const [factor, value] of Object.entries(factors)) {
      const weight = weights[factor] || 1;
      const normalizedValue = typeof value === 'number' ? value : this.normalizeFactorValue(value);
      const weightedScore = normalizedValue * weight;
      
      totalScore += weightedScore;
      weightSum += weight;
      scoreBreakdown[factor] = {
        value: normalizedValue,
        weight,
        weightedScore
      };
    }
    
    const finalScore = weightSum > 0 ? (totalScore / weightSum) * 100 : 0;
    const securityLevel = this.getSecurityLevel(finalScore);
    
    // Calculate confidence based on number of factors and their consistency
    const confidence = this.calculateRiskConfidence(factors, scoreBreakdown);
    
    return {
      result: {
        riskScore: finalScore,
        scoreBreakdown,
        factors: Object.keys(factors),
        recommendation: this.getRiskRecommendation(finalScore, securityLevel),
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  /**
   * Detect anomalies in data patterns
   */
  private async detectAnomalies(data: any): Promise<{ result: any; securityLevel: any; confidence: number }> {
    const { dataset, baseline, algorithm = 'statistical' } = data;
    
    const anomalies: any[] = [];
    let anomalyScore = 0;
    
    switch (algorithm) {
      case 'statistical':
        const statAnomalies = this.detectStatisticalAnomalies(dataset, baseline);
        anomalies.push(...statAnomalies);
        break;
        
      case 'clustering':
        const clusterAnomalies = this.detectClusteringAnomalies(dataset);
        anomalies.push(...clusterAnomalies);
        break;
        
      case 'time_series':
        const timeAnomalies = this.detectTimeSeriesAnomalies(dataset, baseline);
        anomalies.push(...timeAnomalies);
        break;
    }
    
    anomalyScore = anomalies.length > 0 ? Math.min(100, anomalies.length * 20) : 0;
    const securityLevel = this.getSecurityLevel(anomalyScore);
    const confidence = anomalies.length > 0 ? Math.min(1, anomalies.length / 5) : 0;
    
    return {
      result: {
        anomalies,
        anomalyCount: anomalies.length,
        anomalyScore,
        algorithm,
        recommendation: anomalies.length > 3 ? 'investigate' : 'monitor',
        analyzedAt: new Date().toISOString()
      },
      securityLevel,
      confidence
    };
  }

  // Helper methods for security analysis

  private async analyzeIpThreat(ipAddress: string, historicalData: any): Promise<{ score: number; threats: string[]; evidences: any[] }> {
    let score = 0;
    const threats: string[] = [];
    const evidences: any[] = [];
    
    // Simulate IP threat analysis
    if (ipAddress.startsWith('10.') || ipAddress.startsWith('192.168.')) {
      score += 10; // Private IP ranges
      threats.push('private_ip_access');
    }
    
    // Check for rapid IP changes
    if (historicalData && historicalData.recentIps) {
      const uniqueIps = new Set(historicalData.recentIps).size;
      if (uniqueIps > 5) {
        score += 25;
        threats.push('ip_hopping');
        evidences.push({ type: 'ip_hopping', count: uniqueIps });
      }
    }
    
    return { score, threats, evidences };
  }

  private async analyzeBehaviorThreat(behavior: any): Promise<{ score: number; threats: string[]; evidences: any[] }> {
    let score = 0;
    const threats: string[] = [];
    const evidences: any[] = [];
    
    // Check for automated behavior patterns
    if (behavior.clickSpeed && behavior.clickSpeed < 100) {
      score += 30;
      threats.push('possible_automation');
      evidences.push({ type: 'rapid_clicks', speed: behavior.clickSpeed });
    }
    
    return { score, threats, evidences };
  }

  private async analyzeDeviceThreat(fingerprint: any): Promise<{ score: number; threats: string[]; evidences: any[] }> {
    let score = 0;
    const threats: string[] = [];
    const evidences: any[] = [];
    
    // Check for headless browser indicators
    if (fingerprint.webGL && fingerprint.webGL.includes('SwiftShader')) {
      score += 35;
      threats.push('headless_browser');
      evidences.push({ type: 'webgl_renderer', value: fingerprint.webGL });
    }
    
    return { score, threats, evidences };
  }

  private analyzeUserAgent(userAgent: string): { suspiciousScore: number; flags: string[] } {
    let suspiciousScore = 0;
    const flags: string[] = [];
    
    // Check for common bot user agents
    const botPatterns = ['bot', 'crawler', 'spider', 'scraper'];
    for (const pattern of botPatterns) {
      if (userAgent.toLowerCase().includes(pattern)) {
        suspiciousScore += 40;
        flags.push('bot_user_agent');
        break;
      }
    }
    
    // Check for outdated browsers
    if (userAgent.includes('Chrome/') && userAgent.includes('Chrome/80.')) {
      suspiciousScore += 15;
      flags.push('outdated_browser');
    }
    
    return { suspiciousScore, flags };
  }

  private detectFingerprintSpoofing(fingerprint: any): number {
    let score = 0;
    
    // Check for inconsistencies between reported and actual capabilities
    if (fingerprint.screen && fingerprint.canvas) {
      const screenArea = fingerprint.screen.width * fingerprint.screen.height;
      if (screenArea < 800 * 600) {
        score += 20; // Unusually small screen
      }
    }
    
    return score;
  }

  private analyzeDeviceCollisions(fingerprint: any, comparisonData: any[]): { score: number; anomalies: any[] } {
    let score = 0;
    const anomalies: any[] = [];
    
    // Check for exact fingerprint matches (suspicious)
    const exactMatches = comparisonData.filter(data => 
      JSON.stringify(data.fingerprint) === JSON.stringify(fingerprint)
    ).length;
    
    if (exactMatches > 1) {
      score += 50;
      anomalies.push({ type: 'exact_fingerprint_match', count: exactMatches });
    }
    
    return { score, anomalies };
  }

  private checkHardwareConsistency(fingerprint: any): number {
    let score = 0;
    
    // Check for hardware inconsistencies
    if (fingerprint.cores && fingerprint.memory) {
      const expectedMemory = fingerprint.cores * 2; // Expected 2GB per core
      if (fingerprint.memory < expectedMemory * 0.5) {
        score += 15; // Unusually low memory for CPU count
      }
    }
    
    return score;
  }

  private analyzeTimingPatterns(timings: number[], baseline: number[]): { score: number; isAnomalous: boolean } {
    const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
    const baselineAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    
    const deviation = Math.abs(avgTiming - baselineAvg) / baselineAvg;
    const score = deviation > 0.5 ? 30 : 0;
    
    return { score, isAnomalous: deviation > 0.5 };
  }

  private analyzeInteractionFrequency(interactions: any[], timeWindow: number): { score: number; isAnomalous: boolean } {
    const frequency = interactions.length / timeWindow;
    const score = frequency > 10 ? 25 : 0; // More than 10 interactions per minute
    
    return { score, isAnomalous: frequency > 10 };
  }

  private analyzeNavigationPatterns(navigation: any[]): { score: number; isAnomalous: boolean } {
    const uniquePages = new Set(navigation.map(nav => nav.page)).size;
    const totalNavigations = navigation.length;
    
    const repeatRate = 1 - (uniquePages / totalNavigations);
    const score = repeatRate > 0.8 ? 20 : 0; // High repeat navigation
    
    return { score, isAnomalous: repeatRate > 0.8 };
  }

  private detectBotBehavior(behaviorData: any): number {
    let score = 0;
    
    // Check for perfectly regular timing
    if (behaviorData.clickTimings) {
      const variance = this.calculateVariance(behaviorData.clickTimings);
      if (variance < 10) {
        score += 30; // Too regular to be human
      }
    }
    
    // Check for inhuman speed
    if (behaviorData.averageSpeed && behaviorData.averageSpeed < 50) {
      score += 25; // Too fast
    }
    
    return score;
  }

  private compareDeviceFingerprints(device1: any, device2: any): { score: number; commonFingerprints: string[] } {
    const commonFingerprints: string[] = [];
    let matches = 0;
    let total = 0;
    
    // Compare key fingerprint components
    const compareFields = ['userAgent', 'screen', 'timezone', 'language', 'platform'];
    
    for (const field of compareFields) {
      total++;
      if (device1[field] && device2[field] && device1[field] === device2[field]) {
        matches++;
        commonFingerprints.push(field);
      }
    }
    
    const score = total > 0 ? matches / total : 0;
    return { score, commonFingerprints };
  }

  private compareBehaviorPatterns(behavior1: any, behavior2: any): { score: number; commonPatterns: string[] } {
    const commonPatterns: string[] = [];
    let similarity = 0;
    
    // Compare timing patterns
    if (behavior1.averageClickTime && behavior2.averageClickTime) {
      const timingDiff = Math.abs(behavior1.averageClickTime - behavior2.averageClickTime);
      if (timingDiff < 50) {
        similarity += 0.3;
        commonPatterns.push('similar_click_timing');
      }
    }
    
    // Compare interaction patterns
    if (behavior1.interactionStyle && behavior2.interactionStyle === behavior1.interactionStyle) {
      similarity += 0.4;
      commonPatterns.push('similar_interaction_style');
    }
    
    return { score: similarity, commonPatterns };
  }

  private analyzeAccountTimingCorrelation(userId: string, comparisonUsers: any[]): { score: number } {
    // Simulate timing correlation analysis
    const correlationScore = Math.random() * 0.3; // Low random correlation
    return { score: correlationScore };
  }

  private checkMaliciousIpPatterns(ipAddress: string): { score: number; risks: string[] } {
    let score = 0;
    const risks: string[] = [];
    
    // Check known malicious patterns (simplified)
    const maliciousPatterns = ['127.0.0.1', '0.0.0.0'];
    for (const pattern of maliciousPatterns) {
      if (ipAddress.includes(pattern)) {
        score += 50;
        risks.push('known_malicious_pattern');
        break;
      }
    }
    
    return { score, risks };
  }

  private analyzeGeolocationRisk(geolocation: any, historicalData: any): { score: number; risks: any[] } {
    let score = 0;
    const risks: any[] = [];
    
    // Check for high-risk countries (simplified)
    const highRiskCountries = ['XX', 'YY']; // Placeholder
    if (highRiskCountries.includes(geolocation.country)) {
      score += 25;
      risks.push({ type: 'high_risk_country', country: geolocation.country });
    }
    
    return { score, risks };
  }

  private detectProxyVpnUsage(ipAddress: string): { detected: boolean; score: number } {
    // Simplified proxy/VPN detection
    const isProxy = ipAddress.startsWith('10.') || Math.random() < 0.1;
    return { detected: isProxy, score: isProxy ? 30 : 0 };
  }

  private analyzeConnectionPatterns(ipAddress: string, historicalData: any): { score: number; patterns: any[] } {
    const patterns: any[] = [];
    let score = 0;
    
    // Analyze connection frequency
    if (historicalData && historicalData.connections) {
      const recentConnections = historicalData.connections.filter((conn: any) => 
        Date.now() - new Date(conn.timestamp).getTime() < 24 * 60 * 60 * 1000
      );
      
      if (recentConnections.length > 100) {
        score += 20;
        patterns.push({ type: 'high_frequency_connections', count: recentConnections.length });
      }
    }
    
    return { score, patterns };
  }

  private matchPattern(pattern: any, targetData: any): { score: number; matchedFields: string[]; confidence: number } {
    const matchedFields: string[] = [];
    let matches = 0;
    let total = 0;
    
    for (const [key, value] of Object.entries(pattern.fields || {})) {
      total++;
      if (targetData[key] && this.fieldMatches(targetData[key], value)) {
        matches++;
        matchedFields.push(key);
      }
    }
    
    const score = total > 0 ? matches / total : 0;
    const confidence = Math.min(1, matches / 3); // Need at least 3 matches for high confidence
    
    return { score, matchedFields, confidence };
  }

  private fieldMatches(value1: any, value2: any): boolean {
    if (typeof value1 === 'string' && typeof value2 === 'string') {
      return value1.toLowerCase().includes(value2.toLowerCase());
    }
    return value1 === value2;
  }

  private normalizeFactorValue(value: any): number {
    if (typeof value === 'number') return Math.min(100, Math.max(0, value));
    if (typeof value === 'boolean') return value ? 100 : 0;
    if (typeof value === 'string') {
      const riskWords = ['high', 'critical', 'dangerous'];
      return riskWords.some(word => value.toLowerCase().includes(word)) ? 80 : 20;
    }
    return 0;
  }

  private calculateRiskConfidence(factors: any, scoreBreakdown: any): number {
    const factorCount = Object.keys(factors).length;
    const consistentFactors = Object.values(scoreBreakdown).filter((item: any) => 
      item.weightedScore > 0.5
    ).length;
    
    return Math.min(1, (consistentFactors / factorCount) * (factorCount / 5));
  }

  private detectStatisticalAnomalies(dataset: any[], baseline: any): any[] {
    const anomalies: any[] = [];
    
    // Simple statistical anomaly detection
    if (Array.isArray(dataset) && baseline?.mean !== undefined) {
      const threshold = baseline.stdDev * 2;
      
      dataset.forEach((value, index) => {
        if (typeof value === 'number' && Math.abs(value - baseline.mean) > threshold) {
          anomalies.push({
            index,
            value,
            deviation: Math.abs(value - baseline.mean),
            type: 'statistical'
          });
        }
      });
    }
    
    return anomalies;
  }

  private detectClusteringAnomalies(dataset: any[]): any[] {
    // Simplified clustering anomaly detection
    return dataset.filter((_, index) => Math.random() < 0.05).map((value, index) => ({
      index,
      value,
      type: 'clustering',
      cluster: 'outlier'
    }));
  }

  private detectTimeSeriesAnomalies(dataset: any[], baseline: any): any[] {
    const anomalies: any[] = [];
    
    // Simple time series anomaly detection
    for (let i = 1; i < dataset.length; i++) {
      const currentValue = dataset[i];
      const previousValue = dataset[i - 1];
      
      if (typeof currentValue === 'number' && typeof previousValue === 'number') {
        const change = Math.abs(currentValue - previousValue) / previousValue;
        if (change > 0.5) { // 50% change
          anomalies.push({
            index: i,
            value: currentValue,
            previousValue,
            changePercent: change * 100,
            type: 'time_series'
          });
        }
      }
    }
    
    return anomalies;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  private sanitizeFingerprint(fingerprint: any): any {
    // Remove sensitive data from fingerprint for logging
    const sanitized = { ...fingerprint };
    delete sanitized.canvas;
    delete sanitized.webGL;
    return sanitized;
  }

  private getSecurityLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  private calculateConfidence(evidences: any[], threatTypes: string[]): number {
    return Math.min(1, (evidences.length * 0.3 + threatTypes.length * 0.2));
  }

  private getSecurityRecommendation(riskScore: number, threatTypes: string[]): string {
    if (riskScore >= 80) return 'immediate_block';
    if (riskScore >= 60) return 'enhanced_monitoring';
    if (riskScore >= 30) return 'standard_monitoring';
    return 'normal_processing';
  }

  private getBehaviorRecommendation(anomalyScore: number, alerts: string[]): string {
    if (anomalyScore >= 70) return 'block_user';
    if (anomalyScore >= 40) return 'require_additional_verification';
    if (alerts.includes('possible_bot_behavior')) return 'captcha_challenge';
    return 'normal_processing';
  }

  private getIpRecommendation(reputationScore: number, risks: string[]): string {
    if (reputationScore >= 80) return 'block_ip';
    if (reputationScore >= 50) return 'rate_limit';
    if (risks.includes('proxy_vpn_usage')) return 'enhanced_verification';
    return 'normal_processing';
  }

  private getRiskRecommendation(finalScore: number, securityLevel: string): string {
    switch (securityLevel) {
      case 'critical': return 'immediate_action_required';
      case 'high': return 'investigate_immediately';
      case 'medium': return 'monitor_closely';
      default: return 'normal_processing';
    }
  }
}

// Worker initialization
if (!isMainThread && parentPort) {
  const { workerId } = workerData;
  const worker = new SecurityWorker(workerId);
  
  parentPort.on('message', async (task: SecurityTask) => {
    await worker.processSecurityTask(task);
  });
  
  parentPort.on('close', () => {
    process.exit(0);
  });
  
  parentPort.postMessage({ type: 'ready', workerId });
}