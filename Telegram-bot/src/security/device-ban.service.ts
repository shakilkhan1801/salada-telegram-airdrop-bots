import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { DeviceFingerprint, SecurityAuditLog } from '../types/security.types';
import { BaseStorage } from '../storage/base-storage';
import { createStorage } from '../storage';

export interface BannedDevice {
  deviceHash: string;
  bannedAt: string;
  bannedBy: string;
  reason: string;
  violationType: string;
  relatedAccounts: string[];
  banDuration?: number; // in hours, undefined for permanent
  expiresAt?: string;
  appealable: boolean;
  appealSubmitted?: boolean;
  appealedAt?: string;
  appealReason?: string;
  metadata: {
    originalUserId: string;
    detectionMethod: string;
    confidence: number;
    additionalEvidence: Record<string, any>;
  };
}

export interface DeviceBanResult {
  success: boolean;
  deviceHash: string;
  affectedAccounts: string[];
  banDuration?: number;
  reason: string;
  auditLogId: string;
}

export interface BanCheckResult {
  isBanned: boolean;
  banDetails?: BannedDevice;
  canCreate: boolean;
  blockReason?: string;
}

export class DeviceBanService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage: BaseStorage;
  
  constructor() {
    this.storage = createStorage();
  }

  /**
   * Check if a device is banned
   */
  async isDeviceBanned(deviceHash: string): Promise<BanCheckResult> {
    try {
      const banDetails = await this.loadBanDetails(deviceHash);
      
      if (!banDetails) {
        return { isBanned: false, canCreate: true };
      }

      // Check if ban has expired
      if (banDetails.expiresAt && new Date(banDetails.expiresAt) < new Date()) {
        await this.expireBan(deviceHash);
        return { isBanned: false, canCreate: true };
      }

      return {
        isBanned: true,
        banDetails,
        canCreate: false,
        blockReason: this.generateBlockMessage(banDetails)
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking device ban status', { error: msg, deviceHash });
      // On error, allow the request but log for investigation
      return { isBanned: false, canCreate: true };
    }
  }

  /**
   * Ban a device and all associated accounts
   */
  async banDevice(
    deviceHash: string,
    userId: string,
    reason: string,
    violationType: string,
    relatedAccounts: string[] = [],
    banDurationHours?: number,
    bannedBy: string = 'system'
  ): Promise<DeviceBanResult> {
    try {
      const banRecord: BannedDevice = {
        deviceHash,
        bannedAt: new Date().toISOString(),
        bannedBy,
        reason,
        violationType,
        relatedAccounts: [userId, ...relatedAccounts],
        banDuration: banDurationHours,
        expiresAt: banDurationHours ? 
          new Date(Date.now() + banDurationHours * 3600000).toISOString() : 
          undefined,
        appealable: banDurationHours !== undefined, // Temporary bans are appealable
        metadata: {
          originalUserId: userId,
          detectionMethod: 'multi-account-detection',
          confidence: 0.95,
          additionalEvidence: {}
        }
      };

      // Store ban record
      await this.saveBanRecord(banRecord);
      
      // Create audit log
      const auditLogId = await this.createBanAuditLog(banRecord);

      // Block all related accounts
      await this.blockRelatedAccounts(banRecord.relatedAccounts, reason);

      this.logger.warn('Device banned successfully', {
        deviceHash,
        userId,
        reason,
        affectedAccounts: banRecord.relatedAccounts.length,
        duration: banDurationHours ? `${banDurationHours}h` : 'permanent'
      });

      return {
        success: true,
        deviceHash,
        affectedAccounts: banRecord.relatedAccounts,
        banDuration: banDurationHours,
        reason,
        auditLogId
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error banning device', { error: msg, deviceHash, userId });
      throw error;
    }
  }

  /**
   * Unban a device
   */
  async unbanDevice(
    deviceHash: string, 
    unbannedBy: string, 
    reason: string
  ): Promise<boolean> {
    try {
      const banDetails = await this.loadBanDetails(deviceHash);
      if (!banDetails) {
        return false;
      }

      await this.removeBanRecord(deviceHash);
      
      // Create audit log for unban
      await this.createUnbanAuditLog(deviceHash, unbannedBy, reason, banDetails);

      this.logger.info('Device unbanned successfully', {
        deviceHash,
        unbannedBy,
        reason,
        originalReason: banDetails.reason
      });

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error unbanning device', { error: msg, deviceHash });
      throw error;
    }
  }

  /**
   * Submit an appeal for a banned device
   */
  async submitAppeal(
    deviceHash: string,
    appealReason: string,
    userId: string
  ): Promise<boolean> {
    try {
      const banDetails = await this.loadBanDetails(deviceHash);
      if (!banDetails || !banDetails.appealable || banDetails.appealSubmitted) {
        return false;
      }

      banDetails.appealSubmitted = true;
      banDetails.appealedAt = new Date().toISOString();
      banDetails.appealReason = appealReason;

      await this.saveBanRecord(banDetails);

      this.logger.info('Device ban appeal submitted', {
        deviceHash,
        userId,
        appealReason: appealReason.substring(0, 100)
      });

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error submitting device ban appeal', { error: msg, deviceHash });
      return false;
    }
  }

  /**
   * Get all banned devices (for admin interface)
   */
  async getAllBannedDevices(): Promise<BannedDevice[]> {
    try {
      return await this.storage.getAllBannedDevices();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error loading banned devices list', { error: msg });
      return [];
    }
  }

  /**
   * Get ban statistics
   */
  async getBanStatistics(): Promise<{
    totalBans: number;
    activeBans: number;
    expiredBans: number;
    appealableBans: number;
    pendingAppeals: number;
  }> {
    try {
      const allBans = await this.getAllBannedDevices();
      const now = new Date();

      return {
        totalBans: allBans.length,
        activeBans: allBans.filter(ban => 
          !ban.expiresAt || new Date(ban.expiresAt) > now
        ).length,
        expiredBans: allBans.filter(ban => 
          ban.expiresAt && new Date(ban.expiresAt) <= now
        ).length,
        appealableBans: allBans.filter(ban => ban.appealable).length,
        pendingAppeals: allBans.filter(ban => 
          ban.appealSubmitted && !ban.expiresAt
        ).length
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error calculating ban statistics', { error: msg });
      return {
        totalBans: 0,
        activeBans: 0,
        expiredBans: 0,
        appealableBans: 0,
        pendingAppeals: 0
      };
    }
  }

  /**
   * Clean up expired bans
   */
  async cleanupExpiredBans(): Promise<number> {
    try {
      const allBans = await this.getAllBannedDevices();
      const now = new Date();
      let cleanedCount = 0;

      for (const ban of allBans) {
        if (ban.expiresAt && new Date(ban.expiresAt) <= now) {
          await this.expireBan(ban.deviceHash);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info('Cleaned up expired bans', { count: cleanedCount });
      }

      return cleanedCount;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error cleaning up expired bans', { error: msg });
      return 0;
    }
  }

  /**
   * Load ban details from storage
   */
  private async loadBanDetails(deviceHash: string): Promise<BannedDevice | null> {
    try {
      return await this.storage.getBannedDevice(deviceHash);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error loading ban details', { error: msg, deviceHash });
      return null;
    }
  }

  /**
   * Save ban record to storage
   */
  private async saveBanRecord(banRecord: BannedDevice): Promise<void> {
    try {
      await this.storage.saveBannedDevice(banRecord);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error saving ban record', { error: msg, deviceHash: banRecord.deviceHash });
      throw error;
    }
  }

  /**
   * Remove ban record from storage
   */
  private async removeBanRecord(deviceHash: string): Promise<void> {
    try {
      await this.storage.removeBannedDevice(deviceHash);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Error removing ban record', { error: msg, deviceHash });
      throw error;
    }
  }

  /**
   * Expire a ban
   */
  private async expireBan(deviceHash: string): Promise<void> {
    await this.removeBanRecord(deviceHash);
    this.logger.info('Ban expired and removed', { deviceHash });
  }

  /**
   * Block all related accounts
   */
  private async blockRelatedAccounts(accountIds: string[], reason: string): Promise<void> {
    this.logger.info('Blocking related accounts', { 
      accounts: accountIds.length, 
      reason: reason.substring(0, 50) 
    });

    // Block each account
    for (const accountId of accountIds) {
      // Skip null/undefined account IDs
      if (!accountId) {
        this.logger.warn('Skipping null/undefined account ID in blockRelatedAccounts');
        continue;
      }
      
      try {
        const blockData = {
          userId: accountId,
          reason,
          blockedAt: new Date().toISOString(),
          type: 'device_ban',
          permanent: true,
          deviceBan: true,
          metadata: {
            detectionMethod: 'multi-account-detection',
            automatedBlock: true
          }
        };
        
        const success = await this.storage.blockUser(accountId, blockData);
        
        if (success) {
          this.logger.info('Account blocked successfully', { 
            accountId, 
            reason 
          });
        } else {
          this.logger.error('Failed to block account', { accountId });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error('Error blocking account', { 
          accountId, 
          error: msg 
        });
      }
    }
  }

  /**
   * Create audit log for ban action
   */
  private async createBanAuditLog(banRecord: BannedDevice): Promise<string> {
    const auditLog: SecurityAuditLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      action: 'device_blocked',
      performedBy: banRecord.bannedBy,
      targetDeviceHash: banRecord.deviceHash,
      details: {
        reason: banRecord.reason,
        riskScore: banRecord.metadata.confidence,
        evidence: {
          violationType: banRecord.violationType,
          affectedAccounts: banRecord.relatedAccounts,
          detectionMethod: banRecord.metadata.detectionMethod
        },
        automatedAction: banRecord.bannedBy === 'system',
        appealable: banRecord.appealable
      },
      severity: 'error',
      metadata: {
        banDuration: banRecord.banDuration,
        relatedAccountCount: banRecord.relatedAccounts.length
      }
    };

    // In real implementation, save to audit log storage
    this.logger.info('Device ban audit log created', { auditLogId: auditLog.id });
    return auditLog.id;
  }

  /**
   * Create audit log for unban action
   */
  private async createUnbanAuditLog(
    deviceHash: string, 
    unbannedBy: string, 
    reason: string,
    originalBan: BannedDevice
  ): Promise<string> {
    const auditLog: SecurityAuditLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      action: 'device_unblocked',
      performedBy: unbannedBy,
      targetDeviceHash: deviceHash,
      details: {
        reason,
        automatedAction: false,
        appealable: false,
        evidence: {
          originalBanReason: originalBan.reason,
          originalBanDate: originalBan.bannedAt,
          wasAppealed: originalBan.appealSubmitted
        }
      },
      severity: 'info',
      metadata: {
        originalBanDuration: originalBan.banDuration
      }
    };

    // In real implementation, save to audit log storage
    this.logger.info('Device unban audit log created', { auditLogId: auditLog.id });
    return auditLog.id;
  }

  /**
   * Generate block message for banned devices
   */
  private generateBlockMessage(banDetails: BannedDevice): string {
    const baseMessage = `This device has been blocked due to: ${banDetails.reason}`;
    
    if (banDetails.expiresAt) {
      const expiryDate = new Date(banDetails.expiresAt).toLocaleDateString();
      return `${baseMessage}. Block expires on ${expiryDate}.`;
    }

    if (banDetails.appealable && !banDetails.appealSubmitted) {
      return `${baseMessage}. You may submit an appeal if you believe this is an error.`;
    }

    return `${baseMessage}. This is a permanent block.`;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}