import crypto from 'crypto';
import { DeviceFingerprint, DeviceFingerprintComponents, HardwareFingerprint, BrowserFingerprint, RenderingFingerprint, NetworkFingerprint, BehavioralFingerprint, FingerprintQuality, DeviceFingerprintMetadata, RiskFactor } from '../types/security.types';
import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { LocationService } from '../services/location/location.service';
import { DeviceBanService } from '../security/device-ban.service';

export interface EnhancedDeviceData {
  hardware: HardwareFingerprint;
  browser: BrowserFingerprint;
  rendering: RenderingFingerprint;
  network: NetworkFingerprint;
  behavioral: BehavioralFingerprint;
  location?: {
    ip: string;
    country: string;
    region: string;
    city: string;
    latitude?: number;
    longitude?: number;
    timezone: string;
    isp: string;
    proxy: boolean;
    vpn: boolean;
  };
  telegramData?: {
    userId: string;
    platform: string;
    version: string;
    colorScheme: string;
    language: string;
  };
  sessionData: {
    sessionId: string;
    timestamp: number;
    userAgent: string;
    referrer: string;
    url: string;
  };
}

export interface DeviceFingerprintUpdate {
  previousHash: string;
  newHash: string;
  changes: Record<string, { old: any; new: any }>;
  suspiciousChanges: string[];
  confidenceChange: number;
  riskScoreChange: number;
  timestamp: Date;
}

export class DeviceFingerprintService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly locationService = new LocationService();
  private readonly storage: any;
  private readonly deviceBanService = new DeviceBanService();

  constructor() {
    const { createStorage } = require('../storage');
    this.storage = createStorage();
  }

  /**
   * Generate a comprehensive device fingerprint with enhanced data collection
   */
  async generateFingerprint(deviceData: EnhancedDeviceData, userId: string): Promise<DeviceFingerprint> {
    // Check if device is banned before processing
    const deviceIdentifier = this.createDeviceIdentifier(deviceData.hardware);
    const banCheck = await this.deviceBanService.isDeviceBanned(deviceIdentifier);
    if (banCheck.isBanned) {
      throw new Error(`Device is banned: ${banCheck.blockReason}`);
    }

    const components = this.normalizeDeviceComponents(deviceData);
    const hash = this.computeHash(components);
    
    // Enhanced location validation
    const locationValidation = deviceData.location ? 
      await this.validateLocation(deviceData.location, deviceData.hardware.timezone) : null;
    
    // Calculate enhanced quality metrics
    const quality = this.calculateFingerprintQuality(components);
    
    // Generate risk factors
    const riskFactors = await this.generateRiskFactors(deviceData, components);

    const fingerprint: DeviceFingerprint = {
      hash,
      userId,
      components,
      quality,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      usageCount: 1,
      isBlocked: false,
      riskScore: this.calculateEnhancedRiskScore(deviceData, riskFactors),
      metadata: {
        collisionCount: 0,
        similarDevices: [],
        riskFactors,
        verificationHistory: [{
          timestamp: new Date().toISOString(),
          action: 'registered',
          reason: 'Initial device registration'
        }],
        customData: {
          locationValidation,
          sessionData: deviceData.sessionData,
          telegramData: deviceData.telegramData
        }
      }
    };

    this.logger.info('Device fingerprint generated', {
      userId,
      hash,
      riskScore: fingerprint.riskScore,
      qualityOverall: quality.overall,
      riskFactorCount: riskFactors.length
    });

    return fingerprint;
  }

  /**
   * Update existing fingerprint with new enhanced data
   */
  async updateFingerprint(
    existing: DeviceFingerprint,
    newDeviceData: EnhancedDeviceData
  ): Promise<DeviceFingerprintUpdate> {
    const normalizedNew = this.normalizeDeviceComponents(newDeviceData);
    const newHash = this.computeHash(normalizedNew);
    
    const changes = this.detectComponentChanges(existing.components, normalizedNew);
    const suspiciousChanges = await this.analyzeSuspiciousChanges(changes, existing, newDeviceData);
    
    const newQuality = this.calculateFingerprintQuality(normalizedNew);
    const newRiskFactors = await this.generateRiskFactors(newDeviceData, normalizedNew);
    const newRiskScore = this.calculateEnhancedRiskScore(newDeviceData, newRiskFactors);

    const update: DeviceFingerprintUpdate = {
      previousHash: existing.hash,
      newHash,
      changes,
      suspiciousChanges,
      confidenceChange: newQuality.overall - existing.quality.overall,
      riskScoreChange: newRiskScore - existing.riskScore,
      timestamp: new Date()
    };

    // Log significant changes
    if (suspiciousChanges.length > 0) {
      this.logger.warn('Suspicious device changes detected', {
        userId: existing.userId,
        deviceHash: existing.hash,
        changes: suspiciousChanges,
        riskScoreChange: update.riskScoreChange
      });
    }

    return update;
  }

  /**
   * Compare two fingerprints for similarity with enhanced algorithm
   */
  compareFingerprints(fp1: DeviceFingerprint, fp2: DeviceFingerprint): number {
    const components1 = fp1.components;
    const components2 = fp2.components;
    
    let totalWeight = 0;
    let matchedWeight = 0;

    // Enhanced component weights based on stability and uniqueness
    const hardwareWeights = {
      screenResolution: 0.15,
      screenColorDepth: 0.05,
      platform: 0.12,
      hardwareConcurrency: 0.08,
      deviceMemory: 0.06,
      maxTouchPoints: 0.04
    };

    const browserWeights = {
      userAgent: 0.18,
      vendor: 0.03,
      product: 0.02,
      cookieEnabled: 0.02,
      plugins: 0.08
    };

    const renderingWeights = {
      canvasFingerprint: 0.12,
      webGLRenderer: 0.1,
      webGLVendor: 0.05,
      audioFingerprint: 0.08,
      fontFingerprint: 0.06
    };

    // Compare hardware components
    const hardwareResult = this.compareComponentGroup(components1.hardware, components2.hardware, hardwareWeights);
    totalWeight += hardwareResult.totalWeight;
    matchedWeight += hardwareResult.matchedWeight;
    
    // Compare browser components  
    const browserResult = this.compareComponentGroup(components1.browser, components2.browser, browserWeights);
    totalWeight += browserResult.totalWeight;
    matchedWeight += browserResult.matchedWeight;
    
    // Compare rendering components
    const renderingResult = this.compareComponentGroup(components1.rendering, components2.rendering, renderingWeights);
    totalWeight += renderingResult.totalWeight;
    matchedWeight += renderingResult.matchedWeight;

    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }

  /**
   * Compare component group with weights
   */
  private compareComponentGroup(
    group1: any,
    group2: any,
    weights: Record<string, number>
  ): { totalWeight: number; matchedWeight: number } {
    let totalWeight = 0;
    let matchedWeight = 0;
    
    Object.entries(weights).forEach(([key, weight]) => {
      totalWeight += weight;
      if (this.deepEqual(group1?.[key], group2?.[key])) {
        matchedWeight += weight;
      }
    });
    
    return { totalWeight, matchedWeight };
  }

  /**
   * Deep equality check for nested objects/arrays
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((val, index) => this.deepEqual(val, b[index]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      return keysA.length === keysB.length && keysA.every(key => this.deepEqual(a[key], b[key]));
    }
    return false;
  }

  /**
   * Enhanced bot detection with comprehensive analysis
   */
  detectBotBehavior(fingerprint: DeviceFingerprint, deviceData?: EnhancedDeviceData): {
    isBot: boolean;
    indicators: string[];
    confidence: number;
    category: 'human' | 'suspicious' | 'automated' | 'bot';
  } {
    const indicators: string[] = [];
    let botScore = 0;

    if (!fingerprint?.components) {
      return {
        isBot: false,
        indicators: ['Invalid fingerprint data'],
        confidence: 0,
        category: 'suspicious'
      };
    }

    const { components } = fingerprint;

    // Enhanced bot user agent detection
    if (components?.browser?.userAgent && this.isEnhancedBotUserAgent(components.browser.userAgent)) {
      indicators.push('Bot user agent pattern detected');
      botScore += 0.4;
    }

    // Screen and hardware inconsistencies
    if (components?.hardware && this.hasHardwareInconsistencies(components.hardware)) {
      indicators.push('Hardware configuration inconsistencies');
      botScore += 0.3;
    }

    // Browser feature detection
    if (components?.browser && (!components.browser.cookieEnabled || components.browser.plugins?.length === 0)) {
      indicators.push('Limited browser capabilities detected');
      botScore += 0.2;
    }

    // WebGL and rendering inconsistencies
    if (components.rendering && components.hardware && this.hasRenderingInconsistencies(components.rendering, components.hardware)) {
      indicators.push('Rendering inconsistencies detected');
      botScore += 0.25;
    }

    // Behavioral indicators
    if (components.behavioral && this.hasSuspiciousBehavior(components.behavioral)) {
      indicators.push('Automated behavior patterns detected');
      botScore += 0.3;
    }

    // Network indicators
    if (components.network?.webRTCIPs?.length === 0) {
      indicators.push('WebRTC disabled or blocked');
      botScore += 0.15;
    }

    // Device-specific checks
    if (deviceData) {
      if (deviceData.location?.proxy || deviceData.location?.vpn) {
        indicators.push('Proxy or VPN detected');
        botScore += 0.2;
      }

      if (this.hasAutomatedTimingPatterns(deviceData)) {
        indicators.push('Automated timing patterns detected');
        botScore += 0.35;
      }
    }

    // Determine category and confidence
    let category: 'human' | 'suspicious' | 'automated' | 'bot';
    if (botScore < 0.2) category = 'human';
    else if (botScore < 0.4) category = 'suspicious';
    else if (botScore < 0.7) category = 'automated';
    else category = 'bot';

    const threshold = this.config.security?.botDetectionThreshold || 0.5;

    return {
      isBot: botScore >= threshold,
      indicators,
      confidence: Math.min(botScore, 1.0),
      category
    };
  }

  /**
   * Generate a unique device ID that persists across sessions
   */
  generateDeviceId(fingerprint: DeviceFingerprint): string {
    // Use most stable components for device ID generation
    const stableComponents = [
      fingerprint.components.hardware.screenResolution,
      fingerprint.components.hardware.platform,
      fingerprint.components.hardware.hardwareConcurrency?.toString() || '0',
      fingerprint.components.browser.userAgent,
      fingerprint.components.rendering.webGLRenderer || '',
      fingerprint.components.rendering.webGLVendor || '',
      fingerprint.components.hardware.timezone
    ].join('|');

    return crypto
      .createHash('sha256')
      .update(stableComponents)
      .update(this.config.security?.fingerprintSalt || 'default-salt')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Advanced device collision detection with fuzzy matching
   */
  async checkDeviceCollision(fingerprint: DeviceFingerprint, userId: string): Promise<{
    hasCollision: boolean;
    collidingUsers: string[];
    similarityScores: Array<{ userId: string; score: number; reasons: string[] }>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    analysisDetails: {
      exactMatches: number;
      highSimilarity: number;
      mediumSimilarity: number;
      totalChecked: number;
    };
  }> {
    const existingFingerprints = await this.loadAllFingerprints();
    
    const collidingUsers: string[] = [];
    const similarityScores: Array<{ userId: string; score: number; reasons: string[] }> = [];
    let exactMatches = 0;
    let highSimilarity = 0;
    let mediumSimilarity = 0;
    
    for (const existing of existingFingerprints) {
      if (existing.userId === userId) continue;
      
      const analysis = this.performAdvancedFingerprintComparison(fingerprint, existing);
      similarityScores.push({ 
        userId: existing.userId, 
        score: analysis.overallScore, 
        reasons: analysis.matchReasons 
      });
      
      // Categorize similarity levels
      if (analysis.overallScore > 0.95) {
        exactMatches++;
        collidingUsers.push(existing.userId);
        this.logger.warn('EXACT device match detected', {
          currentUser: userId,
          existingUser: existing.userId,
          score: analysis.overallScore,
          reasons: analysis.matchReasons
        });
      } else if (analysis.overallScore > 0.85) {
        highSimilarity++;
        // Only flag as collision if multiple critical components match
        if (analysis.criticalComponentMatches >= 3) {
          collidingUsers.push(existing.userId);
          this.logger.warn('High similarity device match - likely same device', {
            currentUser: userId,
            existingUser: existing.userId,
            score: analysis.overallScore,
            criticalMatches: analysis.criticalComponentMatches,
            reasons: analysis.matchReasons
          });
        }
      } else if (analysis.overallScore > 0.75) {
        mediumSimilarity++;
        // Only flag if exact matches on most critical components
        if (analysis.exactCriticalMatches >= 2) {
          collidingUsers.push(existing.userId);
          this.logger.info('Medium similarity with exact critical matches', {
            currentUser: userId,
            existingUser: existing.userId,
            score: analysis.overallScore,
            exactCriticalMatches: analysis.exactCriticalMatches
          });
        }
      }
    }
    
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (exactMatches > 0) riskLevel = 'critical';
    else if (collidingUsers.length > 3) riskLevel = 'critical';
    else if (collidingUsers.length > 1) riskLevel = 'high';
    else if (collidingUsers.length === 1) riskLevel = 'medium';
    else riskLevel = 'low';
    
    return {
      hasCollision: collidingUsers.length > 0,
      collidingUsers: [...new Set(collidingUsers)], // Remove duplicates
      similarityScores: similarityScores
        .sort((a, b) => b.score - a.score)
        .slice(0, 15), // Top 15 matches
      riskLevel,
      analysisDetails: {
        exactMatches,
        highSimilarity,
        mediumSimilarity,
        totalChecked: existingFingerprints.length
      }
    };
  }
  
  /**
   * Advanced fingerprint comparison with detailed analysis
   */
  private performAdvancedFingerprintComparison(
    fp1: DeviceFingerprint, 
    fp2: DeviceFingerprint
  ): {
    overallScore: number;
    componentScores: Record<string, number>;
    matchReasons: string[];
    criticalComponentMatches: number;
    exactCriticalMatches: number;
  } {
    const componentScores: Record<string, number> = {};
    const matchReasons: string[] = [];
    let criticalComponentMatches = 0;
    let exactCriticalMatches = 0;

    // Short-circuit: if full device hashes are identical, it's an exact match
    if (fp1.hash && fp2.hash && fp1.hash === fp2.hash) {
      matchReasons.push('Identical device hash');
      // Mark all critical components as matched for risk evaluation context
      criticalComponentMatches = 6;
      exactCriticalMatches = 6;
      return {
        overallScore: 1.0,
        componentScores: {
          deviceHash: 1.0,
          canvasFingerprint: 1.0,
          webGLRenderer: 1.0,
          screenResolution: 1.0,
          userAgent: 1.0,
          hardwareConcurrency: 1.0,
          deviceMemory: 1.0
        },
        matchReasons,
        criticalComponentMatches,
        exactCriticalMatches
      };
    }
    
    // Critical components with high weights
    const criticalComponents = {
      canvasFingerprint: { weight: 0.25, critical: true },
      webGLRenderer: { weight: 0.20, critical: true },
      screenResolution: { weight: 0.15, critical: true },
      userAgent: { weight: 0.12, critical: true },
      hardwareConcurrency: { weight: 0.08, critical: true },
      deviceMemory: { weight: 0.06, critical: true }
    };
    
    // Secondary components
    const secondaryComponents = {
      timezone: { weight: 0.05, critical: false },
      language: { weight: 0.03, critical: false },
      platform: { weight: 0.03, critical: false },
      plugins: { weight: 0.02, critical: false },
      fonts: { weight: 0.01, critical: false }
    };
    
    const allComponents = { ...criticalComponents, ...secondaryComponents };
    
    // Canvas fingerprint comparison (most important)
    const canvasScore = this.compareCanvasFingerprints(fp1, fp2);
    componentScores.canvasFingerprint = canvasScore;
    if (canvasScore > 0.95) {
      matchReasons.push('Identical canvas fingerprint');
      criticalComponentMatches++;
      exactCriticalMatches++;
    } else if (canvasScore > 0.8) {
      matchReasons.push('Very similar canvas fingerprint');
      criticalComponentMatches++;
    }
    
    // WebGL renderer comparison
    const webglScore = this.compareWebGLFingerprints(fp1, fp2);
    componentScores.webGLRenderer = webglScore;
    if (webglScore > 0.95) {
      matchReasons.push('Identical WebGL renderer');
      criticalComponentMatches++;
      exactCriticalMatches++;
    } else if (webglScore > 0.8) {
      matchReasons.push('Very similar WebGL renderer');
      criticalComponentMatches++;
    }
    
    // Screen resolution (exact match only)
    const screenMatch = fp1.components.hardware.screenResolution === fp2.components.hardware.screenResolution;
    componentScores.screenResolution = screenMatch ? 1.0 : 0.0;
    if (screenMatch) {
      matchReasons.push('Identical screen resolution');
      criticalComponentMatches++;
      exactCriticalMatches++;
    }
    
    // User agent comparison (with normalization)
    const uaScore = this.compareUserAgents(
      fp1.components.browser.userAgent, 
      fp2.components.browser.userAgent
    );
    componentScores.userAgent = uaScore;
    if (uaScore > 0.95) {
      matchReasons.push('Identical user agent');
      criticalComponentMatches++;
      exactCriticalMatches++;
    } else if (uaScore > 0.8) {
      matchReasons.push('Very similar user agent');
      criticalComponentMatches++;
    }
    
    // Hardware concurrency (exact match)
    const hwMatch = fp1.components.hardware.hardwareConcurrency === fp2.components.hardware.hardwareConcurrency;
    componentScores.hardwareConcurrency = hwMatch ? 1.0 : 0.0;
    if (hwMatch) {
      matchReasons.push('Identical CPU core count');
      criticalComponentMatches++;
      exactCriticalMatches++;
    }
    
    // Device memory (exact match)
    const memMatch = fp1.components.hardware.deviceMemory === fp2.components.hardware.deviceMemory;
    componentScores.deviceMemory = memMatch ? 1.0 : 0.0;
    if (memMatch) {
      matchReasons.push('Identical device memory');
      criticalComponentMatches++;
      exactCriticalMatches++;
    }
    
    // Secondary component comparisons
    const timezoneMatch = fp1.components.hardware.timezone === fp2.components.hardware.timezone;
    componentScores.timezone = timezoneMatch ? 1.0 : 0.0;
    if (timezoneMatch) matchReasons.push('Same timezone');
    
    const langMatch = fp1.components.hardware.language === fp2.components.hardware.language;
    componentScores.language = langMatch ? 1.0 : 0.0;
    if (langMatch) matchReasons.push('Same language');
    
    const platformMatch = fp1.components.hardware.platform === fp2.components.hardware.platform;
    componentScores.platform = platformMatch ? 1.0 : 0.0;
    if (platformMatch) matchReasons.push('Same platform');
    
    // Plugin similarity
    const pluginScore = this.comparePlugins(fp1.components.browser.plugins, fp2.components.browser.plugins);
    componentScores.plugins = pluginScore;
    if (pluginScore > 0.9) matchReasons.push('Very similar plugins');
    
    // Font similarity
    const fontScore = this.compareFonts(
      fp1.components.rendering.fontFingerprint, 
      fp2.components.rendering.fontFingerprint
    );
    componentScores.fonts = fontScore;
    if (fontScore > 0.9) matchReasons.push('Very similar fonts');
    
    // Calculate weighted overall score
    let totalWeight = 0;
    let weightedScore = 0;
    
    Object.entries(allComponents).forEach(([component, config]) => {
      const score = componentScores[component] || 0;
      weightedScore += score * config.weight;
      totalWeight += config.weight;
    });
    
    const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    
    return {
      overallScore,
      componentScores,
      matchReasons,
      criticalComponentMatches,
      exactCriticalMatches
    };
  }
  
  /**
   * Compare canvas fingerprints with fuzzy matching
   */
  private compareCanvasFingerprints(fp1: DeviceFingerprint, fp2: DeviceFingerprint): number {
    const canvas1 = fp1.components.rendering.canvasFingerprint;
    const canvas2 = fp2.components.rendering.canvasFingerprint;
    
    if (!canvas1 || !canvas2) return 0;
    if (canvas1 === canvas2) return 1.0;
    
    // For canvas, we need exact match or very high similarity
    // Canvas fingerprints should be nearly identical on same device
    const similarity = this.calculateStringSimilarity(canvas1, canvas2);
    return similarity > 0.98 ? similarity : 0;
  }
  
  /**
   * Compare WebGL fingerprints
   */
  private compareWebGLFingerprints(fp1: DeviceFingerprint, fp2: DeviceFingerprint): number {
    const webgl1 = fp1.components.rendering;
    const webgl2 = fp2.components.rendering;
    
    if (!webgl1 || !webgl2) return 0;
    
    let matches = 0;
    let total = 0;
    
    // Compare WebGL vendor
    if (webgl1.webGLVendor && webgl2.webGLVendor) {
      matches += webgl1.webGLVendor === webgl2.webGLVendor ? 1 : 0;
      total++;
    }
    
    // Compare WebGL renderer
    if (webgl1.webGLRenderer && webgl2.webGLRenderer) {
      matches += webgl1.webGLRenderer === webgl2.webGLRenderer ? 1 : 0;
      total++;
    }
    
    // Compare WebGL version
    if (webgl1.webGLVersion && webgl2.webGLVersion) {
      matches += webgl1.webGLVersion === webgl2.webGLVersion ? 1 : 0;
      total++;
    }
    
    return total > 0 ? matches / total : 0;
  }
  
  /**
   * Compare user agents with normalization
   */
  private compareUserAgents(ua1: string, ua2: string): number {
    if (!ua1 || !ua2) return 0;
    if (ua1 === ua2) return 1.0;
    
    // Normalize user agents for comparison
    const normalized1 = this.normalizeUserAgent(ua1);
    const normalized2 = this.normalizeUserAgent(ua2);
    
    if (normalized1 === normalized2) return 0.95; // High similarity after normalization
    
    return this.calculateStringSimilarity(normalized1, normalized2);
  }
  
  /**
   * Normalize user agent for comparison
   */
  private normalizeUserAgent(userAgent: string): string {
    if (!userAgent) return '';
    
    return userAgent
      // Remove version numbers
      .replace(/\b\d+\.\d+\.\d+(\.\d+)?\b/g, 'X.X.X')
      // Remove build numbers
      .replace(/\b(Build\/|rv:)[\w.]+\b/g, 'Build/XXX')
      // Normalize browser versions
      .replace(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/g, '$1/XXX')
      // Remove parenthetical version info
      .replace(/\([^)]*Version[^)]*\)/g, '(Version/XXX)')
      .trim();
  }
  
  /**
   * Compare plugin arrays
   */
  private comparePlugins(plugins1: string[], plugins2: string[]): number {
    if (!plugins1 || !plugins2) return 0;
    if (plugins1.length === 0 && plugins2.length === 0) return 1.0;
    if (plugins1.length === 0 || plugins2.length === 0) return 0;
    
    const set1 = new Set(plugins1.map(p => p.toLowerCase()));
    const set2 = new Set(plugins2.map(p => p.toLowerCase()));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }
  
  /**
   * Compare font fingerprints
   */
  private compareFonts(fonts1: string, fonts2: string): number {
    if (!fonts1 || !fonts2) return 0;
    if (fonts1 === fonts2) return 1.0;
    
    return this.calculateStringSimilarity(fonts1, fonts2);
  }
  
  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;
    
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;
    
    const distance = this.levenshteinDistance(str1, str2);
    return 1 - (distance / maxLength);
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Validate location data consistency
   */
  private async validateLocation(
    locationData: EnhancedDeviceData['location'], 
    browserTimezone: string
  ): Promise<any> {
    if (!locationData) return null;
    
    // Safely extract values with fallbacks
    const country = locationData.country || 'Unknown';
    const region = locationData.region || 'Unknown';
    const isp = locationData.isp || 'Unknown';
    
    try {
      return await this.locationService.checkLocationConsistency(
        {
          ip: locationData.ip || '127.0.0.1',
          country,
          countryCode: country.length >= 2 ? country.substring(0, 2) : 'UN',
          region,
          regionCode: region.length >= 2 ? region.substring(0, 2) : 'UN',
          city: locationData.city || 'Unknown',
          latitude: locationData.latitude || 0,
          longitude: locationData.longitude || 0,
          timezone: locationData.timezone || browserTimezone || 'UTC',
          isp,
          org: isp,
          asn: 'Unknown',
          proxy: locationData.proxy || false,
          vpn: locationData.vpn || false,
          tor: false,
          hosting: false,
          mobile: false
        },
        browserTimezone || 'UTC',
        'en' // Default language, should come from browser data
      );
    } catch (error) {
      this.logger.error('Error validating location:', error);
      return null;
    }
  }

  /**
   * Normalize enhanced device components
   */
  private normalizeDeviceComponents(deviceData: EnhancedDeviceData): DeviceFingerprintComponents {
    // Ensure all components exist with safe defaults
    const hardware = deviceData?.hardware || {};
    const browser = deviceData?.browser || {};
    const rendering = deviceData?.rendering || {};
    const network = deviceData?.network || {};
    const behavioral = deviceData?.behavioral || {};

    return {
      hardware: {
        ...hardware,
        screenResolution: this.normalizeResolution((hardware as any).screenResolution),
        screenColorDepth: typeof (hardware as any).screenColorDepth === 'string'
          ? (hardware as any).screenColorDepth
          : typeof (hardware as any).colorDepth === 'number'
            ? `${(hardware as any).colorDepth}-bit`
            : 'unknown',
        availableScreenSize: (hardware as any).availableScreenSize || 'unknown',
        timezone: this.normalizeTimezone((hardware as any).timezone),
        timezoneOffset: typeof (hardware as any).timezoneOffset === 'number' ? (hardware as any).timezoneOffset : 0,
        language: (hardware as any).language?.toLowerCase() || 'unknown',
        languages: (hardware as any).languages || [],
        platform: (hardware as any).platform?.toLowerCase() || 'unknown',
        // Ensure all required fields have defaults
        hardwareConcurrency: (hardware as any).hardwareConcurrency || 0,
        deviceMemory: (hardware as any).deviceMemory || 0,
        maxTouchPoints: (hardware as any).maxTouchPoints || 0
      },
      browser: {
        ...browser,
        userAgent: this.normalizeUserAgent((browser as any).userAgent || ''),
        vendor: (browser as any).vendor || 'unknown',
        vendorSub: (browser as any).vendorSub || '',
        product: (browser as any).product || 'unknown',
        productSub: (browser as any).productSub || '',
        appName: (browser as any).appName || 'unknown',
        appVersion: (browser as any).appVersion || 'unknown',
        appCodeName: (browser as any).appCodeName || 'unknown',
        cookieEnabled: (browser as any).cookieEnabled !== undefined ? (browser as any).cookieEnabled : true,
        doNotTrack: typeof (browser as any).doNotTrack === 'string' ? (browser as any).doNotTrack : undefined,
        onLine: (browser as any).onLine !== undefined ? (browser as any).onLine : true,
        javaEnabled: (browser as any).javaEnabled !== undefined ? (browser as any).javaEnabled : false,
        plugins: this.normalizePlugins((browser as any).plugins || []),
        mimeTypes: this.normalizeMimeTypes((browser as any).mimeTypes || [])
      },
      rendering: rendering,
      network: {
        // Only include static network characteristics, exclude dynamic measurements
        connection: {
          effectiveType: (network as any)?.connection?.effectiveType || 'unknown',
          // Exclude downlink and rtt - these vary dynamically even on same device
          // downlink: network?.connection?.downlink, // EXCLUDED - dynamic
          // rtt: network?.connection?.rtt, // EXCLUDED - dynamic
          saveData: (network as any)?.connection?.saveData || false
        },
        webRTCIPs: (network as any)?.webRTCIPs || [],
        dnsOverHttps: (network as any)?.dnsOverHttps || false
      },
      // Behavioral data excluded from hash computation for deterministic results
      // This data is still collected and stored for bot detection analysis
      // but not included in device hash to ensure identical devices always generate same hash
      behavioral: {
        // Static marker only - no temporal data
        focusEvents: (behavioral as any).focusEvents || 0
      }
    };
  }

  /**
   * Normalize plugins array
   */
  private normalizePlugins(plugins: string[]): string[] {
    return plugins
      .map(plugin => plugin.toLowerCase().trim())
      .filter(plugin => plugin.length > 0)
      .sort();
  }

  /**
   * Normalize MIME types array
   */
  private normalizeMimeTypes(mimeTypes: string[]): string[] {
    return mimeTypes
      .map(type => type.toLowerCase().trim())
      .filter(type => type.length > 0)
      .sort();
  }

  private normalizeTimezone(timezone: any): string {
    if (typeof timezone === 'string') {
      return timezone.toLowerCase();
    } else if (typeof timezone === 'number') {
      return `utc${timezone >= 0 ? '+' : ''}${timezone}`;
    } else {
      return 'unknown';
    }
  }

  /**
   * Generate device hash from fingerprint data (public method for UnifiedSecurityEngine)
   */
  public generateDeviceHash(fingerprint: any): string {
    try {
      if (!fingerprint) {
        return 'no_fingerprint_' + Date.now();
      }

      // Create a deterministic hash from device fingerprint
      const hashData = {
        deviceId: fingerprint.deviceId || '',
        userAgent: fingerprint.userAgent || '',
        screenResolution: fingerprint.screenResolution || '',
        timezone: fingerprint.timezone || '',
        language: fingerprint.language || '',
        platform: fingerprint.platform || '',
        canvasFingerprint: fingerprint.canvasFingerprint || '',
        audioFingerprint: fingerprint.audioFingerprint || '',
        webGLRenderer: fingerprint.webGLRenderer || ''
      };

      const dataString = JSON.stringify(hashData, Object.keys(hashData).sort());
      const finalDataString = dataString || 'fallback_data';

      return require('crypto')
        .createHash('sha256')
        .update(finalDataString)
        .digest('hex');
    } catch (error) {
      // Fallback hash in case of error
      return 'error_hash_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
  }

  /**
   * Compute hash from enhanced device components
   */
  private computeHash(components: DeviceFingerprintComponents): string {
    // Create a deterministic string from ONLY static device components
    // Exclude behavioral and network data to ensure identical devices always generate the same hash
    const hashData = {
      hardware: this.serializeForHash(components.hardware),
      browser: this.serializeForHash(components.browser),
      rendering: this.serializeForHash(components.rendering)
      // behavioral/network: EXCLUDED to prevent variability across networks or sessions
    };

    const dataString = JSON.stringify(hashData, Object.keys(hashData).sort());
    const finalDataString = dataString || 'fallback_data';

    return crypto
      .createHash('sha256')
      .update(finalDataString)
      .update(this.config.security?.fingerprintSalt || 'default-salt')
      .digest('hex');
  }

  /**
   * Serialize object for consistent hashing
   */
  private serializeForHash(obj: any): string {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.serializeForHash(item)).join(',');
    }
    if (typeof obj === 'object') {
      return Object.keys(obj)
        .sort()
        .map(key => `${key}:${this.serializeForHash(obj[key])}`)
        .join('|');
    }
    return '';
  }

  /**
   * Calculate comprehensive fingerprint quality
   */
  private calculateFingerprintQuality(components: DeviceFingerprintComponents): FingerprintQuality {
    const hardwareQuality = this.calculateComponentQuality(components.hardware, {
      screenResolution: 0.2,
      platform: 0.15,
      hardwareConcurrency: 0.15,
      deviceMemory: 0.1,
      timezone: 0.2,
      language: 0.1,
      maxTouchPoints: 0.1
    });

    const browserQuality = this.calculateComponentQuality(components.browser, {
      userAgent: 0.3,
      vendor: 0.1,
      plugins: 0.25,
      mimeTypes: 0.2,
      cookieEnabled: 0.05,
      javaEnabled: 0.1
    });

    const renderingQuality = this.calculateComponentQuality(components.rendering, {
      canvasFingerprint: 0.3,
      webGLRenderer: 0.25,
      webGLVendor: 0.15,
      audioFingerprint: 0.2,
      fontFingerprint: 0.1
    });

    const networkQuality = this.calculateComponentQuality(components.network, {
      connection: 0.4,
      webRTCIPs: 0.6
    });

    const overall = (hardwareQuality + browserQuality + renderingQuality + networkQuality) / 4;

    return {
      overall: Math.min(overall, 1.0),
      hardware: hardwareQuality,
      browser: browserQuality,
      rendering: renderingQuality,
      network: networkQuality,
      uniqueness: this.calculateUniqueness(components),
      stability: 0.8 // Would be calculated based on historical data
    };
  }

  /**
   * Calculate quality for a component group
   */
  private calculateComponentQuality(component: any, weights: Record<string, number>): number {
    let quality = 0;
    Object.entries(weights).forEach(([key, weight]) => {
      const value = component[key];
      if (this.hasValidValue(value)) {
        quality += weight;
      }
    });
    return Math.min(quality, 1.0);
  }

  /**
   * Calculate uniqueness score
   */
  private calculateUniqueness(components: DeviceFingerprintComponents): number {
    // This would be calculated based on how common each component is
    // For now, return a baseline value
    let uniqueness = 0.5;
    
    // Rare screen resolutions are more unique
    if (components.hardware.screenResolution && !this.isCommonResolution(components.hardware.screenResolution)) {
      uniqueness += 0.1;
    }
    
    // Unusual plugin combinations are more unique
    if (components.browser.plugins.length > 10) {
      uniqueness += 0.1;
    }
    
    return Math.min(uniqueness, 1.0);
  }

  /**
   * Check if resolution is commonly used
   */
  private isCommonResolution(resolution: string): boolean {
    const commonResolutions = [
      '1920x1080', '1366x768', '1440x900', '1536x864', '1280x720',
      '1600x900', '1024x768', '1280x800', '1920x1200'
    ];
    return commonResolutions.includes(resolution);
  }

  /**
   * Calculate enhanced risk score with comprehensive analysis
   */
  private calculateEnhancedRiskScore(deviceData: EnhancedDeviceData, riskFactors: RiskFactor[]): number {
    let riskScore = 0;

    // Base risk from risk factors
    riskFactors.forEach(factor => {
      riskScore += factor.score;
    });

    // Location-based risks
    if (deviceData.location) {
      if (deviceData.location.vpn || deviceData.location.proxy) {
        riskScore += 0.3;
      }
      
      // High-risk countries (would be configurable)
      const highRiskCountries = ['XX', 'YY']; // Placeholder
      if (highRiskCountries.includes(deviceData.location.country)) {
        riskScore += 0.2;
      }
    }

    // Browser inconsistencies
    if (this.hasHardwareInconsistencies(deviceData.hardware)) {
      riskScore += 0.25;
    }

    // Behavioral risks
    if (this.hasSuspiciousBehavior(deviceData.behavioral)) {
      riskScore += 0.3;
    }

    // Telegram-specific risks
    if (deviceData.telegramData) {
      // Check for inconsistencies between Telegram platform and device info
      if (this.hasTelegramInconsistencies(deviceData.telegramData, deviceData.hardware)) {
        riskScore += 0.2;
      }
    }

    return Math.min(riskScore, 1.0);
  }

  /**
   * Generate comprehensive risk factors
   */
  private async generateRiskFactors(deviceData: EnhancedDeviceData, components: DeviceFingerprintComponents): Promise<RiskFactor[]> {
    const riskFactors: RiskFactor[] = [];
    const timestamp = new Date().toISOString();

    // Bot detection
    const botAnalysis = this.detectBotBehavior({ 
      hash: '', userId: '', components, quality: {} as any, 
      registeredAt: '', lastSeenAt: '', usageCount: 0, 
      isBlocked: false, riskScore: 0, metadata: {} as any 
    }, deviceData);
    
    if (botAnalysis.isBot) {
      riskFactors.push({
        type: 'bot_detected',
        severity: botAnalysis.category === 'bot' ? 'critical' : 'high',
        score: botAnalysis.confidence,
        description: `Bot behavior detected: ${botAnalysis.indicators.join(', ')}`,
        evidence: {
          indicators: botAnalysis.indicators,
          confidence: botAnalysis.confidence,
          category: botAnalysis.category
        },
        detectedAt: timestamp
      });
    }

    // VPN/Proxy detection
    if (deviceData.location?.vpn || deviceData.location?.proxy) {
      riskFactors.push({
        type: 'vpn_detected',
        severity: 'medium',
        score: 0.3,
        description: 'VPN or proxy service detected',
        evidence: {
          vpn: deviceData.location.vpn,
          proxy: deviceData.location.proxy,
          isp: deviceData.location.isp
        },
        detectedAt: timestamp
      });
    }

    // Hardware inconsistencies
    if (this.hasHardwareInconsistencies(deviceData.hardware)) {
      riskFactors.push({
        type: 'device_fingerprint_mismatch',
        severity: 'medium',
        score: 0.25,
        description: 'Hardware configuration inconsistencies detected',
        evidence: {
          hardwareDetails: deviceData.hardware
        },
        detectedAt: timestamp
      });
    }

    return riskFactors;
  }

  /**
   * Detect changes between device components
   */
  private detectComponentChanges(
    oldComponents: DeviceFingerprintComponents,
    newComponents: DeviceFingerprintComponents
  ): Record<string, { old: any; new: any }> {
    const changes: Record<string, { old: any; new: any }> = {};

    // Compare each component group
    const groups = ['hardware', 'browser', 'rendering', 'network', 'behavioral'] as const;
    
    groups.forEach(group => {
      const oldGroup = oldComponents[group];
      const newGroup = newComponents[group];
      
      if (!oldGroup && !newGroup) return;
      if (!oldGroup || !newGroup) {
        changes[group] = { old: oldGroup, new: newGroup };
        return;
      }
      
      // Deep comparison for nested objects
      const groupChanges = this.detectNestedChanges(oldGroup, newGroup, group);
      Object.assign(changes, groupChanges);
    });

    return changes;
  }

  /**
   * Detect changes in nested objects
   */
  private detectNestedChanges(oldObj: any, newObj: any, prefix: string): Record<string, { old: any; new: any }> {
    const changes: Record<string, { old: any; new: any }> = {};
    
    if (!oldObj || !newObj) return changes;
    
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    
    allKeys.forEach(key => {
      const oldValue = oldObj[key];
      const newValue = newObj[key];
      const fullKey = `${prefix}.${key}`;
      
      if (!this.deepEqual(oldValue, newValue)) {
        changes[fullKey] = { old: oldValue, new: newValue };
      }
    });
    
    return changes;
  }

  /**
   * Analyze suspicious changes with enhanced logic
   */
  private async analyzeSuspiciousChanges(
    changes: Record<string, { old: any; new: any }>,
    existing: DeviceFingerprint,
    newDeviceData: EnhancedDeviceData
  ): Promise<string[]> {
    const suspicious: string[] = [];

    // Hardware changes are highly suspicious
    if (changes['hardware.screenResolution']) {
      suspicious.push('Screen resolution changed - possible device switch');
    }
    
    if (changes['hardware.platform']) {
      suspicious.push('Platform changed - possible device switch');
    }
    
    if (changes['hardware.hardwareConcurrency']) {
      suspicious.push('CPU core count changed - possible device switch');
    }

    // WebGL changes indicate hardware changes
    if (changes['rendering.webGLRenderer'] || changes['rendering.webGLVendor']) {
      suspicious.push('Graphics hardware changed');
    }

    // Browser changes
    if (changes['browser.userAgent']) {
      const oldUA = changes['browser.userAgent'].old;
      const newUA = changes['browser.userAgent'].new;
      
      // Major browser changes are suspicious
      if (this.isDifferentBrowser(oldUA, newUA)) {
        suspicious.push('Browser type changed');
      }
    }

    // Plugin changes (major additions/removals)
    if (changes['browser.plugins']) {
      const oldPlugins = changes['browser.plugins'].old || [];
      const newPlugins = changes['browser.plugins'].new || [];
      
      if (Math.abs(oldPlugins.length - newPlugins.length) > 5) {
        suspicious.push('Significant plugin configuration change');
      }
    }

    // Timezone inconsistencies
    if (changes['hardware.timezone'] && !changes['browser.userAgent']) {
      suspicious.push('Timezone changed without browser change');
    }

    // Location-based suspicious changes
    if (newDeviceData.location && existing.metadata.customData?.locationValidation) {
      const previousLocation = existing.metadata.customData.locationValidation;
      const currentLocation = newDeviceData.location;
      
      if (this.isImpossibleLocationChange(previousLocation, currentLocation)) {
        suspicious.push('Impossible geographic movement detected');
      }
    }

    return suspicious;
  }

  /**
   * Check if user agents represent different browsers
   */
  private isDifferentBrowser(oldUA: string, newUA: string): boolean {
    const getBrowserType = (ua: string) => {
      if (ua.includes('Chrome')) return 'chrome';
      if (ua.includes('Firefox')) return 'firefox';
      if (ua.includes('Safari')) return 'safari';
      if (ua.includes('Edge')) return 'edge';
      return 'unknown';
    };
    
    return getBrowserType(oldUA) !== getBrowserType(newUA);
  }

  /**
   * Check for impossible location changes
   */
  private isImpossibleLocationChange(previous: any, current: any): boolean {
    // Implementation would check geographic distance and time
    // For now, return false
    return false;
  }


  /**
   * Enhanced bot user agent detection
   */
  private isEnhancedBotUserAgent(userAgent: string): boolean {
    if (!userAgent) return true;
    
    const botPatterns = [
      // Traditional bots
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      // Automation tools
      /selenium/i, /phantomjs/i, /headless/i, /chrome-headless/i,
      /puppeteer/i, /playwright/i,
      // Development tools
      /curl/i, /wget/i, /python/i, /java/i, /go-http/i,
      // Suspicious patterns
      /undefined/i, /unknown/i,
      // Common automation frameworks
      /webdriver/i, /remote-control/i
    ];

    const suspiciousPatterns = [
      // Too generic
      /^Mozilla$/i,
      // Missing common components
      /Mozilla.*without.*AppleWebKit/i,
      // Inconsistent patterns
      /Chrome.*Safari.*Chrome/i
    ];

    return botPatterns.some(pattern => pattern.test(userAgent)) ||
           suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  private normalizeResolution(resolution: string): string {
    if (!resolution) return 'unknown';
    
    // Sort dimensions to handle orientation changes
    const [width, height] = resolution.split('x').map(Number).sort((a, b) => b - a);
    return `${width}x${height}`;
  }

  private isBotUserAgent(userAgent: string): boolean {
    if (!userAgent) return true;
    
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /java/i,
      /selenium/i, /phantomjs/i, /headless/i
    ];

    return botPatterns.some(pattern => pattern.test(userAgent));
  }

  /**
   * Enhanced hardware inconsistency detection
   */
  private hasHardwareInconsistencies(hardware: HardwareFingerprint | undefined): boolean {
    // Return false if hardware data is not available
    if (!hardware) {
      return false;
    }
    
    // Screen resolution validation
    if (hardware.screenResolution && this.isUnusualResolution(hardware.screenResolution)) {
      return true;
    }
    
    // Hardware concurrency validation
    if (hardware.hardwareConcurrency && (hardware.hardwareConcurrency < 1 || hardware.hardwareConcurrency > 32)) {
      return true;
    }
    
    // Device memory validation
    if (hardware.deviceMemory && (hardware.deviceMemory < 0.25 || hardware.deviceMemory > 32)) {
      return true;
    }
    
    // Touch points validation for non-mobile devices
    const platform = hardware.platform || '';
    const isMobile = /mobile|android|iphone|ipad/i.test(platform);
    if (!isMobile && hardware.maxTouchPoints && hardware.maxTouchPoints > 10) {
      return true;
    }
    
    return false;
  }
  
  private isUnusualResolution(resolution: string): boolean {
    if (!resolution || resolution === 'unknown') return true;
    
    const parts = resolution.split('x');
    if (parts.length !== 2) return true;
    
    const [width, height] = parts.map(Number);
    
    if (isNaN(width) || isNaN(height)) return true;
    
    // Check for extremely small or large resolutions
    if (width < 320 || height < 240 || width > 7680 || height > 4320) {
      return true;
    }

    // Check for unusual aspect ratios
    const aspectRatio = Math.max(width, height) / Math.min(width, height);
    return aspectRatio > 4.0; // Very wide or tall screens
  }

  /**
   * Check for rendering inconsistencies
   */
  private hasRenderingInconsistencies(rendering: RenderingFingerprint, hardware: HardwareFingerprint): boolean {
    // Check for null/undefined parameters
    if (!rendering || !hardware) {
      return false;
    }
    
    // Check for missing essential rendering components
    if (!rendering.canvasFingerprint && !rendering.webGLRenderer) {
      return true;
    }
    
    // Check WebGL vendor/renderer consistency
    if (rendering.webGLVendor && rendering.webGLRenderer) {
      const vendor = rendering.webGLVendor.toLowerCase();
      const renderer = rendering.webGLRenderer.toLowerCase();
      
      // Basic consistency checks
      if (vendor.includes('nvidia') && !renderer.includes('nvidia')) return true;
      if (vendor.includes('amd') && !renderer.includes('amd') && !renderer.includes('radeon')) return true;
      if (vendor.includes('intel') && !renderer.includes('intel')) return true;
    }
    
    return false;
  }

  /**
   * Check for suspicious behavioral patterns
   */
  private hasSuspiciousBehavior(behavioral: BehavioralFingerprint): boolean {
    if (!behavioral) return false;
    
    // Check for robotic mouse movement patterns
    if (behavioral.mouseMovementPattern) {
      // Would analyze mouse movement for robotic patterns
      // For now, return false
    }
    
    // Check for automated keyboard patterns
    if (behavioral.keyboardPattern) {
      // Would analyze typing patterns for automation
    }
    
    // Check interaction timing
    if (behavioral.interactionTiming && behavioral.interactionTiming.length > 5) {
      const timings = behavioral.interactionTiming;
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((acc, timing) => acc + Math.pow(timing - avgTiming, 2), 0) / timings.length;
      
      // Very consistent timing suggests automation
      if (variance < 100 && avgTiming < 1000) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check for Telegram inconsistencies
   */
  private hasTelegramInconsistencies(telegramData: EnhancedDeviceData['telegramData'], hardware: HardwareFingerprint): boolean {
    if (!telegramData) return false;
    
    // Check platform consistency
    if (!telegramData.platform || !hardware.platform) return false;
    
    const tgPlatform = telegramData.platform.toLowerCase();
    const devicePlatform = hardware.platform.toLowerCase();
    
    // Basic platform consistency checks
    if (tgPlatform.includes('ios') && !devicePlatform.includes('iphone') && !devicePlatform.includes('ipad')) {
      return true;
    }
    
    if (tgPlatform.includes('android') && !devicePlatform.includes('android')) {
      return true;
    }
    
    return false;
  }

  /**
   * Check for automated timing patterns
   */
  private hasAutomatedTimingPatterns(deviceData: EnhancedDeviceData): boolean {
    // This would analyze session timing, interaction patterns, etc.
    // For now, return false as it requires historical data
    return false;
  }

  /**
   * Check if value is valid (not empty, null, undefined)
   */
  private hasValidValue(value: any): boolean {
    return value !== null && value !== undefined && value !== '' && value !== 'unknown';
  }

  /**
   * Load all fingerprints from storage for collision detection
   */
  private async loadAllFingerprints(): Promise<DeviceFingerprint[]> {
    try {
      // Use storage to get all device fingerprints
      const allFingerprints = await this.storage.getAllDeviceFingerprints();
      
      // Convert stored fingerprint data to DeviceFingerprint objects
      const deviceFingerprints: DeviceFingerprint[] = [];
      
      for (const storedFingerprint of allFingerprints) {
        if (storedFingerprint && storedFingerprint.userId && storedFingerprint.hash) {
          // Create a proper DeviceFingerprint object from stored data
          // Determine the correct hash string: if already a string, use as-is. If it's an object, derive a stable hash.
          const storedHash: string = typeof storedFingerprint.hash === 'string'
            ? storedFingerprint.hash
            : this.createFingerprintHash(storedFingerprint.hash);

          const fingerprint: DeviceFingerprint = {
            hash: storedHash,
            userId: storedFingerprint.userId,
            components: {
              hardware: {
                screenResolution: storedFingerprint.hash.screenWidth && storedFingerprint.hash.screenHeight ? 
                  `${storedFingerprint.hash.screenWidth}x${storedFingerprint.hash.screenHeight}` : '0x0',
                screenColorDepth: storedFingerprint.hash.colorDepth?.toString() || '24',
                availableScreenSize: 'unknown',
                timezone: storedFingerprint.hash.timezone || 'UTC',
                timezoneOffset: 0,
                language: storedFingerprint.hash.language || 'en',
                languages: [],
                platform: storedFingerprint.hash.platform || 'unknown',
                hardwareConcurrency: storedFingerprint.hash.hardwareConcurrency || 4,
                deviceMemory: storedFingerprint.hash.deviceMemory || 8,
                maxTouchPoints: 0
              },
              browser: {
                userAgent: storedFingerprint.hash.userAgent || storedFingerprint.userAgent || 'unknown',
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
                plugins: storedFingerprint.hash.plugins || [],
                mimeTypes: []
              },
              rendering: {
                canvasFingerprint: typeof storedFingerprint.hash === 'object' ? (storedFingerprint.hash.canvasFingerprint || '') : '',
                webGLVendor: 'unknown',
                webGLRenderer: 'unknown',
                webGLVersion: 'unknown',
                webGLShadingLanguageVersion: 'unknown',
                webGLExtensions: [],
                audioFingerprint: '44100',
                fontFingerprint: 'Arial,Helvetica,Times,Courier,Verdana,Georgia'
              },
              network: {
                connection: {
                  effectiveType: '4g',
                  saveData: false
                },
                webRTCIPs: [],
                dnsOverHttps: false
              },
              behavioral: {
                mouseMovementPattern: '[]',
                keyboardPattern: '[]',
                interactionTiming: [],
                focusEvents: 0
              }
            },
            quality: {
              overall: 0.8,
              hardware: 0.8,
              browser: 0.8,
              rendering: 0.8,
              network: 0.8,
              uniqueness: 0.8,
              stability: 0.8
            },
            registeredAt: storedFingerprint.timestamp || new Date().toISOString(),
            lastSeenAt: storedFingerprint.updatedAt || new Date().toISOString(),
            usageCount: 1,
            isBlocked: false,
            riskScore: 0.1,
            metadata: {
              collisionCount: 0,
              similarDevices: [],
              riskFactors: [],
              verificationHistory: []
            }
          };
          
          // Prefer stored full components if available (ensures robust fuzzy matching)
          if (storedFingerprint.components && typeof storedFingerprint.components === 'object') {
            try {
              fingerprint.components = storedFingerprint.components as any;
            } catch {}
          }
          
          deviceFingerprints.push(fingerprint);
        }
      }
      
      this.logger.info(`Loaded ${deviceFingerprints.length} device fingerprints for collision detection`);
      return deviceFingerprints;
      
    } catch (error) {
      this.logger.error('CRITICAL: Failed to load device fingerprints - this will cause multi-account detection to fail!', error);
      // Instead of returning empty array, try to recover with direct storage access
      try {
        const rawData = await this.storage.get('enhanced_device_fingerprints');
        if (rawData && Object.keys(rawData).length > 0) {
          this.logger.warn('Found raw fingerprint data - attempting recovery');
          const recoveredFingerprints: DeviceFingerprint[] = [];
          
          // Try to recover from malformed keys like "[object Object]"
          for (const [key, value] of Object.entries(rawData)) {
            if (Array.isArray(value)) {
              for (const fp of value as any[]) {
                if (fp.userId && fp.hash) {
                  try {
                    // Create proper hash if malformed
                    const properHash = typeof fp.hash === 'string' ? fp.hash : this.createFingerprintHash(fp.hash);
                    
                    const recoveredFp: DeviceFingerprint = {
                      hash: properHash,
                      userId: fp.userId,
                      components: this.createComponentsFromStoredData(fp.hash),
                      quality: { overall: 0.8, hardware: 0.8, browser: 0.8, rendering: 0.8, network: 0.8, uniqueness: 0.8, stability: 0.8 },
                      registeredAt: fp.timestamp || new Date().toISOString(),
                      lastSeenAt: fp.updatedAt || new Date().toISOString(),
                      usageCount: 1,
                      isBlocked: false,
                      riskScore: 0.1,
                      metadata: { collisionCount: 0, similarDevices: [], riskFactors: [], verificationHistory: [] }
                    };
                    
                    recoveredFingerprints.push(recoveredFp);
                  } catch (recoverError) {
                    this.logger.warn(`Failed to recover fingerprint for user ${fp.userId}:`, recoverError);
                  }
                }
              }
            }
          }
          
          this.logger.info(`Recovered ${recoveredFingerprints.length} device fingerprints from malformed storage`);
          return recoveredFingerprints;
        }
      } catch (recoveryError) {
        this.logger.error('Recovery attempt also failed:', recoveryError);
      }
      
      // CRITICAL: If we reach here, multi-account detection will NOT work
      this.logger.error('🚨 CRITICAL SECURITY FAILURE: No fingerprints loaded - multi-account detection disabled!');
      return [];
    }
  }

  /**
   * Create fingerprint hash from stored fingerprint data - FIXED
   */
  private createFingerprintHash(fingerprintData: any): string {
    try {
      // Handle both old malformed data and new proper hash data
      if (typeof fingerprintData === 'string') {
        return fingerprintData; // Already a hash string
      }
      
      // Create proper hash from components
      const components = [
        fingerprintData.userAgent || '',
        fingerprintData.canvasFingerprint || '',
        fingerprintData.platform || '',
        fingerprintData.screenWidth || '0',
        fingerprintData.screenHeight || '0',
        fingerprintData.colorDepth || '24',
        fingerprintData.timezone || 'UTC',
        fingerprintData.language || 'en',
        fingerprintData.hardwareConcurrency || '4',
        fingerprintData.deviceMemory || '8'
      ].join('|');
      
      const hash = crypto.createHash('sha256').update(components).digest('hex').substring(0, 32);
      this.logger.debug('Created fingerprint hash', { hash: hash.substring(0, 8) + '...' });
      return hash;
    } catch (error) {
      this.logger.error('Error creating fingerprint hash:', error);
      return crypto.createHash('sha256').update(JSON.stringify(fingerprintData)).digest('hex').substring(0, 32);
    }
  }

  /**
   * Create components from stored data for recovery
   */
  private createComponentsFromStoredData(storedData: any): DeviceFingerprint['components'] {
    // If storedData is a string (already-hashed), return minimal components; hash equality will handle exact matches
    if (typeof storedData === 'string') {
      return {
        hardware: {
          screenResolution: 'unknown',
          screenColorDepth: 'unknown',
          availableScreenSize: 'unknown',
          timezone: 'UTC',
          timezoneOffset: 0,
          language: 'unknown',
          languages: [],
          platform: 'unknown',
          hardwareConcurrency: 0,
          deviceMemory: 0,
          maxTouchPoints: 0
        },
        browser: {
          userAgent: 'unknown',
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
          plugins: [],
          mimeTypes: []
        },
        rendering: {
          canvasFingerprint: '',
          webGLVendor: 'unknown',
          webGLRenderer: 'unknown',
          webGLVersion: 'unknown',
          webGLShadingLanguageVersion: 'unknown',
          webGLExtensions: [],
          audioFingerprint: '44100',
          fontFingerprint: 'Arial,Helvetica,Times,Courier,Verdana,Georgia'
        },
        network: {
          connection: {
            effectiveType: 'unknown',
            saveData: false
          },
          webRTCIPs: [],
          dnsOverHttps: false
        },
        behavioral: {
          mouseMovementPattern: '[]',
          keyboardPattern: '[]',
          interactionTiming: [],
          focusEvents: 0
        }
      };
    }

    return {
      hardware: {
        screenResolution: storedData.screenWidth && storedData.screenHeight ? 
          `${storedData.screenWidth}x${storedData.screenHeight}` : '0x0',
        screenColorDepth: storedData.colorDepth?.toString() || '24',
        availableScreenSize: 'unknown',
        timezone: storedData.timezone || 'UTC',
        timezoneOffset: 0,
        language: storedData.language || 'en',
        languages: [],
        platform: storedData.platform || 'unknown',
        hardwareConcurrency: storedData.hardwareConcurrency || 4,
        deviceMemory: storedData.deviceMemory || 8,
        maxTouchPoints: 0
      },
      browser: {
        userAgent: storedData.userAgent || 'unknown',
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
        plugins: storedData.plugins || [],
        mimeTypes: []
      },
      rendering: {
        canvasFingerprint: storedData.canvasFingerprint || '',
        webGLVendor: 'unknown',
        webGLRenderer: 'unknown',
        webGLVersion: 'unknown',
        webGLShadingLanguageVersion: 'unknown',
        webGLExtensions: [],
        audioFingerprint: '44100',
        fontFingerprint: 'Arial,Helvetica,Times,Courier,Verdana,Georgia'
      },
      network: {
        connection: {
          effectiveType: '4g',
          saveData: false
        },
        webRTCIPs: [],
        dnsOverHttps: false
      },
      behavioral: {
        mouseMovementPattern: '[]',
        keyboardPattern: '[]',
        interactionTiming: [],
        focusEvents: 0
      }
    };
  }

  /**
   * Detect automation patterns in behavioral data
   */
  public detectAutomation(behavioralData: any): {
    isAutomated: boolean;
    confidence: number;
    indicators: string[];
  } {
    const indicators: string[] = [];
    let automationScore = 0;

    if (!behavioralData) {
      return {
        isAutomated: false,
        confidence: 0,
        indicators: ['No behavioral data available']
      };
    }

    // Check for perfect timing patterns
    if (behavioralData.interactionTiming && behavioralData.interactionTiming.length > 3) {
      const timings = behavioralData.interactionTiming;
      const variance = this.calculateVariance(timings);
      
      if (variance < 50) {
        indicators.push('Perfect timing patterns detected');
        automationScore += 0.4;
      }
    }

    // Check for robotic mouse movements
    if (behavioralData.mouseMovementPattern) {
      if (behavioralData.mouseMovementPattern.includes('linear') || 
          behavioralData.mouseMovementPattern.includes('perfect')) {
        indicators.push('Robotic mouse movement patterns');
        automationScore += 0.3;
      }
    }

    // Check for automated keyboard patterns
    if (behavioralData.keyboardPattern) {
      if (behavioralData.keyboardPattern.includes('rapid') ||
          behavioralData.keyboardPattern.includes('consistent')) {
        indicators.push('Automated keyboard patterns');
        automationScore += 0.3;
      }
    }

    // Check for impossible human speeds
    if (behavioralData.actionSpeed && behavioralData.actionSpeed < 100) {
      indicators.push('Impossibly fast human actions');
      automationScore += 0.5;
    }

    return {
      isAutomated: automationScore >= 0.6,
      confidence: Math.min(automationScore, 1.0),
      indicators
    };
  }

  /**
   * Create a device identifier string from hardware data
   */
  private createDeviceIdentifier(hardware: HardwareFingerprint): string {
    if (!hardware) return 'no-hardware-data';
    
    try {
      // Create a consistent device identifier from key hardware characteristics
      const identifierParts = [
        hardware.screenResolution || 'unknown-resolution',
        hardware.platform || 'unknown-platform',
        hardware.hardwareConcurrency?.toString() || '0',
        hardware.deviceMemory?.toString() || '0',
        hardware.timezone || 'unknown-timezone'
      ];
      
      const identifierString = identifierParts.join('|');
      
      // Hash the identifier for consistency
      return crypto
        .createHash('sha256')
        .update(identifierString)
        .digest('hex')
        .substring(0, 32);
    } catch (error) {
      this.logger.error('Error creating device identifier:', error);
      return 'device-identifier-error-' + Date.now();
    }
  }

  /**
   * Calculate variance in an array of numbers
   */
  private calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    
    const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / numbers.length;
  }

  /**
   * Analyze device changes for suspicious patterns
   */
  public async analyzeDeviceChanges(storedFingerprint: any, currentData: any): Promise<{
    suspicious: boolean;
    changes: string[];
    riskScore: number;
  }> {
    const changes: string[] = [];
    let riskScore = 0;

    // Compare key device characteristics
    if (storedFingerprint.components?.hardware?.screenResolution !== currentData.screenResolution) {
      changes.push('Screen resolution changed');
      riskScore += 0.3;
    }

    if (storedFingerprint.components?.hardware?.platform !== currentData.platform) {
      changes.push('Platform changed');
      riskScore += 0.4;
    }

    if (storedFingerprint.components?.browser?.userAgent !== currentData.userAgent) {
      changes.push('User agent changed');
      riskScore += 0.2;
    }

    return {
      suspicious: riskScore > 0.5,
      changes,
      riskScore
    };
  }
}