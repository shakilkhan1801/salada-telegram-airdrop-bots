import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { BaseStorage } from '../storage/base-storage';
import { createStorage } from '../storage';
import { DeviceBanService } from './device-ban.service';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { LocationService } from '../services/location/location.service';
import { User, UserCreationData } from '../types/user.types';

export interface AccountProtectionResult {
  allowed: boolean;
  reason?: string;
  blockType?: 'device_ban' | 'ip_ban' | 'user_ban' | 'security_violation';
  riskScore: number;
  evidence: Record<string, any>;
  automaticAction?: string;
}

export interface RegistrationRequest {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  deviceHash?: string;
  ipAddress?: string;
  deviceFingerprint?: any;
  geolocation?: any;
  referralCode?: string;
  verificationData?: any;
}

export interface AccountAccessCheck {
  userId: string;
  deviceHash?: string;
  ipAddress?: string;
  action: 'login' | 'task_submission' | 'verification' | 'wallet_connect' | 'referral_claim';
  metadata?: Record<string, any>;
}

export class AccountProtectionService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage: BaseStorage;
  private readonly deviceBanService = new DeviceBanService();
  private readonly fingerprintService = new DeviceFingerprintService();
  private readonly locationService = new LocationService();

  constructor() {
    this.storage = createStorage();
  }

  /**
   * Validate if an IP address is a real, public client IP.
   * Skips placeholders like 'unknown'/'telegram' and local/private ranges.
   */
  private isValidIpAddress(ip?: string): boolean {
    if (!ip) return false;
    const v = ip.trim().toLowerCase();
    if (!v || v === 'unknown' || v === 'telegram') return false;
    // Basic IPv4 check
    const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    // Basic IPv6 check (very lenient)
    const ipv6 = /^[0-9a-f:]+$/i;
    const isIp = ipv4.test(v) || ipv6.test(v);
    if (!isIp) return false;
    // Exclude loopback and common private ranges (quick check)
    if (
      v === '::1' ||
      v.startsWith('127.') ||
      v.startsWith('10.') ||
      v.startsWith('192.168.') ||
      v.startsWith('172.16.')
    ) return false;
    return true;
  }

  /**
   * Comprehensive pre-registration security check
   * This is the main gatekeeper for new account creation
   */
  async checkRegistrationAllowed(request: RegistrationRequest): Promise<AccountProtectionResult> {
    try {
      this.logger.info('Checking registration allowed', { telegramId: request.telegramId });

      let riskScore = 0;
      const evidence: Record<string, any> = {};
      
      // 1. Check if user already exists (prevent duplicate registrations)
      const existingUser = await this.storage.getUser(request.telegramId);
      if (existingUser) {
        return {
          allowed: false,
          reason: 'Account already exists',
          blockType: 'user_ban',
          riskScore: 1.0,
          evidence: { existingUser: existingUser.telegramId },
          automaticAction: 'registration_blocked'
        };
      }

      // 2. Check device ban status
      if (request.deviceHash) {
        const deviceBanCheck = await this.deviceBanService.isDeviceBanned(request.deviceHash);
        if (deviceBanCheck.isBanned) {
          return {
            allowed: false,
            reason: deviceBanCheck.blockReason || 'Device is banned',
            blockType: 'device_ban',
            riskScore: 1.0,
            evidence: { 
              deviceHash: request.deviceHash,
              banDetails: deviceBanCheck.banDetails
            },
            automaticAction: 'registration_blocked'
          };
        }
      }

      // 3. Check IP-based restrictions (only for valid public IPs)
      if (this.isValidIpAddress(request.ipAddress)) {
        const ipCheck = await this.checkIPRestrictions(request.ipAddress!);
        if (!ipCheck.allowed) {
          riskScore += 0.3;
          evidence.ipRestrictions = ipCheck;
        }

        // Check if IP has too many recent registrations
        const recentRegistrations = await this.getRecentRegistrationsByIP(request.ipAddress, 24 * 60 * 60 * 1000); // 24 hours
        if (recentRegistrations.length >= this.config.security.maxUsersPerIp) {
          return {
            allowed: false,
            reason: `Too many registrations from this IP (${recentRegistrations.length})`,
            blockType: 'ip_ban',
            riskScore: 0.9,
            evidence: { 
              ipAddress: request.ipAddress,
              recentRegistrations: recentRegistrations.length
            },
            automaticAction: 'registration_blocked'
          };
        }
      }

      // 4. Check device collision risk
      if (request.deviceFingerprint) {
        const collisionCheck = await this.checkDeviceCollisionRisk(request.deviceFingerprint);
        if (collisionCheck.highRisk) {
          riskScore += 0.4;
          evidence.deviceCollision = collisionCheck;
        }
      }

      // 5. Location consistency and VPN detection (only for valid public IPs)
      if (this.isValidIpAddress(request.ipAddress)) {
        const locationData = await this.locationService.getLocationFromIP(request.ipAddress!);
        if (locationData) {
          evidence.location = locationData;
          
          // Check for VPN/Proxy/Tor usage
          if (locationData.vpn || locationData.proxy || locationData.tor) {
            riskScore += 0.3;
            evidence.networkRisks = {
              vpn: locationData.vpn,
              proxy: locationData.proxy,
              tor: locationData.tor
            };

            // Block Tor users completely for registration
            if (locationData.tor) {
              return {
                allowed: false,
                reason: 'Tor network usage is not allowed for registration',
                blockType: 'security_violation',
                riskScore: 0.95,
                evidence: { 
                  ipAddress: request.ipAddress,
                  torDetected: true
                },
                automaticAction: 'registration_blocked'
              };
            }
          }

          // Check for high-risk countries (if configured)
          if (this.isHighRiskCountry(locationData.countryCode)) {
            riskScore += 0.2;
            evidence.highRiskCountry = locationData.countryCode;
          }
        }
      }

      // 6. Referral validation and risk assessment
      if (request.referralCode) {
        const referralCheck = await this.validateReferralCode(request.referralCode);
        if (!referralCheck.valid) {
          riskScore += 0.1;
          evidence.invalidReferral = referralCheck;
        } else if (referralCheck.suspicious) {
          riskScore += 0.2;
          evidence.suspiciousReferral = referralCheck;
        }
      }

      // 7. Rate limiting check
      const rateLimitCheck = await this.checkRegistrationRateLimit();
      if (!rateLimitCheck.allowed) {
        return {
          allowed: false,
          reason: 'Registration rate limit exceeded',
          blockType: 'security_violation',
          riskScore: 0.6,
          evidence: { rateLimit: rateLimitCheck },
          automaticAction: 'registration_rate_limited'
        };
      }

      // Final decision based on risk score
      const allowed = riskScore < 0.7; // 70% risk threshold
      
      if (!allowed) {
        this.logger.warn('Registration blocked due to high risk score', {
          telegramId: request.telegramId,
          riskScore,
          evidence
        });
      }

      return {
        allowed,
        reason: allowed ? undefined : `High risk score: ${(riskScore * 100).toFixed(1)}%`,
        riskScore,
        evidence,
        automaticAction: allowed ? 'registration_allowed' : 'registration_flagged'
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking registration allowed:', error);
      return {
        allowed: false,
        reason: 'Security check failed',
        blockType: 'security_violation',
        riskScore: 0.8,
        evidence: { error: msg },
        automaticAction: 'registration_error'
      };
    }
  }

  /**
   * Check if an existing user can perform a specific action
   */
  async checkAccountAccess(check: AccountAccessCheck): Promise<AccountProtectionResult> {
    try {
      this.logger.info('Checking account access', { userId: check.userId, action: check.action });

      let riskScore = 0;
      const evidence: Record<string, any> = {};

      // 1. Check if user is blocked
      const user = await this.storage.getUser(check.userId);
      if (!user) {
        return {
          allowed: false,
          reason: 'Account not found',
          blockType: 'user_ban',
          riskScore: 1.0,
          evidence: { userId: check.userId },
          automaticAction: 'access_denied'
        };
      }

      if (user.isBlocked) {
        return {
          allowed: false,
          reason: user.blockReason || 'Account is blocked',
          blockType: 'user_ban',
          riskScore: 1.0,
          evidence: { 
            userId: check.userId,
            blockedAt: user.blockedAt,
            blockReason: user.blockReason
          },
          automaticAction: 'access_denied'
        };
      }

      // 2. Check device ban status if device is provided
      if (check.deviceHash) {
        const deviceBanCheck = await this.deviceBanService.isDeviceBanned(check.deviceHash);
        if (deviceBanCheck.isBanned) {
          // Auto-block user if they're using a banned device
          await this.storage.blockUser(check.userId, {
            reason: 'Using banned device',
            blockedBy: 'system',
            permanent: true,
            violationType: 'banned_device_usage',
            evidence: { deviceHash: check.deviceHash }
          });

          return {
            allowed: false,
            reason: 'Device is banned',
            blockType: 'device_ban',
            riskScore: 1.0,
            evidence: { 
              deviceHash: check.deviceHash,
              banDetails: deviceBanCheck.banDetails
            },
            automaticAction: 'user_blocked'
          };
        }
      }

      // 3. Action-specific security checks
      const actionCheck = await this.performActionSpecificChecks(user, check);
      if (!actionCheck.allowed) {
        return actionCheck;
      }

      // 4. IP-based restrictions for sensitive actions (only for valid public IPs)
      if (this.isSensitiveAction(check.action) && this.isValidIpAddress(check.ipAddress)) {
        const ipCheck = await this.checkIPRestrictions(check.ipAddress!);
        if (!ipCheck.allowed) {
          riskScore += 0.4;
          evidence.ipRestrictions = ipCheck;
        }
      }

      // 5. Check for account compromise indicators
      const compromiseCheck = await this.checkAccountCompromiseIndicators(user, check);
      if (compromiseCheck.suspicious) {
        riskScore += compromiseCheck.riskScore;
        evidence.compromiseIndicators = compromiseCheck;
      }

      // Final decision
      const allowed = riskScore < 0.6; // Lower threshold for existing users
      
      // Log access attempt
      await this.storage.logSecurityEvent({
        userId: check.userId,
        type: `access_check_${check.action}`,
        severity: allowed ? 'low' : 'medium',
        description: `Access check for ${check.action} - ${allowed ? 'allowed' : 'denied'}`,
        timestamp: new Date(),
        metadata: {
          action: check.action,
          allowed,
          riskScore,
          evidence,
          deviceHash: check.deviceHash,
          ipAddress: check.ipAddress
        }
      });

      return {
        allowed,
        reason: allowed ? undefined : 'Account access restricted due to security concerns',
        riskScore,
        evidence,
        automaticAction: allowed ? 'access_granted' : 'access_restricted'
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking account access:', error);
      return {
        allowed: false,
        reason: 'Security check failed',
        blockType: 'security_violation',
        riskScore: 0.8,
        evidence: { error: msg },
        automaticAction: 'access_error'
      };
    }
  }

  /**
   * Bulk check to identify potential ban evasion attempts
   */
  async scanForBanEvasion(): Promise<{
    suspiciousAccounts: string[];
    deviceCollisions: Array<{
      deviceHash: string;
      users: string[];
      riskScore: number;
    }>;
    reportGenerated: string;
  }> {
    try {
      this.logger.info('Starting ban evasion scan');

      const suspiciousAccounts: string[] = [];
      const deviceCollisions: Array<{
        deviceHash: string;
        users: string[];
        riskScore: number;
      }> = [];

      // 1. Check for device sharing patterns
      // OPTIMIZATION: Only check recent fingerprints (last 30 days) instead of ALL
      const recentFingerprints = await this.storage.getRecentDeviceFingerprints(30);
      const deviceGroups = new Map<string, string[]>();

      for (const fingerprint of recentFingerprints) {
        if (!deviceGroups.has(fingerprint.hash)) {
          deviceGroups.set(fingerprint.hash, []);
        }
        deviceGroups.get(fingerprint.hash)!.push(fingerprint.userId);
      }

      // Identify devices used by multiple users
      for (const [deviceHash, users] of deviceGroups) {
        if (users.length > 1) {
          const uniqueUsers = [...new Set(users)];
          if (uniqueUsers.length > 1) {
            deviceCollisions.push({
              deviceHash,
              users: uniqueUsers,
              riskScore: Math.min(0.3 + (uniqueUsers.length * 0.2), 1.0)
            });
            
            // All users except the first (original) are suspicious
            suspiciousAccounts.push(...uniqueUsers.slice(1));
          }
        }
      }

      // 2. Check for rapid registrations from same IP
      // OPTIMIZATION: Use indexed query instead of getAllUsers
      const recentUsers = await this.storage.getUsersRegisteredRecently(24 * 60 * 60 * 1000); // 24 hours
      const ipGroups = new Map<string, string[]>();

      for (const user of recentUsers) {
        if (user.ipAddress) {
          if (!ipGroups.has(user.ipAddress)) {
            ipGroups.set(user.ipAddress, []);
          }
          ipGroups.get(user.ipAddress)!.push(user.telegramId);
        }
      }

      for (const [ip, users] of ipGroups) {
        if (users.length > this.config.security.maxUsersPerIp) {
          suspiciousAccounts.push(...users);
        }
      }

      // 3. Generate report
      const reportPath = await this.generateBanEvasionReport({
        suspiciousAccounts: [...new Set(suspiciousAccounts)],
        deviceCollisions,
        scanTimestamp: new Date().toISOString()
      });

      this.logger.info('Ban evasion scan completed', {
        suspiciousAccounts: suspiciousAccounts.length,
        deviceCollisions: deviceCollisions.length
      });

      return {
        suspiciousAccounts: [...new Set(suspiciousAccounts)],
        deviceCollisions,
        reportGenerated: reportPath
      };

    } catch (error) {
      this.logger.error('Error during ban evasion scan:', error);
      throw error;
    }
  }

  /**
   * Check IP-based restrictions
   */
  private async checkIPRestrictions(ipAddress: string): Promise<{
    allowed: boolean;
    reason?: string;
    evidence: Record<string, any>;
  }> {
    try {
      const evidence: Record<string, any> = {};

      // Check if IP is in blacklist (with fallback for missing config)
      const blacklistIps = this.config.security.blacklistIps || [];
      const isBlacklisted = blacklistIps.includes(ipAddress);
      if (isBlacklisted) {
        return {
          allowed: false,
          reason: 'IP address is blacklisted',
          evidence: { blacklisted: true }
        };
      }

      // Check location data
      const locationData = await this.locationService.getLocationFromIP(ipAddress);
      if (locationData) {
        evidence.location = locationData;

        // Block certain network types
        const allowDatacenterIPs = (this.config.security as any)?.allowDatacenterIPs ?? false;
        if (locationData.hosting && !allowDatacenterIPs) {
          return {
            allowed: false,
            reason: 'Datacenter IPs are not allowed',
            evidence: { hosting: true, ...evidence }
          };
        }

        if (locationData.tor) {
          return {
            allowed: false,
            reason: 'Tor network is not allowed',
            evidence: { tor: true, ...evidence }
          };
        }
      }

      return { allowed: true, evidence };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking IP restrictions:', error);
      return {
        allowed: false,
        reason: 'IP check failed',
        evidence: { error: msg }
      };
    }
  }

  /**
   * Check for device collision risk during registration (OPTIMIZED VERSION)
   * 
   * NEW APPROACH:
   * 1. Instant exact hash check (fast)
   * 2. Background similarity analysis (async)
   * 3. Return fast decision for user flow
   */
  private async checkDeviceCollisionRisk(deviceFingerprint: any): Promise<{
    highRisk: boolean;
    evidence: Record<string, any>;
  }> {
    try {
      // Import enhanced verification service on-demand
      const { EnhancedDeviceVerificationService } = await import('../services/enhanced-device-verification.service');
      const verificationService = new EnhancedDeviceVerificationService();
      
      // Generate fingerprint hash
      const deviceHash = this.fingerprintService.generateDeviceHash(deviceFingerprint);
      const fingerprintData = { 
        hash: deviceHash,
        userId: deviceFingerprint.userId || 'unknown',
        components: deviceFingerprint,
      };
      
      // Use new optimized verification (< 50ms response)
      const verificationResult = await verificationService.verifyDeviceFingerprint(fingerprintData);
      
      // Map verification status to risk assessment
      switch (verificationResult.status) {
        case 'instant_block':
          return {
            highRisk: true,
            evidence: {
              reason: verificationResult.reason,
              confidence: verificationResult.confidence,
              processingTime: verificationResult.processingTime,
              cached: verificationResult.cached,
              similarDevices: verificationResult.similarDevices || [],
            }
          };
          
        case 'pending_verification':
          // For real-time user registration, treat as low risk but log for monitoring
          this.logger.info('Device verification pending background check', {
            deviceHash: fingerprintData.hash,
            userId: fingerprintData.userId,
            jobId: verificationResult.jobId,
          });
          
          return {
            highRisk: false, // Allow registration to proceed
            evidence: {
              reason: verificationResult.reason,
              confidence: verificationResult.confidence,
              processingTime: verificationResult.processingTime,
              backgroundJobId: verificationResult.jobId,
              status: 'background_analysis_queued',
            }
          };
          
        case 'instant_allow':
        default:
          return {
            highRisk: false,
            evidence: {
              reason: verificationResult.reason,
              confidence: verificationResult.confidence,
              processingTime: verificationResult.processingTime,
              cached: verificationResult.cached,
            }
          };
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error in optimized device collision check:', error);
      
      // Fallback to low-risk if verification service fails
      return { 
        highRisk: false,
        evidence: { 
          error: msg,
          fallback: true,
          reason: 'Verification service error - defaulting to allow',
        }
      };
    }
  }

  /**
   * Validate referral code and check for suspicious patterns
   */
  private async validateReferralCode(referralCode: string): Promise<{
    valid: boolean;
    suspicious: boolean;
    evidence: Record<string, any>;
  }> {
    try {
      // First try to find user by referral code, then by user ID
      let referrer = await this.storage.getUserByReferralCode(referralCode);
      if (!referrer) {
        referrer = await this.storage.getUser(referralCode);
      }
      
      if (!referrer) {
        return {
          valid: false,
          suspicious: false,
          evidence: { reason: 'referral_not_found' }
        };
      }

      // Check if referrer is blocked
      if (referrer.isBlocked) {
        return {
          valid: false,
          suspicious: true,
          evidence: { 
            reason: 'referrer_blocked',
            referrerId: referrer.telegramId
          }
        };
      }

      // Check for excessive referrals (potential referral farming)
      const recentReferrals = await this.getRecentReferralsByUser(
        referrer.telegramId,
        24 * 60 * 60 * 1000 // 24 hours
      );

      if (recentReferrals.length > 10) { // More than 10 referrals in 24h
        return {
          valid: true,
          suspicious: true,
          evidence: {
            reason: 'excessive_referrals',
            referrerId: referrer.telegramId,
            recentCount: recentReferrals.length
          }
        };
      }

      return {
        valid: true,
        suspicious: false,
        evidence: { referrerId: referrer.telegramId }
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error validating referral code:', error);
      return {
        valid: false,
        suspicious: false,
        evidence: { error: msg }
      };
    }
  }

  /**
   * Check registration rate limits
   */
  private async checkRegistrationRateLimit(): Promise<{
    allowed: boolean;
    evidence: Record<string, any>;
  }> {
    try {
      const recentRegistrations = await this.getAllUsersRegisteredRecently(
        60 * 60 * 1000 // 1 hour
      );

      const maxPerHour = ((this.config.security as any)?.maxRegistrationsPerHour) ?? 100;
      
      return {
        allowed: recentRegistrations.length < maxPerHour,
        evidence: {
          recentCount: recentRegistrations.length,
          limit: maxPerHour,
          timeWindow: '1 hour'
        }
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking registration rate limit:', error);
      return {
        allowed: false,
        evidence: { error: msg }
      };
    }
  }

  /**
   * Perform action-specific security checks
   */
  private async performActionSpecificChecks(
    user: User,
    check: AccountAccessCheck
  ): Promise<AccountProtectionResult> {
    
    switch (check.action) {
      case 'wallet_connect':
        return this.checkWalletConnectionSecurity(user, check);
        
      case 'task_submission':
        return this.checkTaskSubmissionSecurity(user, check);
        
      case 'referral_claim':
        return this.checkReferralClaimSecurity(user, check);
        
      default:
        return { 
          allowed: true, 
          riskScore: 0, 
          evidence: {} 
        };
    }
  }

  // Helper methods for various security checks
  private async checkWalletConnectionSecurity(user: User, check: AccountAccessCheck): Promise<AccountProtectionResult> {
    // Implement wallet connection specific security
    return { allowed: true, riskScore: 0, evidence: {} };
  }

  private async checkTaskSubmissionSecurity(user: User, check: AccountAccessCheck): Promise<AccountProtectionResult> {
    // Implement task submission specific security
    return { allowed: true, riskScore: 0, evidence: {} };
  }

  private async checkReferralClaimSecurity(user: User, check: AccountAccessCheck): Promise<AccountProtectionResult> {
    // Implement referral claim specific security
    return { allowed: true, riskScore: 0, evidence: {} };
  }

  private async checkAccountCompromiseIndicators(
    user: User, 
    check: AccountAccessCheck
  ): Promise<{
    suspicious: boolean;
    riskScore: number;
    evidence: Record<string, any>;
  }> {
    // Implement compromise detection logic
    return { suspicious: false, riskScore: 0, evidence: {} };
  }

  private isSensitiveAction(action: string): boolean {
    return ['wallet_connect', 'referral_claim'].includes(action);
  }

  private isHighRiskCountry(countryCode: string): boolean {
    const highRiskCountries = ((this.config.security as any)?.highRiskCountries) || [];
    return highRiskCountries.includes(countryCode);
  }

  private async getRecentRegistrationsByIP(ipAddress: string, timeWindow: number): Promise<User[]> {
    // OPTIMIZATION: Use indexed query instead of getAllUsers + filter
    const recentUsers = await this.storage.getUsersRegisteredRecently(timeWindow);
    
    return recentUsers.filter(user => user.ipAddress === ipAddress);
  }

  private async getAllUsersRegisteredRecently(timeWindow: number): Promise<User[]> {
    // OPTIMIZATION: Use indexed query directly
    return await this.storage.getUsersRegisteredRecently(timeWindow);
  }

  private async getRecentReferralsByUser(userId: string, timeWindow: number): Promise<User[]> {
    // OPTIMIZATION: Use indexed query + filter by referredBy
    const recentUsers = await this.storage.getUsersRegisteredRecently(timeWindow);
    
    return recentUsers.filter(user => user.referredBy === userId);
  }

  private async generateBanEvasionReport(data: any): Promise<string> {
    const reportPath = `/tmp/ban_evasion_report_${Date.now()}.json`;
    // In a real implementation, this would generate a comprehensive report
    return reportPath;
  }
}