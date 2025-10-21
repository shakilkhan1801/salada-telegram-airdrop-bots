import { uuidv4 } from './uuid';
import crypto from 'crypto';
import { Logger } from './logger';
import { StorageManager } from '../storage';
import { DeviceFingerprintService } from '../security/device-fingerprint.service';
import { ThreatAnalyzer } from '../security/threat-analyzer.service';
import { SecurityManager } from '../security';
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import {
  CaptchaSession,
  CaptchaChallenge,
  CaptchaType,
  CaptchaVerificationResult,
  CaptchaConfig,
  CaptchaQualityMetrics,
  CaptchaStats,
  CaptchaSessionMetadata
} from '../types/captcha.types';
import { DeviceFingerprint } from '../types/security.types';

// Extend metadata locally to allow additional fields used in this service
type ExtendedCaptchaSessionMetadata = CaptchaSessionMetadata & {
  riskAssessment?: any;
  adaptiveSettings?: any;
  geoRiskScore?: number;
};

export class CaptchaService {
  private static instance: CaptchaService;
  private logger: Logger;
  private storage: StorageManager;
  private fingerprintService: DeviceFingerprintService;
  private threatAnalyzer: ThreatAnalyzer;
  private config: CaptchaConfig;

  private static maxRenderConcurrency = Number(process.env.CAPTCHA_RENDER_MAX_CONCURRENCY || '64');
  private static currentRenders = 0;
  private static waitQueue: Array<() => void> = [];

  private static async acquireRenderSlot(): Promise<() => void> {
    if (this.currentRenders < this.maxRenderConcurrency) {
      this.currentRenders++;
      return () => {
        this.currentRenders--;
        const next = this.waitQueue.shift();
        if (next) next();
      };
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.currentRenders++;
    return () => {
      this.currentRenders--;
      const next = this.waitQueue.shift();
      if (next) next();
    };
  }

  private constructor() {
    this.logger = Logger.getInstance();
    this.storage = StorageManager.getInstance();
    this.fingerprintService = new DeviceFingerprintService();
    this.threatAnalyzer = new ThreatAnalyzer();
    this.config = this.getDefaultConfig();
  }

  public static getInstance(): CaptchaService {
    if (!CaptchaService.instance) {
      CaptchaService.instance = new CaptchaService();
    }
    return CaptchaService.instance;
  }

  /**
   * Create a new captcha session with enhanced security checks
   */
  public async createSession(userId: string, type: CaptchaType = 'svg', deviceInfo?: any): Promise<CaptchaSession> {
    const sessionId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTimeout);

    // Enhanced security checks
    await this.performPreSessionSecurityChecks(userId, deviceInfo);

    // Generate comprehensive device fingerprint only for miniapp captcha
    let deviceFingerprint: string | undefined;
    let botDetectionScore = 0;
    let geoRiskScore = 0;
    
    // Only use fingerprint for miniapp captcha (miniapp type)
    if (deviceInfo && type === 'miniapp') {
      try {
        // Create enhanced device data structure
        const enhancedDeviceData = {
          hardware: deviceInfo.hardware || {
            screenResolution: deviceInfo.screen || 'unknown',
            platform: deviceInfo.platform || 'unknown',
            hardwareConcurrency: deviceInfo.hardwareConcurrency || 4,
            deviceMemory: deviceInfo.deviceMemory || 4,
            timezone: deviceInfo.timezone || 'UTC',
            language: deviceInfo.language || 'en'
          },
          browser: deviceInfo.browser || {
            userAgent: deviceInfo.userAgent || 'unknown',
            vendor: 'unknown',
            product: 'unknown',
            cookieEnabled: true,
            plugins: [],
            mimeTypes: []
          },
          rendering: deviceInfo.rendering || {
            canvasFingerprint: null,
            webGLRenderer: null,
            webGLVendor: null
          },
          network: deviceInfo.network || {
            connection: null,
            webRTCIPs: []
          },
          behavioral: deviceInfo.behavioral || {},
          location: deviceInfo.location,
          sessionData: {
            sessionId,
            timestamp: Date.now(),
            userAgent: deviceInfo.userAgent || 'unknown',
            referrer: '',
            url: ''
          }
        };
        
        const fingerprintResult = await this.fingerprintService.generateFingerprint(
          enhancedDeviceData,
          userId
        );
        deviceFingerprint = fingerprintResult.hash;
        botDetectionScore = fingerprintResult.riskScore;
      } catch (fingerprintError) {
        this.logger.error('Error generating device fingerprint:', fingerprintError);
        // Continue without fingerprint
        deviceFingerprint = undefined;
        botDetectionScore = 0.5; // Medium risk as fallback
      }
      
      // Check for geo-blocking
      geoRiskScore = await this.calculateGeoRisk(deviceInfo.ip);
      if (geoRiskScore >= 0.9) {
        throw new Error('Access denied from your location');
      }
    }

    // Enhanced multi-account detection ONLY for miniapp captcha (type === 'miniapp') when device data is available
    const user = await this.storage.getUser(userId);
    if (user && deviceInfo && (user.enhancedDeviceData || user.fingerprint || deviceFingerprint) && type === 'miniapp') {
      // If we don't have a fingerprint from current session, use stored device data
      const fingerprintToUse = deviceFingerprint || 
                               this.generateFingerprintFromDeviceData(user.enhancedDeviceData) ||
                               this.generateFingerprintFromDeviceData(user.fingerprint);
      await this.performMultiAccountCheck(user, fingerprintToUse, deviceInfo?.ip || user.ipAddress);
    }

    // Perform comprehensive threat analysis
    const threatAnalysis = user ? await this.threatAnalyzer.analyzeUser(user) : null;

    // Determine challenge type and difficulty based on comprehensive risk assessment
    const riskAssessment = this.calculateRiskAssessment(botDetectionScore, geoRiskScore, threatAnalysis?.overallRiskScore || 0);
    const adaptiveType = this.determineAdaptiveType(type, riskAssessment);
    const difficulty = this.determineDifficulty(riskAssessment.overallRisk);
    const challenge = await this.generateChallenge(adaptiveType, difficulty);

    // Create session metadata
    const metadata: ExtendedCaptchaSessionMetadata = {
      challengeGenerated: true,
      deviceVerified: !!deviceFingerprint,
      botDetectionScore,
      suspiciousPatterns: threatAnalysis?.riskFactors.map(r => r.type) || [],
      geoLocation: deviceInfo?.geo?.country,
      browserFingerprint: deviceInfo?.browser?.fingerprint,
      verificationMethod: 'automatic',
      qualityScore: 0.5, // Initial quality score
      customData: {
        userAgent: deviceInfo?.userAgent,
        screenResolution: deviceInfo?.screen,
        timezone: deviceInfo?.timezone
      }
    };

    const session: CaptchaSession = {
      id: sessionId,
      userId,
      type: adaptiveType,
      challenge,
      answer: challenge.answer || this.generateAnswer(challenge),
      attempts: 0,
      maxAttempts: this.getAdaptiveMaxAttempts(riskAssessment.overallRisk),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      deviceFingerprint,
      ipAddress: deviceInfo?.ip,
      metadata: {
        ...(metadata as any),
        riskAssessment,
        geoRiskScore,
        adaptiveSettings: {
          originalType: type,
          adaptedType: adaptiveType,
          difficultyReason: this.getDifficultyReason(riskAssessment),
          securityLevel: this.getSecurityLevel(riskAssessment.overallRisk)
        }
      } as any
    };

    await this.storage.saveCaptchaSession(session);
    
    this.logger.info('Captcha session created', {
      sessionId,
      userId,
      type,
      difficulty,
      botDetectionScore
    });

    return session;
  }

  /**
   * Verify captcha answer with enhanced security validation
   */
  public async verifyCaptcha(
    sessionId: string,
    answer: string,
    deviceInfo?: any,
    timeTaken?: number
  ): Promise<CaptchaVerificationResult> {
    try {
      // Special handling for miniapp verification that's already been completed
      if (sessionId === 'miniapp-session' || answer === 'verified') {
        return this.handleMiniappVerification(sessionId, deviceInfo, timeTaken);
      }
      
      const session = await this.storage.getCaptchaSession(sessionId);
      
      // Check if we're in optimization mode (fake session with answer 'fake')
      if (session && session.answer === 'fake') {
        // Return successful verification for optimization mode
        return {
          success: true,
          sessionId: sessionId,
          userId: deviceInfo?.userId || '0',
          timestamp: new Date().toISOString(),
          metadata: {
            timeTaken: timeTaken || 1000,
            deviceTrusted: true,
            answerCorrect: true,
            qualityMetrics: {
              overall: 1.0,
              speed: 1.0,
              accuracy: 1.0,
              consistency: 1.0
            }
          }
        } as any;
      }
      
      if (!session) {
        throw new Error('Captcha session not found');
      }

      if (new Date() > new Date(session.expiresAt)) {
        throw new Error('Captcha session expired');
      }

      if (session.attempts >= session.maxAttempts) {
        throw new Error('Maximum attempts exceeded');
      }

      const startTime = Date.now();
    
    // Update attempts
    session.attempts++;

    // Verify device consistency ONLY for miniapp captcha (type === 'miniapp')
    let deviceConsistency = 1.0;
    if (session.type === 'miniapp' && session.deviceFingerprint && deviceInfo) {
      try {
        // Create enhanced device data structure for comparison
        const enhancedDeviceData = {
          hardware: deviceInfo.hardware || {
            screenResolution: deviceInfo.screen || 'unknown',
            platform: deviceInfo.platform || 'unknown',
            hardwareConcurrency: deviceInfo.hardwareConcurrency || 4,
            deviceMemory: deviceInfo.deviceMemory || 4,
            timezone: deviceInfo.timezone || 'UTC',
            language: deviceInfo.language || 'en'
          },
          browser: deviceInfo.browser || {
            userAgent: deviceInfo.userAgent || 'unknown',
            vendor: 'unknown',
            product: 'unknown',
            cookieEnabled: true,
            plugins: [],
            mimeTypes: []
          },
          rendering: deviceInfo.rendering || {
            canvasFingerprint: null,
            webGLRenderer: null,
            webGLVendor: null
          },
          network: deviceInfo.network || {
            connection: null,
            webRTCIPs: []
          },
          behavioral: deviceInfo.behavioral || {},
          location: deviceInfo.location,
          sessionData: {
            sessionId: session.id,
            timestamp: Date.now(),
            userAgent: deviceInfo.userAgent || 'unknown',
            referrer: '',
            url: ''
          }
        };
        
        const currentFingerprint = await this.fingerprintService.generateFingerprint(
          enhancedDeviceData,
          session.userId
        );
        
        deviceConsistency = this.fingerprintService.compareFingerprints(
          { hash: session.deviceFingerprint } as any,
          currentFingerprint
        );
      } catch (fingerprintError) {
        this.logger.error('Fingerprint comparison error:', fingerprintError);
        // Default to medium consistency score if fingerprint fails
        deviceConsistency = 0.5;
      }
    }

    // Verify answer
    const answerCorrect = this.verifyAnswer(session.challenge, answer, session.answer);
    
    // Calculate quality metrics
    const qualityMetrics = await this.calculateQualityMetrics(
      session,
      deviceInfo,
      timeTaken || 0,
      deviceConsistency
    );

    // Detect suspicious activity
    const suspiciousActivity = await this.detectSuspiciousActivity(
      session,
      qualityMetrics,
      timeTaken || 0
    );

    // Debug logging
    this.logger.info('Captcha verification debug', {
      sessionId,
      userAnswer: answer,
      correctAnswer: session.answer,
      answerCorrect,
      qualityScore: qualityMetrics.overall,
      deviceConsistency,
      suspiciousActivity,
      challengeType: session.challenge.type
    });

    // Enhanced verification with adaptive thresholds based on risk
    const riskLevel = session.metadata.riskAssessment?.riskLevel || 'low';
    const requiredQuality = this.getRequiredQuality(riskLevel);
    const requiredConsistency = this.getRequiredConsistency(riskLevel);
    
    // Additional security checks for high-risk users
    let additionalSecurityPassed = true;
    if (riskLevel === 'high' || riskLevel === 'critical') {
      additionalSecurityPassed = await this.performAdditionalSecurityChecks(session, deviceInfo, timeTaken || 0);
    }
    
    const success = answerCorrect && 
                   qualityMetrics.overall >= requiredQuality &&
                   !suspiciousActivity &&
                   deviceConsistency >= requiredConsistency &&
                   additionalSecurityPassed;

    const result: CaptchaVerificationResult = {
      sessionId,
      userId: session.userId,
      success,
      attempts: session.attempts,
      timeTaken: timeTaken || (Date.now() - startTime),
      confidence: qualityMetrics.overall,
      deviceFingerprint: session.deviceFingerprint || '',
      qualityMetrics,
      suspiciousActivity,
      timestamp: new Date().toISOString()
    };

    // Update session
    if (success) {
      session.completedAt = new Date().toISOString();
      session.metadata.qualityScore = qualityMetrics.overall;
    }

    await this.storage.saveCaptchaSession(session);
    await this.storage.saveCaptchaResult(session.userId, result);
    
    // Enhanced post-verification processing
    await this.postVerificationProcessing(session, result, deviceInfo);

      this.logger.info('Captcha verification completed', {
        sessionId,
        userId: session.userId,
        success,
        attempts: session.attempts,
        confidence: qualityMetrics.overall,
        suspiciousActivity
      });

      return result;
    } catch (error) {
      this.logger.error('Captcha verification error:', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Return a failed result with error context
      const failedResult: CaptchaVerificationResult = {
        sessionId,
        userId: deviceInfo?.userId || 'unknown',
        success: false,
        attempts: 1,
        timeTaken: timeTaken || 0,
        confidence: 0,
        deviceFingerprint: '',
        qualityMetrics: {
          fingerprintQuality: 0,
          deviceConsistency: 0,
          behavioralScore: 0,
          timingAnalysis: 0,
          interactionPattern: 0,
          overall: 0
        },
        suspiciousActivity: true,
        timestamp: new Date().toISOString()
      };

      // Still try to update the session if possible
      try {
        const session = await this.storage.getCaptchaSession(sessionId);
        if (session) {
          session.attempts = Math.min(session.attempts + 1, session.maxAttempts);
          await this.storage.saveCaptchaSession(session);
        }
      } catch (sessionUpdateError) {
        this.logger.error('Failed to update session after error:', sessionUpdateError);
      }

      throw error; // Re-throw the original error for upstream handling
    }
  }

  /**
   * Handle miniapp verification (pre-verified from client)
   */
  private async handleMiniappVerification(
    sessionId: string,
    deviceInfo?: any,
    timeTaken?: number
  ): Promise<CaptchaVerificationResult> {
    const userId = deviceInfo?.userId || 'unknown';
    
    // SECURITY: Check for device collision/multi-account before verification
    let deviceCollisionDetected = false;
    let collisionRiskLevel = 'low';
    
    if (deviceInfo && deviceInfo.deviceFingerprint) {
      try {
        // Check if this device is already used by other accounts
        const deviceFingerprint: DeviceFingerprint = {
          hash: deviceInfo.deviceFingerprint,
          userId,
          components: deviceInfo.components || {
            hardware: deviceInfo.hardware || {},
            browser: deviceInfo.browser || {},
            rendering: deviceInfo.rendering || {},
            network: deviceInfo.network || {},
            behavioral: deviceInfo.behavioral || {}
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
          registeredAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
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
        
        const collision = await this.fingerprintService.checkDeviceCollision(
          deviceFingerprint,
          userId
        );
        
        if (collision.hasCollision && collision.collidingUsers.length > 0) {
          deviceCollisionDetected = true;
          collisionRiskLevel = collision.riskLevel;
          
          this.logger.warn('Multi-account detection triggered', {
            userId,
            deviceFingerprint: deviceInfo.deviceFingerprint.substring(0, 16) + '...',
            collidingUsers: collision.collidingUsers,
            riskLevel: collision.riskLevel,
            similarityScores: collision.similarityScores.slice(0, 3) // Top 3 similar devices
          });
          
          // STRICT: Block verification for ANY device collision detected - ZERO TOLERANCE
          if (collision.hasCollision && collision.collidingUsers.length > 0) {
            const failedResult: CaptchaVerificationResult = {
              sessionId: sessionId === 'miniapp-session' ? `miniapp-${Date.now()}` : sessionId,
              userId,
              success: false,
              attempts: 1,
              timeTaken: timeTaken || 0,
              confidence: 0,
              deviceFingerprint: deviceInfo?.deviceFingerprint || '',
              qualityMetrics: {
                fingerprintQuality: 0,
                timingAnalysis: 0,
                behavioralScore: 0,
                interactionPattern: 0,
                deviceConsistency: 0,
                overall: 0
              },
              suspiciousActivity: true,
              timestamp: new Date().toISOString()
            };
            
            // Block the user
            await this.storage.addUserBlock(userId, 'multi_account_detected', 24 * 60 * 60 * 1000); // 24 hour block
            await this.storage.updateUser(userId, { multiAccountDetected: true });
            
            this.logger.error('User blocked for multi-account abuse', {
              userId,
              collidingUsers: collision.collidingUsers,
              riskLevel: collision.riskLevel
            });
            
            return failedResult;
          }
        }
      } catch (collisionError) {
        this.logger.error('Device collision check failed:', collisionError);
        // Continue with verification but mark as suspicious
        deviceCollisionDetected = true;
        collisionRiskLevel = 'medium';
      }
    }
    
    // Adjust confidence based on collision risk
    let confidence = 0.95;
    if (deviceCollisionDetected) {
      confidence = collisionRiskLevel === 'medium' ? 0.6 : 0.4;
    }
    
    // Create verification result
    const result: CaptchaVerificationResult = {
      sessionId: sessionId === 'miniapp-session' ? `miniapp-${Date.now()}` : sessionId,
      userId,
      success: true,
      attempts: 1,
      timeTaken: timeTaken || 0,
      confidence,
      deviceFingerprint: deviceInfo?.deviceFingerprint || '',
      qualityMetrics: {
        fingerprintQuality: deviceCollisionDetected ? 0.5 : 0.9,
        timingAnalysis: 0.9,
        behavioralScore: deviceCollisionDetected ? 0.5 : 0.9,
        interactionPattern: 0.9,
        deviceConsistency: deviceCollisionDetected ? 0.4 : 1.0,
        overall: confidence
      },
      suspiciousActivity: deviceCollisionDetected,
      timestamp: new Date().toISOString()
    };
    
    // Save the result
    await this.storage.saveCaptchaResult(userId, result);
    
    // STRICT: Update user security flags for ANY device collision detected
    if (deviceCollisionDetected) {
      await this.storage.updateUser(userId, { 
        multiAccountDetected: true,
        isBlocked: true,
        blockedReason: 'Multi-account device collision detected',
        blockedAt: new Date().toISOString()
      });
      await this.storage.updateUserRiskScore(userId, 0.9); // Maximum risk score
      
      this.logger.error('User flagged for multi-account violation - STRICT DETECTION', {
        userId,
        collisionRiskLevel,
        action: 'user_blocked_and_flagged'
      });
    }
    
    this.logger.info('Miniapp verification completed', {
      sessionId: result.sessionId,
      userId,
      success: result.success,
      confidence: result.confidence,
      deviceCollisionDetected,
      collisionRiskLevel
    });
    
    return result;
  }

  /**
   * Generate captcha challenge
   */
  private async generateChallenge(type: CaptchaType, difficulty: 'easy' | 'medium' | 'hard'): Promise<CaptchaChallenge & { answer?: string }> {
    const difficultyConfig = this.config.difficultyLevels[difficulty];

    switch (type) {
      case 'miniapp':
        return this.generateMiniappChallenge(difficultyConfig);
      
      case 'svg':
        return this.generateSvgChallenge(difficultyConfig);
      
      default:
        return this.generateSvgChallenge(difficultyConfig);
    }
  }

  /**
   * Generate MiniApp challenge (CloudFlare-style verification)
   */
  private generateMiniAppChallenge(config: any): CaptchaChallenge & { answer: string } {
    return {
      type: 'miniapp',
      difficulty: 'easy',
      question: 'Verifying you are human. This may take a few seconds.',
      instructions: 'Please wait while we verify your connection security.',
      expectedFormat: 'cloudflare-verification',
      hints: ['This is an automated security check', 'Please be patient during verification'],
      answer: 'cloudflare-verified'
    };
  }



  /**
   * Generate miniapp challenge
   */
  private generateMiniappChallenge(config: any): CaptchaChallenge & { answer: string } {
    const imageTypes = ['cars', 'traffic_lights', 'bicycles', 'crosswalks', 'buses', 'fire_hydrants'];
    const selectedType = imageTypes[Math.floor(Math.random() * imageTypes.length)];
    
    return {
      type: 'miniapp',
      difficulty: config.imageDistortion > 5 ? 'hard' : config.imageDistortion > 2 ? 'medium' : 'easy',
      question: `Select all images containing ${selectedType.replace('_', ' ')}`,
      instructions: 'Click on every square that contains the specified object',
      imageUrl: `/api/captcha/images/${selectedType}`,
      expectedFormat: 'grid-selection',
      hints: ['Look carefully at each square', 'Some objects might be partially visible'],
      answer: `miniapp-${selectedType}`
    };
  }

  /**
   * Generate SVG challenge
   */
  private generateSvgChallenge(config: any): CaptchaChallenge & { answer: string } {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = config.characterCount || 5;
    let text = '';
    
    for (let i = 0; i < length; i++) {
      text += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    // Generate SVG with distortion
    const svgContent = this.generateDistortedSvg(text, config.imageDistortion || 0);

    return {
      type: 'svg',
      difficulty: config.imageDistortion > 5 ? 'hard' : config.imageDistortion > 2 ? 'medium' : 'easy',
      question: 'Enter the text shown in the image',
      instructions: 'Type the letters and numbers you see',
      svgContent,
      expectedFormat: 'text',
      hints: ['Letters and numbers only', 'Case doesn\'t matter'],
      answer: text.toUpperCase()
    };
  }

  /**
   * Generate distorted SVG
   */
  private generateDistortedSvg(text: string, distortion: number): string {
    const width = text.length * 30 + 40;
    const height = 60;
    
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<defs><filter id="noise"><feTurbulence baseFrequency="${distortion * 0.02}"/></filter></defs>`;
    svg += `<rect width="100%" height="100%" fill="#f0f0f0" filter="url(#noise)"/>`;
    
    for (let i = 0; i < text.length; i++) {
      const x = 20 + i * 30 + (Math.random() - 0.5) * distortion;
      const y = 35 + (Math.random() - 0.5) * distortion;
      const rotation = (Math.random() - 0.5) * distortion * 2;
      
      svg += `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" `;
      svg += `font-family="monospace" font-size="24" fill="#333">${text[i]}</text>`;
    }
    
    // Add noise lines
    for (let i = 0; i < distortion; i++) {
      const x1 = Math.random() * width;
      const y1 = Math.random() * height;
      const x2 = Math.random() * width;
      const y2 = Math.random() * height;
      
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#999" stroke-width="1"/>`;
    }
    
    svg += '</svg>';
    return svg;
  }

  /**
   * Generate captcha image buffer (generate → send → forget pattern)
   * No storage, no processing - just create buffer for immediate use
   */
  public async generateCaptchaImageBuffer(text: string): Promise<Buffer> {
    const release = await CaptchaService.acquireRenderSlot();
    try {
    const width = text.length * 50 + 80;
    const height = 80;
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Background with gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f8f9fa');
    gradient.addColorStop(0.5, '#e9ecef');
    gradient.addColorStop(1, '#dee2e6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Add noise dots
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, 0.1)`;
      ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
    }
    
    // Add noise lines
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, 0.2)`;
      ctx.lineWidth = Math.random() * 2 + 1;
      ctx.beginPath();
      ctx.moveTo(Math.random() * width, Math.random() * height);
      ctx.lineTo(Math.random() * width, Math.random() * height);
      ctx.stroke();
    }
    
    // Draw text with distortion
    ctx.font = '36px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const colors = ['#2c3e50', '#34495e', '#7f8c8d', '#16a085', '#27ae60', '#e74c3c', '#8e44ad', '#f39c12'];
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const x = 40 + i * 50 + (Math.random() - 0.5) * 20;
      const y = height / 2 + (Math.random() - 0.5) * 20;
      const rotation = (Math.random() - 0.5) * 0.8;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.fillText(char, 0, 0);
      ctx.restore();
      
      // Add shadow/outline for better visibility
      ctx.save();
      ctx.translate(x + 1, y + 1);
      ctx.rotate(rotation);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillText(char, 0, 0);
      ctx.restore();
    }
    
    // Return buffer immediately - no storage needed
    const buffer = canvas.toBuffer('image/png');
    
    this.logger.info('Captcha image buffer generated (generate→send→forget)', {
      textLength: text.length,
      bufferSize: buffer.length,
      pattern: 'generate→send→forget'
    });
    
    return buffer;
  } finally { release(); }
}

  /**
   * @deprecated Legacy method - use generateCaptchaImageBuffer instead
   */
  public async generatePngCaptchaBuffer(text: string, sessionId: string): Promise<Buffer> {
    this.logger.warn('Using deprecated generatePngCaptchaBuffer. Use generateCaptchaImageBuffer instead.');
    return await this.generateCaptchaImageBuffer(text);
  }

  /**
   * @deprecated Legacy method - use generateCaptchaImageBuffer instead
   */
  public async generateCaptchaImage(text: string, sessionId: string): Promise<Buffer> {
    this.logger.warn('Using deprecated generateCaptchaImage. Use generateCaptchaImageBuffer instead.');
    return await this.generateCaptchaImageBuffer(text);
  }

  /**
   * @deprecated No cleanup needed with generate→send→forget pattern
   */
  public getCaptchaImagePath(sessionId: string): string {
    this.logger.warn('getCaptchaImagePath is deprecated. No file paths needed with generate→send→forget pattern.');
    return '';
  }

     /**
      * @deprecated No cleanup needed with generate→send→forget pattern
      */
     public cleanupCaptchaImage(sessionId: string): void {
       // No cleanup needed - we don't store anything
       // Telegram handles the image storage
       this.logger.debug('Cleanup called but not needed (generate→send→forget pattern)', { sessionId });
     }
   
     /**
      * Generate miniapp captcha URL for Telegram web app interface
      */
     public async generateMiniappCaptchaUrl(userId: string): Promise<string> {
       try {
         // Get configuration for miniapp URL
         const config = this.getDefaultConfig();
         
         // In production, this would be your actual miniapp captcha URL
         // For now, we'll use a placeholder URL that includes the user ID
         const baseUrl = process.env.MINIAPP_CAPTCHA_URL || 'https://your-miniapp-domain.com';
         const captchaPath = '/captcha';
         
         // Create session parameter for the miniapp
         const sessionParam = `userId=${encodeURIComponent(userId)}&timestamp=${Date.now()}`;
         
         // Generate the full URL
         const miniappUrl = `${baseUrl}${captchaPath}?${sessionParam}`;
         
         this.logger.info('Generated miniapp captcha URL', {
           userId,
           url: miniappUrl.substring(0, 50) + '...'
         });
         
         return miniappUrl;
       } catch (error) {
         this.logger.error('Error generating miniapp captcha URL:', error);
         // Return a fallback URL
         return `https://telegram.org?userId=${encodeURIComponent(userId)}`;
       }
     }

  /**
   * Verify answer
   */
  private verifyAnswer(challenge: CaptchaChallenge, userAnswer: string, correctAnswer: string): boolean {
    switch (challenge.type) {
      case 'svg':
        return userAnswer.toUpperCase().trim() === correctAnswer.toUpperCase();
      
      // miniapp case removed
      
      case 'miniapp':
        return userAnswer.includes(correctAnswer.split('-')[1]);
      
      default:
        return userAnswer === correctAnswer;
    }
  }

  /**
   * Generate answer for challenge
   */
  private generateAnswer(challenge: CaptchaChallenge): string {
    // This is used for challenges that don't have pre-generated answers
    switch (challenge.type) {
      // miniapp case removed
      default:
        return 'generated-answer';
    }
  }

  /**
   * Calculate quality metrics
   */
  private async calculateQualityMetrics(
    session: CaptchaSession,
    deviceInfo: any,
    timeTaken: number,
    deviceConsistency: number
  ): Promise<CaptchaQualityMetrics> {
    // Fingerprint quality (0-1)
    const fingerprintQuality = session.deviceFingerprint ? 0.9 : 0.1;
    
    // Timing analysis (0-1)
    const expectedTime = this.getExpectedCompletionTime(session.challenge.type, session.challenge.difficulty);
    let timingScore = 0.5; // Default score
    if (expectedTime > 0 && timeTaken > 0) {
      timingScore = Math.max(0, Math.min(1, 1 - Math.abs(timeTaken - expectedTime) / expectedTime));
    }
    
    // Behavioral score based on device info and interaction patterns
    const behavioralScore = this.calculateBehavioralScore(deviceInfo, session) || 0.5;
    
    // Interaction pattern score
    const interactionPattern = this.calculateInteractionPattern(session, timeTaken) || 0.5;
    
    // Ensure all values are valid numbers
    const safeDeviceConsistency = isNaN(deviceConsistency) ? 1.0 : deviceConsistency;
    
    // Overall quality score
    const overall = (
      fingerprintQuality * 0.25 +
      safeDeviceConsistency * 0.25 +
      behavioralScore * 0.2 +
      timingScore * 0.15 +
      interactionPattern * 0.15
    );

    // Debug logging
    this.logger.debug('Quality metrics calculation', {
      fingerprintQuality,
      deviceConsistency: safeDeviceConsistency,
      behavioralScore,
      timingScore,
      interactionPattern,
      overall,
      timeTaken,
      expectedTime
    });

    return {
      fingerprintQuality,
      deviceConsistency: safeDeviceConsistency,
      behavioralScore,
      timingAnalysis: timingScore,
      interactionPattern,
      overall: isNaN(overall) ? 0.5 : overall
    };
  }

  /**
   * Calculate behavioral score
   */
  private calculateBehavioralScore(deviceInfo: any, session: CaptchaSession): number {
    let score = 0.5; // Base score
    
    if (deviceInfo) {
      // Natural screen resolution
      if (deviceInfo.screen && deviceInfo.screen.width > 800 && deviceInfo.screen.height > 600) {
        score += 0.1;
      }
      
      // Reasonable timezone
      if (deviceInfo.timezone && Math.abs(deviceInfo.timezone) <= 12) {
        score += 0.1;
      }
      
      // Browser features
      if (deviceInfo.browser && deviceInfo.browser.cookiesEnabled) {
        score += 0.1;
      }
      
      // Touch capabilities on mobile
      if (deviceInfo.touch && deviceInfo.isMobile) {
        score += 0.1;
      }
    }
    
    // Bot detection score penalty
    score -= session.metadata.botDetectionScore * 0.3;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate interaction pattern score
   */
  private calculateInteractionPattern(session: CaptchaSession, timeTaken: number): number {
    let score = 0.7; // Base score
    
    // Penalize too fast completion (likely bot)
    if (timeTaken < 1000) {
      score -= 0.4;
    } else if (timeTaken < 3000) {
      score -= 0.2;
    }
    
    // Penalize too slow completion (confused user or bot)
    if (timeTaken > 120000) {
      score -= 0.3;
    } else if (timeTaken > 60000) {
      score -= 0.1;
    }
    
    // Multiple attempts penalty
    if (session.attempts > 1) {
      score -= 0.1 * (session.attempts - 1);
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Detect suspicious activity
   */
  private async detectSuspiciousActivity(
    session: CaptchaSession,
    qualityMetrics: CaptchaQualityMetrics,
    timeTaken: number
  ): Promise<boolean> {
    const suspiciousPatterns = [];
    
    // Very fast completion
    if (timeTaken < 500) {
      suspiciousPatterns.push('extremely_fast_completion');
    }
    
    // Perfect scores (unlikely for humans)
    if (qualityMetrics.overall > 0.98) {
      suspiciousPatterns.push('perfect_score');
    }
    
    // Low device consistency
    if (qualityMetrics.deviceConsistency < 0.5) {
      suspiciousPatterns.push('device_inconsistency');
    }
    
    // High bot detection score
    if (session.metadata.botDetectionScore > 0.8) {
      suspiciousPatterns.push('high_bot_likelihood');
    }
    
    // Suspicious patterns in metadata
    if (session.metadata.suspiciousPatterns.length > 2) {
      suspiciousPatterns.push('multiple_threat_indicators');
    }
    
    return suspiciousPatterns.length >= 2;
  }

  /**
   * Get expected completion time
   */
  private getExpectedCompletionTime(type: CaptchaType, difficulty: 'easy' | 'medium' | 'hard'): number {
    const baseTimes = {
      miniapp: { easy: 10000, medium: 18000, hard: 30000 },
      svg: { easy: 8000, medium: 15000, hard: 25000 }
    };
    
    return baseTimes[type]?.[difficulty] || 15000;
  }

  /**
   * Generate device fingerprint from stored enhanced device data
   */
  private generateFingerprintFromDeviceData(enhancedDeviceData: any): string {
    if (!enhancedDeviceData) return 'no-fingerprint';
    
    try {
      const crypto = require('crypto');
      
      // Create a consistent fingerprint from key device characteristics
      const fingerprint = {
        hardware: {
          screenResolution: enhancedDeviceData.hardware?.screenResolution,
          platform: enhancedDeviceData.hardware?.platform,
          hardwareConcurrency: enhancedDeviceData.hardware?.hardwareConcurrency,
          deviceMemory: enhancedDeviceData.hardware?.deviceMemory,
          timezone: enhancedDeviceData.hardware?.timezone,
          language: enhancedDeviceData.hardware?.language
        },
        browser: {
          userAgent: enhancedDeviceData.browser?.userAgent,
          vendor: enhancedDeviceData.browser?.vendor,
          product: enhancedDeviceData.browser?.product
        },
        rendering: {
          canvasFingerprint: enhancedDeviceData.rendering?.canvasFingerprint,
          webGLVendor: enhancedDeviceData.rendering?.webGLVendor,
          webGLRenderer: enhancedDeviceData.rendering?.webGLRenderer
        }
      };
      
      return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
    } catch (error) {
      this.logger.error('Error generating fingerprint from device data:', error);
      return 'fingerprint-error-' + Date.now();
    }
  }

  /**
   * Perform multi-account detection using StrictMultiAccountDetector
   */
  private async performMultiAccountCheck(user: any, deviceFingerprint?: string, ipAddress?: string): Promise<void> {
    if (!deviceFingerprint || !ipAddress || !user.enhancedDeviceData) return;
    
    // Always use our enhanced multi-account detection with direct implementation
    const detectionResult = await this.performAdvancedMultiAccountDetection(user, deviceFingerprint, ipAddress);
    
    if (detectionResult.hasCollision) {
      this.logger.error('CRITICAL: Multi-account collision detected', {
        userId: user.telegramId,
        collisions: detectionResult.collisions.length,
        allowedUser: detectionResult.allowedUserId,
        bannedUsers: detectionResult.bannedUserIds,
        shouldBan: detectionResult.shouldBan
      });
      
      // Store critical security incident
      await this.storage.saveSecurityIncident({
        type: 'strict_multi_account_collision',
        userId: user.telegramId,
        severity: 'critical',
        details: {
          deviceFingerprint,
          collisions: detectionResult.collisions,
          banReason: detectionResult.banReason,
          allowedUser: detectionResult.allowedUserId,
          bannedUsers: detectionResult.bannedUserIds,
          ipAddress
        },
        timestamp: new Date().toISOString()
      });
      
      // Execute automatic banning for violating accounts
      if (detectionResult.shouldBan && detectionResult.bannedUserIds.includes(user.telegramId)) {
        // Update user status to banned
        await this.banUser(user.telegramId, detectionResult.banReason, detectionResult.collisions);
        
        throw new Error(`ACCOUNT PERMANENTLY BANNED: ${detectionResult.banReason}. This device is already registered to account ${detectionResult.allowedUserId}.`);
      } else if (detectionResult.hasCollision) {
        throw new Error(`Device collision detected. This device is already associated with another account. Contact support if this is an error.`);
      }
    }
  }
  
  /**
   * Basic multi-account detection (fallback method)
   */
  private async performBasicMultiAccountCheck(user: any, deviceFingerprint: string, ipAddress: string): Promise<void> {
    // Check for existing sessions from same device
    const recentSessions = await this.storage.getRecentCaptchaSessions(24 * 60 * 60 * 1000); // 24 hours
    const sameDeviceSessions = recentSessions.filter(s => 
      s.deviceFingerprint === deviceFingerprint && 
      s.userId !== user.telegramId
    );

    if (sameDeviceSessions.length >= 1) { // More strict: even 1 match is suspicious
      this.logger.warn('Multi-account attempt detected (basic)', {
        userId: user.telegramId,
        deviceFingerprint: deviceFingerprint.substring(0, 8),
        sameDeviceAccounts: sameDeviceSessions.length,
        ipAddress
      });
      
      // Store security incident
      await this.storage.saveSecurityIncident({
        type: 'multi_account_device',
        userId: user.telegramId,
        severity: 'high',
        details: {
          deviceFingerprint,
          suspiciousAccounts: sameDeviceSessions.map(s => s.userId),
          ipAddress
        },
        timestamp: new Date().toISOString()
      });
      
      throw new Error('Multiple accounts detected from this device. Please use one account per device.');
    }

    // Check for same IP within short timeframe
    const sameIPSessions = recentSessions.filter(s => 
      s.ipAddress === ipAddress && 
      s.userId !== user.telegramId &&
      Date.now() - new Date(s.createdAt).getTime() < 30 * 60 * 1000 // 30 minutes
    );

    if (sameIPSessions.length >= 3) { // More strict: 3 instead of 5
      this.logger.warn('Multiple accounts from same IP detected', {
        userId: user.telegramId,
        ipAddress,
        recentAccounts: sameIPSessions.length
      });
      
      await this.storage.saveSecurityIncident({
        type: 'multi_account_ip',
        userId: user.telegramId,
        severity: 'medium',
        details: {
          ipAddress,
          suspiciousAccounts: sameIPSessions.map(s => s.userId)
        },
        timestamp: new Date().toISOString()
      });
      
      throw new Error('Too many accounts accessed from this location recently.');
    }
  }

  /**
   * Perform pre-session security checks
   */
  private async performPreSessionSecurityChecks(userId: string, deviceInfo?: any): Promise<void> {
    if (!deviceInfo?.ip) return;

    // Check if IP is blocked
    const blockedIPs = await this.storage.getBlockedIPs();
    if (blockedIPs.includes(deviceInfo.ip)) {
      throw new Error('Access denied: IP address is blocked');
    }

    // Check rate limiting per IP
    const recentAttempts = await this.storage.getRecentCaptchaAttempts(deviceInfo.ip, 60 * 1000); // 1 minute
    if (recentAttempts.length > 10) {
      await this.storage.addBlockedIP(deviceInfo.ip, 'rate_limit_exceeded', 15 * 60 * 1000); // 15 minutes
      throw new Error('Too many attempts. Please try again later.');
    }

    // Check if user is temporarily blocked
    const userBlocks = await this.storage.getUserBlocks(userId);
    const activeBlock = userBlocks.find(block => 
      new Date(block.expiresAt) > new Date() && block.type === 'captcha_failed'
    );
    
    if (activeBlock) {
      const timeLeft = Math.ceil((new Date(activeBlock.expiresAt).getTime() - Date.now()) / 1000 / 60);
      throw new Error(`Account temporarily blocked. Try again in ${timeLeft} minutes.`);
    }
  }

  /**
   * Get enhanced geolocation information
   */
  private async getEnhancedGeoLocation(ip: string): Promise<any> {
    try {
      // In production, use a real geolocation service
      if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { 
          country: 'localhost', 
          countryCode: 'LH',
          city: 'localhost',
          region: 'local',
          timezone: 'UTC',
          isp: 'local',
          proxy: false,
          vpn: false,
          tor: false
        };
      }
      
      // Placeholder for real geolocation service
      return { 
        country: 'unknown', 
        countryCode: 'UN',
        city: 'unknown',
        region: 'unknown',
        timezone: 'unknown',
        isp: 'unknown',
        proxy: false,
        vpn: false,
        tor: false
      };
    } catch (error) {
      this.logger.error('Geolocation lookup failed:', error);
      return { country: 'unknown', countryCode: 'UN' };
    }
  }

  /**
   * Calculate geographic risk score
   */
  private async calculateGeoRisk(ip: string): Promise<number> {
    const geoInfo = await this.getEnhancedGeoLocation(ip);
    let riskScore = 0;

    // Check against blocked countries
    if (this.config.geoBlocking.enabled && this.config.geoBlocking.blockedCountries.includes(geoInfo.countryCode)) {
      riskScore += 0.9;
    }

    // Check for suspicious countries
    if (this.config.geoBlocking.suspiciousCountries.includes(geoInfo.countryCode)) {
      riskScore += 0.3;
    }

    // Check for VPN/Proxy
    if (geoInfo.vpn || geoInfo.proxy) {
      riskScore += 0.4;
    }

    // Check for TOR
    if (geoInfo.tor) {
      riskScore += 0.6;
    }

    return Math.min(riskScore, 1.0);
  }

  /**
   * Calculate comprehensive risk assessment
   */
  private calculateRiskAssessment(botScore: number, geoScore: number, threatScore: number): any {
    const deviceRisk = botScore * 0.4;
    const locationRisk = geoScore * 0.3;
    const behaviorRisk = threatScore * 0.3;
    const overallRisk = deviceRisk + locationRisk + behaviorRisk;

    return {
      overallRisk: Math.min(overallRisk, 1.0),
      deviceRisk,
      locationRisk,
      behaviorRisk,
      riskLevel: overallRisk >= 0.8 ? 'critical' : 
                 overallRisk >= 0.6 ? 'high' : 
                 overallRisk >= 0.4 ? 'medium' : 'low'
    };
  }

  /**
   * Determine adaptive challenge type based on risk
   */
  private determineAdaptiveType(requestedType: CaptchaType, riskAssessment: any): CaptchaType {
    const { overallRisk, riskLevel } = riskAssessment;

    // Force more complex challenges for high-risk users
    if (riskLevel === 'critical') {
      return 'miniapp'; // Hardest challenge
    } else if (riskLevel === 'high') {
      return requestedType === 'svg' ? 'miniapp' : requestedType;
    }

    // For low-risk users, allow requested type
    return requestedType;
  }

  /**
   * Determine difficulty based on comprehensive risk assessment
   */
  private determineDifficulty(overallRisk: number): 'easy' | 'medium' | 'hard' {
    if (overallRisk >= 0.7) return 'hard';
    if (overallRisk >= 0.4) return 'medium';
    return 'easy';
  }

  /**
   * Get adaptive max attempts based on risk
   */
  private getAdaptiveMaxAttempts(riskScore: number): number {
    if (riskScore >= 0.8) return 2; // High risk gets fewer attempts
    if (riskScore >= 0.5) return 3;
    return this.config.maxAttempts; // Default for low risk
  }

  /**
   * Get difficulty reason for logging
   */
  private getDifficultyReason(riskAssessment: any): string {
    const reasons = [];
    if (riskAssessment.deviceRisk > 0.3) reasons.push('suspicious device');
    if (riskAssessment.locationRisk > 0.3) reasons.push('risky location');
    if (riskAssessment.behaviorRisk > 0.3) reasons.push('suspicious behavior');
    return reasons.join(', ') || 'standard security';
  }

  /**
   * Get security level description
   */
  private getSecurityLevel(riskScore: number): string {
    if (riskScore >= 0.8) return 'maximum';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'standard';
  }

  /**
   * Get captcha statistics
   */
  public async getStats(): Promise<CaptchaStats> {
    return await this.storage.getCaptchaStats();
  }

  /**
   * Clean expired sessions
   */
  public async cleanExpiredSessions(): Promise<void> {
    await this.storage.cleanExpiredCaptchaSessions();
    this.logger.info('Cleaned expired captcha sessions');
  }

  /**
   * Get default configuration
   */
  /**
   * Get required quality threshold based on risk level
   */
  private getRequiredQuality(riskLevel: string): number {
    switch (riskLevel) {
      case 'critical': return 0.8;
      case 'high': return 0.7;
      case 'medium': return 0.5;
      default: return 0.3;
    }
  }

  /**
   * Get required device consistency based on risk level
   */
  private getRequiredConsistency(riskLevel: string): number {
    switch (riskLevel) {
      case 'critical': return 0.9;
      case 'high': return 0.8;
      case 'medium': return 0.6;
      default: return 0.5;
    }
  }

  /**
   * Perform additional security checks for high-risk users
   */
  private async performAdditionalSecurityChecks(
    session: CaptchaSession,
    deviceInfo: any,
    timeTaken: number
  ): Promise<boolean> {
    let securityScore = 1.0;

    // Check timing patterns (too fast indicates bot)
    const minExpectedTime = this.getMinExpectedTime(session.challenge.type, session.challenge.difficulty);
    if (timeTaken < minExpectedTime) {
      securityScore -= 0.3;
      this.logger.warn('Suspiciously fast completion', {
        sessionId: session.id,
        timeTaken,
        minExpected: minExpectedTime
      });
    }

    // Check for consistent human-like behavior - ONLY for miniapp captcha
    const meta = session.metadata as any;
    if (deviceInfo && meta?.riskAssessment?.deviceRisk > 0.7 && session.type === 'miniapp') {
      try {
        // Create enhanced device data for fingerprint generation
        const enhancedDeviceData = {
          hardware: deviceInfo.hardware || {
            screenResolution: deviceInfo.screen || 'unknown',
            platform: deviceInfo.platform || 'unknown',
            hardwareConcurrency: deviceInfo.hardwareConcurrency || 4,
            deviceMemory: deviceInfo.deviceMemory || 4,
            timezone: deviceInfo.timezone || 'UTC',
            language: deviceInfo.language || 'en'
          },
          browser: deviceInfo.browser || {
            userAgent: deviceInfo.userAgent || 'unknown',
            vendor: 'unknown',
            product: 'unknown',
            cookieEnabled: true,
            plugins: [],
            mimeTypes: []
          },
          rendering: deviceInfo.rendering || {
            canvasFingerprint: null,
            webGLRenderer: null,
            webGLVendor: null
          },
          network: deviceInfo.network || {
            connection: null,
            webRTCIPs: []
          },
          behavioral: deviceInfo.behavioral || {},
          sessionData: {
            sessionId: session.id,
            timestamp: Date.now(),
            userAgent: deviceInfo.userAgent || 'unknown',
            referrer: '',
            url: ''
          }
        };
        
        const currentFingerprint = await this.fingerprintService.generateFingerprint(
          enhancedDeviceData,
          session.userId
        );
        
        const behaviorScore = this.analyzeBehaviorConsistency(session, currentFingerprint);
        securityScore *= behaviorScore;
      } catch (error) {
        this.logger.error('Error in additional security checks:', error);
        securityScore *= 0.7; // Penalty for failing security check
      }
    }

    return securityScore >= 0.6;
  }

  /**
   * Get minimum expected completion time
   */
  private getMinExpectedTime(type: CaptchaType, difficulty: 'easy' | 'medium' | 'hard'): number {
    const baseTimes = {
      svg: { easy: 3000, medium: 5000, hard: 8000 },
      miniapp: { easy: 5000, medium: 10000, hard: 15000 }
    };
    
    return baseTimes[type]?.[difficulty] || 3000;
  }

  /**
   * Analyze behavior consistency
   */
  private analyzeBehaviorConsistency(session: CaptchaSession, currentFingerprint: any): number {
    // Compare with previous behavior patterns
    // This is a simplified implementation
    return 0.7; // Placeholder
  }

  /**
   * Post-verification processing for security tracking
   */
  private async postVerificationProcessing(
    session: CaptchaSession,
    result: CaptchaVerificationResult,
    deviceInfo?: any
  ): Promise<void> {
    // Update security metrics
    await this.storage.updateSecurityMetrics(session.userId, {
      captchaAttempted: true,
      captchaSuccess: result.success,
      riskLevel: (session.metadata as any).riskAssessment?.riskLevel || 'low',
      timestamp: new Date().toISOString()
    });

    // Handle failed verifications
    if (!result.success) {
      await this.handleFailedVerification(session, result, deviceInfo);
    } else {
      // Update success tracking
      await this.storage.updateUserSuccessRate(session.userId, result.confidence);
    }

    // Log for analytics
    this.logger.info('CAPTCHA verification processed', {
      sessionId: session.id,
      userId: session.userId,
      success: result.success,
      riskLevel: (session.metadata as any).riskAssessment?.riskLevel,
      securityLevel: (session.metadata as any).adaptiveSettings?.securityLevel
    });
  }

  /**
   * Handle failed verification attempts
   */
  private async handleFailedVerification(
    session: CaptchaSession,
    result: CaptchaVerificationResult,
    deviceInfo?: any
  ): Promise<void> {
    const riskLevel = (session.metadata as any).riskAssessment?.riskLevel || 'low';
    
    // Track consecutive failures
    const recentFailures = await this.storage.getRecentCaptchaFailures(session.userId, 60 * 60 * 1000); // 1 hour
    
    if (recentFailures.length >= 3 && riskLevel !== 'low') {
      // Temporary block for suspicious users
      const blockDuration = riskLevel === 'critical' ? 60 * 60 * 1000 : 30 * 60 * 1000; // 1 hour or 30 minutes
      await this.storage.addUserBlock(session.userId, 'captcha_failed', blockDuration);
      
      this.logger.warn('User temporarily blocked due to repeated CAPTCHA failures', {
        userId: session.userId,
        failures: recentFailures.length,
        riskLevel,
        blockDuration
      });
    }

    // Block IP for excessive failures
    if (deviceInfo?.ip) {
      const ipFailures = await this.storage.getRecentCaptchaFailuresByIP(deviceInfo.ip, 30 * 60 * 1000); // 30 minutes
      
      if (ipFailures.length >= 10) {
        await this.storage.addBlockedIP(deviceInfo.ip, 'excessive_failures', 60 * 60 * 1000); // 1 hour
        
        this.logger.warn('IP blocked due to excessive CAPTCHA failures', {
          ip: deviceInfo.ip,
          failures: ipFailures.length
        });
      }
    }
  }

  /**
   * Perform advanced multi-account detection with direct implementation
   */
  private async performAdvancedMultiAccountDetection(user: any, deviceFingerprint: string, ipAddress: string): Promise<any> {
    try {
      this.logger.info('Starting advanced multi-account detection', { userId: user.telegramId, ipAddress });

      // Generate comprehensive device fingerprint
      const fingerprint = this.generateComprehensiveFingerprint(user.enhancedDeviceData);
      
      // Check for exact device collisions
      const exactCollisions = await this.detectExactDeviceCollisions(user.telegramId, fingerprint, user.enhancedDeviceData, ipAddress);
      
      // Check for canvas fingerprint matches
      const canvasCollisions = await this.detectCanvasCollisions(user.telegramId, user.enhancedDeviceData, ipAddress);
      
      // Check for hardware specification matches
      const hardwareCollisions = await this.detectHardwareCollisions(user.telegramId, user.enhancedDeviceData, ipAddress);

      // Combine all collisions
      const allCollisions = [
        ...exactCollisions,
        ...canvasCollisions,
        ...hardwareCollisions
      ];

      // Remove duplicates based on conflicting user IDs
      const uniqueCollisions = this.deduplicateCollisions(allCollisions);

      const hasCollision = uniqueCollisions.length > 0;
      let shouldBan = hasCollision;
      let banReason = '';
      let allowedUserId;
      let bannedUserIds = [];

      if (hasCollision) {
        // Determine which users to ban (keep the oldest account, ban the rest)
        const collisionAnalysis = await this.analyzeCollisions(uniqueCollisions);
        allowedUserId = collisionAnalysis.allowedUserId;
        bannedUserIds = collisionAnalysis.bannedUserIds;
        banReason = `Device collision detected. Multiple accounts using the same device. Original account: ${allowedUserId}`;

        // Log the collision
        this.logger.warn('Device collision detected', {
          userId: user.telegramId,
          collisions: uniqueCollisions.length,
          allowedUser: allowedUserId,
          bannedUsers: bannedUserIds,
          deviceHash: fingerprint.hash
        });
      }

      return {
        hasCollision,
        collisions: uniqueCollisions,
        shouldBan: shouldBan && bannedUserIds.includes(user.telegramId),
        banReason,
        allowedUserId,
        bannedUserIds
      };

    } catch (error: unknown) {
      const err = error as any;
      this.logger.error('Error in advanced multi-account detection', {
        error: err?.message || String(error),
        userId: user.telegramId,
        stack: err?.stack
      });
      
      return {
        hasCollision: false,
        collisions: [],
        shouldBan: false,
        banReason: '',
        bannedUserIds: []
      };
    }
  }

  /**
   * Generate comprehensive device fingerprint
   */
  private generateComprehensiveFingerprint(deviceData: any): any {
    try {
      // Create a consistent fingerprint from key device characteristics
      const fingerprint = {
        hardware: {
          screenResolution: deviceData.hardware?.screenResolution,
          platform: deviceData.hardware?.platform,
          hardwareConcurrency: deviceData.hardware?.hardwareConcurrency,
          deviceMemory: deviceData.hardware?.deviceMemory,
          timezone: deviceData.hardware?.timezone,
          language: deviceData.hardware?.language
        },
        browser: {
          userAgent: deviceData.browser?.userAgent,
          vendor: deviceData.browser?.vendor,
          product: deviceData.browser?.product
        },
        rendering: {
          canvasFingerprint: deviceData.rendering?.canvasFingerprint,
          webGLVendor: deviceData.rendering?.webGLVendor,
          webGLRenderer: deviceData.rendering?.webGLRenderer
        }
      };
      
      const hash = crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
      
      return {
        hash,
        components: fingerprint
      };
    } catch (error) {
      this.logger.error('Error generating comprehensive fingerprint:', error);
      return {
        hash: 'fingerprint-error-' + Date.now(),
        components: {}
      };
    }
  }

  /**
   * Detect exact device hash matches by comparing with all existing users
   */
  private async detectExactDeviceCollisions(userId: string, fingerprint: any, deviceData: any, ipAddress: string): Promise<any[]> {
    try {
      const others = (await this.storage.getUsersByDeviceHash(fingerprint.hash)) || [];
      const conflicting = others.filter((u: string) => u !== userId);
      if (conflicting.length === 0) return [];
      const allUserIds = [userId, ...conflicting];
      const originalUserId = await this.findOriginalUser(allUserIds);
      const violatingUserIds = allUserIds.filter(id => id !== originalUserId);
      return [
        {
          deviceHash: fingerprint.hash,
          deviceFingerprint: JSON.stringify(fingerprint.components),
          conflictingUserIds: allUserIds,
          originalUserId,
          violatingUserIds,
          collisionType: 'exact_match',
          confidence: 1.0,
          detectedAt: new Date(),
          evidence: {
            identicalComponents: ['device_hash', 'complete_fingerprint'],
            ipAddress,
            userAgent: deviceData.browser?.userAgent,
            canvasFingerprint: deviceData.rendering?.canvasFingerprint,
            hardwareSpecs: deviceData.hardware
          }
        }
      ];
    } catch (error) {
      this.logger.error('Error detecting exact device collisions', { error: (error as any)?.message || String(error), userId });
      return [];
    }
  }

  /**
   * Detect canvas fingerprint collisions
   */
  private async detectCanvasCollisions(userId: string, deviceData: any, ipAddress: string): Promise<any[]> {
    try {
      const canvasFingerprint = deviceData?.rendering?.canvasFingerprint;
      if (!canvasFingerprint) return [];
      const others = (await this.storage.getUsersByCanvasFingerprint(canvasFingerprint)) || [];
      const conflictingUserIds = others.filter((u: string) => u !== userId);
      if (conflictingUserIds.length === 0) return [];
      const allUserIds = [userId, ...conflictingUserIds];
      const originalUserId = await this.findOriginalUser(allUserIds);
      const violatingUserIds = allUserIds.filter(id => id !== originalUserId);
      return [
        {
          deviceHash: `canvas_${this.hashString(canvasFingerprint)}`,
          deviceFingerprint: canvasFingerprint,
          conflictingUserIds: allUserIds,
          originalUserId,
          violatingUserIds,
          collisionType: 'canvas_match',
          confidence: 0.99,
          detectedAt: new Date(),
          evidence: {
            identicalComponents: ['canvas_fingerprint'],
            ipAddress,
            userAgent: deviceData.browser?.userAgent,
            canvasFingerprint,
            hardwareSpecs: deviceData.hardware
          }
        }
      ];
    } catch (error) {
      this.logger.error('Error detecting canvas collisions', { error: (error as any)?.message || String(error), userId });
      return [];
    }
  }

  /**
   * Detect hardware specification collisions
   */
  private async detectHardwareCollisions(userId: string, deviceData: any, ipAddress: string): Promise<any[]> {
    try {
      if (!deviceData?.hardware) return [];
      const hardwareSignature = this.createHardwareSignature(deviceData.hardware);
      const others = (await this.storage.getUsersByHardwareSignature(hardwareSignature)) || [];
      const conflictingUserIds = others.filter((u: string) => u !== userId);
      if (conflictingUserIds.length === 0) return [];
      const allUserIds = [userId, ...conflictingUserIds];
      const originalUserId = await this.findOriginalUser(allUserIds);
      const violatingUserIds = allUserIds.filter(id => id !== originalUserId);
      return [
        {
          deviceHash: `hardware_${this.hashString(hardwareSignature)}`,
          deviceFingerprint: hardwareSignature,
          conflictingUserIds: allUserIds,
          originalUserId,
          violatingUserIds,
          collisionType: 'hardware_match',
          confidence: 0.97,
          detectedAt: new Date(),
          evidence: {
            identicalComponents: ['hardware_specs'],
            ipAddress,
            userAgent: deviceData.browser?.userAgent,
            hardwareSpecs: deviceData.hardware
          }
        }
      ];
    } catch (error) {
      this.logger.error('Error detecting hardware collisions', { error: (error as any)?.message || String(error), userId });
      return [];
    }
  }

  /**
   * Get all users with enhanced device data
   * OPTIMIZATION: Only get recent users (last 30 days) instead of ALL
   */
  private async getAllUsersWithDeviceData(): Promise<any[]> {
    try {
      // Only check users from last 30 days for better performance
      const recentUsers = await this.storage.getUsersRegisteredRecently(30 * 24 * 60 * 60 * 1000);
      return recentUsers.filter(user => user.enhancedDeviceData).map(user => ({
        userId: user.telegramId || user.userId,
        enhancedDeviceData: user.enhancedDeviceData,
        joinedAt: user.joinedAt || user.createdAt
      }));
    } catch (error) {
      this.logger.error('Error getting all users with device data:', error);
      return [];
    }
  }

  /**
   * Find the original user (oldest account) among a list of user IDs
   */
  private async findOriginalUser(userIds: string[]): Promise<string> {
    let oldestUser = userIds[0];
    let oldestDate = new Date();

    for (const userId of userIds) {
      try {
        const user = await this.storage.getUser(userId);
        if (user) {
          const userDate = new Date(user.joinedAt || user.createdAt || Date.now());
          if (userDate < oldestDate) {
            oldestDate = userDate;
            oldestUser = userId;
          }
        }
    } catch (error: unknown) {
      const err = error as any;
      this.logger.error('Error getting user for original user detection', { error: err?.message || String(error), userId });
      }
    }

    return oldestUser;
  }

  /**
   * Remove duplicate collisions based on user IDs
   */
  private deduplicateCollisions(collisions: any[]): any[] {
    const seen = new Set();
    return collisions.filter(collision => {
      const key = collision.conflictingUserIds.sort().join(',');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Analyze collisions and determine which users to ban
   */
  private async analyzeCollisions(collisions: any[]): Promise<any> {
    // Get all unique user IDs from collisions
    const allUserIds = new Set<string>();
    collisions.forEach(collision => {
      collision.conflictingUserIds.forEach((id: string) => allUserIds.add(id));
    });

    // Find the oldest account (will be allowed to continue)
    const allowedUserId = await this.findOriginalUser(Array.from(allUserIds));
    const bannedUserIds = Array.from(allUserIds).filter(id => id !== allowedUserId);

    return { allowedUserId, bannedUserIds };
  }

  /**
   * Create a hardware signature from hardware data
   */
  private createHardwareSignature(hardware: any): string {
    const signature = {
      screenResolution: hardware.screenResolution,
      platform: hardware.platform,
      hardwareConcurrency: hardware.hardwareConcurrency,
      deviceMemory: hardware.deviceMemory,
      timezone: hardware.timezone,
      language: hardware.language
    };
    
    return JSON.stringify(signature);
  }

  /**
   * Hash a string for creating consistent identifiers
   */
  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * Ban a user and update their status
   */
  private async banUser(userId: string, reason: string, collisions: any[]): Promise<void> {
    try {
      // Update user status
      await (this.storage as any).updateUserStatus(userId, 'banned', reason);
      
      // Store ban record
      await (this.storage as any).saveBanRecord({
        userId,
        reason,
        type: 'multi_account_violation',
        severity: 'permanent',
        evidence: collisions,
        timestamp: new Date().toISOString(),
        bannedBy: 'system_auto_detection'
      });
      
      this.logger.error('User permanently banned', {
        userId,
        reason,
        collisionsCount: collisions.length
      });
    } catch (error: unknown) {
      const err = error as any;
      this.logger.error('Error banning user:', { userId, error: err?.message || String(error) });
    }
  }

  private getDefaultConfig(): CaptchaConfig {
    return {
      enabled: true,
      requiredForNewUsers: true,
      requiredForExistingUsers: false,
      requireAtLeastOne: true,
      sessionTimeout: 300000, // 5 minutes
      maxAttempts: 3,
      difficultyLevels: {
        easy: {
          imageDistortion: 1,
          characterCount: 4
        },
        medium: {
          imageDistortion: 3,
          characterCount: 5
        },
        hard: {
          imageDistortion: 6,
          characterCount: 6
        }
      },
      geoBlocking: {
        enabled: true,
        blockedCountries: ['XX'], // Add actual country codes as needed
        allowedCountries: [], // Empty means all allowed except blocked
        suspiciousCountries: ['CN', 'RU', 'IR', 'KP'] // Countries requiring extra scrutiny
      },
      deviceFingerprinting: {
        fingerprintRequired: true,
        qualityThreshold: 0.6,
        consistencyCheck: true,
        deviceBinding: true
      },
      botDetection: {
        enabled: true,
        sensitivityLevel: 0.7,
        patterns: [
          'rapid_interaction',
          'perfect_timing',
          'suspicious_user_agent',
          'automated_behavior'
        ],
        automatedBehaviorThreshold: 0.8,
        suspiciousTimingThreshold: 500
      }
    };
  }

  /**
   * Start captcha challenge for Telegram context
   * Now properly follows the captcha flow sequence
   */
  public async startCaptchaChallenge(ctx: any): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Unable to identify user');
        return;
      }

      // Import the config to check captcha settings
      const { getConfig } = require('../config');
      const config = getConfig();
      const storage = require('../storage').StorageManager.getInstance();
      
      // Get user to check current verification status
      const user = await storage.getUser(userId);
      
      // Check if miniapp is enabled and not completed
      const miniappEnabled = config.captcha.miniappEnabled;
      const miniappCompleted = user?.miniappVerified || false;
      
      // Check if SVG is enabled and not completed
      const svgEnabled = config.captcha.svgEnabled;
      const svgCompleted = user?.svgCaptchaVerified || false;
      
      // Determine what captcha to show based on configuration and completion status
      if (miniappEnabled && !miniappCompleted) {
        // Show miniapp captcha first
        await this.showMiniappCaptchaOnly(ctx, userId);
      } else if (svgEnabled && !svgCompleted) {
        // Show SVG captcha (either after miniapp completion or if only SVG enabled)
        await this.startActualSvgCaptcha(ctx, userId);
      } else {
        // All required captchas completed
        await ctx.reply('✅ **All Verifications Complete!**\n\nYou have successfully completed all required verifications.', { parse_mode: 'Markdown' });
        
        // Proceed to main menu
        const { MenuHandler } = require('../bot/handlers/menu-handler');
        const menuHandler = new MenuHandler();
        await menuHandler.showMainMenu(ctx);
      }
      
    } catch (error) {
      this.logger.error('Error starting captcha challenge:', error);
      await ctx.reply('❌ Failed to start captcha. Please try again.');
    }
  }
  
  /**
   * Show only miniapp captcha (when miniapp is next in sequence)
   */
  private async showMiniappCaptchaOnly(ctx: any, userId: string): Promise<void> {
    try {
      // Generate miniapp URL
      const miniappUrl = await this.generateMiniappCaptchaUrl(userId);
      
      let message = '🔒 **Security Verification Required**\n\n';
      message += 'Complete the interactive security challenge to continue.\n\n';
      message += '🖥️ **Interactive Verification**\n';
      message += 'Complete the security challenge in our interactive interface.\n\n';
      message += '✨ **Features:**\n';
      message += '• Multiple challenge types\n';
      message += '• Advanced security checks\n';
      message += '• User-friendly interface\n';
      message += '• Real-time validation\n\n';
      message += 'Click the button below to start:';
      
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Complete Interactive Verification',
              web_app: {
                url: miniappUrl
              }
            }
          ]]
        }
      });
      
      this.logger.info('Miniapp captcha prompt sent', {
        userId,
        type: 'verification'
      });
    } catch (error) {
      this.logger.error('Error showing miniapp captcha:', error);
      await ctx.reply('❌ Failed to start interactive verification. Please try again.');
    }
  }
  
  /**
   * Start actual SVG captcha with image generation
   */
  private async startActualSvgCaptcha(ctx: any, userId: string): Promise<void> {
    try {
      // Create SVG captcha session
      const session = await this.createSession(userId, 'svg', {
        ip: 'telegram',
        userAgent: 'TelegramBot',
        platform: 'telegram',
        userId: userId
      });
      
      if (session && session.challenge && session.answer) {
        // Generate→Send→Forget pattern: Generate image buffer and send immediately
        const imageBuffer = await this.generateCaptchaImageBuffer(session.answer);
        
        // Send instructions first
        await ctx.reply(
          `🔤 **Text Verification Challenge**\n\n` +
          `Please look at the image below and type the text you see.\n\n` +
          `💡 **Instructions:**\n` +
          `• Type only letters and numbers\n` +
          `• Case doesn't matter\n` +
          `• You have ${session.maxAttempts} attempts\n\n` +
          `⏰ This challenge expires in ${Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 60000)} minutes.`,
          { parse_mode: 'Markdown' }
        );
        
        // Send the image (Telegram will store it, we forget about it)
        await ctx.replyWithPhoto(
          { source: imageBuffer },
          {
            caption: '🖼️ **Enter the text from this image**\n\nType the characters you see above.',
            parse_mode: 'Markdown'
          }
        );
        
        // Store session info in user context for answer handling
        ctx.session = ctx.session || {};
        ctx.session.captchaSession = {
          sessionId: session.id,
          type: 'svg',
          awaitingAnswer: true,
          startTime: Date.now()
        };
        
        this.logger.info('SVG Captcha challenge sent with image', {
          userId,
          sessionId: session.id,
          difficulty: session.challenge.difficulty,
          pattern: 'generate→send→forget'
        });
      } else {
        await ctx.reply('❌ Failed to generate captcha challenge. Please try again.');
      }
    } catch (error) {
      this.logger.error('SVG captcha start error:', error);
      await ctx.reply(
        '❌ **Captcha Error**\n\n' +
        'Failed to start verification challenge. Please try again.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Start SVG captcha challenge (callback handler)
   */
  public async startSvgCaptchaChallenge(ctx: any, sessionId: string): Promise<void> {
    // This method is now handled by the captcha-validation service
    // but kept for backward compatibility
    const userId = ctx.from?.id?.toString();
    if (userId) {
      await this.startActualSvgCaptcha(ctx, userId);
    } else {
      await ctx.reply('❌ Unable to identify user');
    }
  }

  /**
   * Verify SVG captcha answer (legacy method)
   */
  public async verifySvgCaptchaAnswer(ctx: any, answer: string): Promise<void> {
    // This method is now handled by the captcha-validation service
    // but kept for backward compatibility
    await ctx.reply('❌ Please use the proper captcha verification flow.');
  }

  /**
   * Process captcha completion from miniapp
   */
  public async processCaptchaCompletion(ctx: any, data: any): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Unable to identify user');
        return;
      }

      // Import required modules
      const { getConfig } = require('../config');
      const config = getConfig();
      const storage = require('../storage').StorageManager.getInstance();
      
      // Get user and update miniapp verification status
      const user = await storage.getUser(userId);
      if (user) {
        user.miniappVerified = true;
        user.isVerified = true; // Set isVerified to true for dashboard stats
        user.lastCaptchaAt = new Date().toISOString();
        await storage.saveUser(user);
      }
      
      // Check if SVG captcha is also required
      const svgEnabled = config.captcha.svgEnabled;
      const svgCompleted = user?.svgCaptchaVerified || false;
      
      if (svgEnabled && !svgCompleted) {
        // Show SVG captcha next - but don't send manual completion message
        await ctx.reply(
          '🔤 **Additional Verification Required**\n\n' +
          'Please complete one more verification step for enhanced security.',
          { parse_mode: 'Markdown' }
        );
        
        // Start SVG captcha
        await this.startActualSvgCaptcha(ctx, userId);
      } else {
        // All captchas completed - use WelcomeHandler instead of manual messages
        try {
          const { WelcomeHandler } = require('../bot/handlers/welcome-handler');
          const welcomeHandler = new WelcomeHandler();
          await welcomeHandler.sendNewUserWelcome(ctx, user);
        } catch (error) {
          this.logger.error('Error using WelcomeHandler:', error);
          // Fallback to basic completion message
          await ctx.reply('🎉 **All Verifications Complete!**\n\nYou have successfully completed all required verifications.', { parse_mode: 'Markdown' });
          
          // Proceed to main menu
          const { MenuHandler } = require('../bot/handlers/menu-handler');
          const menuHandler = new MenuHandler();
          await menuHandler.showMainMenu(ctx);
        }
      }
      
    } catch (error) {
      this.logger.error('Error processing captcha completion:', error);
      await ctx.reply('❌ Failed to process verification completion. Please try again.');
    }
  }
}

// Export singleton instance
export const captchaService = CaptchaService.getInstance();