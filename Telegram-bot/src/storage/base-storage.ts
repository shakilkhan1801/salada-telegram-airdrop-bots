import { StorageStats, CleanupResult, CollectionStats, PerformanceStats, AuditLogEntry, AdminUser } from '../types';
import { SecurityEvent } from '../security/threat-analyzer.service';

export abstract class BaseStorage {
  protected isInitialized = false;
  protected connectionStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';

  abstract initialize(): Promise<void>;
  
  abstract get<T>(collection: string, id?: string): Promise<T | null>;
  
  abstract set<T>(collection: string, data: T, id?: string): Promise<boolean>;
  
  abstract update<T>(collection: string, updates: Partial<T>, id?: string): Promise<boolean>;
  
  abstract delete(collection: string, id?: string): Promise<boolean>;
  
  abstract exists(collection: string, id?: string): Promise<boolean>;
  
  abstract list(collection?: string): Promise<string[]>;
  
  abstract backup(backupPath?: string): Promise<string>;
  
  abstract restore(backupPath: string): Promise<boolean>;
  
  abstract getStats(): Promise<StorageStats>;
  
  abstract cleanup(): Promise<CleanupResult>;
  
  abstract close(): Promise<void>;

  // Admin user management methods
  abstract getAdminUser(id: string): Promise<AdminUser | null>;
  abstract updateAdminUser(id: string, updates: Partial<AdminUser>): Promise<boolean>;
  abstract createAdminUser(userData: AdminUser): Promise<boolean>;
  abstract listAdminUsers(): Promise<AdminUser[]>;

  // Audit log methods
  abstract saveAuditLog(logEntry: AuditLogEntry): Promise<boolean>;
  abstract getAuditLogs(filters: any): Promise<AuditLogEntry[]>;
  abstract cleanupOldAuditLogs(days: number): Promise<number>;

  // Security event methods
  abstract logSecurityEvent(event: SecurityEvent): Promise<boolean>;
  abstract saveSecurityEvent(event: SecurityEvent): Promise<boolean>;

  // Captcha result methods
  abstract saveCaptchaResult(userId: string, captchaData: any): Promise<boolean>;
  abstract getCaptchaResult(userId: string): Promise<any | null>;
  
  // Captcha session methods
  abstract saveCaptchaSession(session: any): Promise<boolean>;

  // User management methods
  abstract getUser(userId: string): Promise<any | null>;
  abstract getUserByReferralCode(referralCode: string): Promise<any | null>;
  abstract getUserByWallet(walletAddress: string): Promise<any | null>;
  abstract saveUser(userId: string, userData: any): Promise<boolean>;
  abstract createUser(userData: any): Promise<boolean>;
  abstract updateUser(userId: string, updates: any): Promise<boolean>;

  // Wallet connection methods
  abstract saveWalletConnection(connection: any): Promise<boolean>;
  abstract getWalletConnections(userId: string): Promise<any[]>;
  abstract deactivateWalletConnectionByTopic(topic: string): Promise<boolean>;
  abstract getWithdrawalRecords(userId: string): Promise<any[]>;
  abstract saveWithdrawalRecord(record: any): Promise<boolean>;

  // WalletConnect session methods
  abstract saveWalletConnectRequest(request: any): Promise<boolean>;
  abstract updateWalletConnectRequest(requestId: string, updates: any): Promise<boolean>;
  abstract getWalletConnectRequest(requestId: string): Promise<any | null>;
  abstract getExpiredWalletConnectRequests(timestamp: number): Promise<any[]>;
  abstract deleteWalletConnectRequest(requestId: string): Promise<boolean>;

  // QR Code session methods
  abstract saveQRCodeSession(session: any): Promise<boolean>;
  abstract getQRCodeSession(sessionId: string): Promise<any | null>;
  abstract updateQRCodeSession(sessionId: string, updates: any): Promise<boolean>;
  abstract getQRCodeSessionsByUser(userId: string): Promise<any[]>;
  abstract getQRCodeSessionsByDate(userId: string, date: Date): Promise<any[]>;
  abstract getExpiredQRCodeSessions(timestamp: number): Promise<any[]>;
  abstract deleteQRCodeSession(sessionId: string): Promise<boolean>;
  abstract getAllQRCodeSessions(): Promise<any[]>;

  // Point transaction methods
  abstract savePointTransaction(transaction: any): Promise<boolean>;
  abstract getPointTransactions(userId: string): Promise<any[]>;

  // Transfer methods
  abstract saveTransferRecord(transfer: any): Promise<boolean>;
  abstract getTransferRecords(userId: string): Promise<any[]>;
  abstract getTransferHistoryBySender(senderId: string): Promise<any[]>;
  abstract getTransferHistoryByReceiver(receiverId: string): Promise<any[]>;
  abstract getDailyTransferCount(userId: string, date: Date): Promise<number>;
  abstract getDailyTransferAmount(userId: string, date: Date): Promise<number>;
  abstract getTransferByHash(hash: string): Promise<any | null>;

  // Security audit log methods
  abstract saveSecurityAuditLog(logEntry: any): Promise<boolean>;
  abstract getSecurityAuditLogs(filters: any): Promise<any[]>;

  // Missing methods that are used in the application
  abstract getAllUsers(): Promise<any[]>;
  abstract getAllTasks(): Promise<any[]>;
  abstract getTask(taskId: string): Promise<any | null>;
  abstract getAllTaskSubmissions(): Promise<any[]>;
  abstract getTaskSubmissions(taskId: string): Promise<any[]>;
  abstract getDeviceFingerprints(userId: string): Promise<any[]>;
  abstract saveDeviceFingerprint(userId: string, fingerprint: any): Promise<boolean>;
  abstract getCaptchaSession(sessionId: string): Promise<any | null>;
  abstract getCaptchaStats(): Promise<any>;
  abstract cleanExpiredCaptchaSessions(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract backupData(): Promise<any>;

  // Enhanced security methods for CAPTCHA system
  abstract getRecentCaptchaSessions(timeWindow: number): Promise<any[]>;
  abstract saveSecurityIncident(incident: any): Promise<boolean>;
  abstract getBlockedIPs(): Promise<string[]>;
  abstract addBlockedIP(ip: string, reason: string, duration: number): Promise<boolean>;
  abstract getRecentCaptchaAttempts(ip: string, timeWindow: number): Promise<any[]>;
  abstract getUserBlocks(userId: string): Promise<any[]>;
  abstract addUserBlock(userId: string, type: string, duration: number): Promise<boolean>;
  abstract updateSecurityMetrics(userId: string, metrics: any): Promise<boolean>;
  abstract updateUserSuccessRate(userId: string, confidence: number): Promise<boolean>;
  abstract getRecentCaptchaFailures(userId: string, timeWindow: number): Promise<any[]>;
  abstract getRecentCaptchaFailuresByIP(ip: string, timeWindow: number): Promise<any[]>;
  abstract saveSuspiciousActivity(activity: any): Promise<boolean>;

  // Enhanced device fingerprinting methods
  abstract saveEnhancedDeviceFingerprint(fingerprint: any): Promise<boolean>;
  abstract getEnhancedDeviceFingerprint(deviceHash: string): Promise<any | null>;
  abstract updateEnhancedDeviceFingerprint(deviceHash: string, updates: any): Promise<boolean>;
  abstract getAllDeviceFingerprints(): Promise<any[]>;
  abstract getDeviceFingerprintsByUser(userId: string): Promise<any[]>;
  abstract findSimilarDeviceFingerprints(fingerprint: any, threshold: number): Promise<any[]>;

  // Device ban methods
  abstract saveBannedDevice(banRecord: any): Promise<boolean>;
  abstract getBannedDevice(deviceHash: string): Promise<any | null>;
  abstract removeBannedDevice(deviceHash: string): Promise<boolean>;
  abstract getAllBannedDevices(): Promise<any[]>;
  abstract getBannedDevicesByUser(userId: string): Promise<any[]>;

  // Location tracking methods
  abstract saveLocationData(userId: string, locationData: any): Promise<boolean>;
  abstract getLocationHistory(userId: string): Promise<any[]>;
  abstract getUserLocationHistory(userId: string): Promise<any[]>;
  abstract updateLocationHistory(userId: string, locationData: any): Promise<boolean>;
  abstract getRecentLocationData(userId: string, timeWindow: number): Promise<any[]>;
  abstract saveGeolocationValidation(userId: string, validation: any): Promise<boolean>;
  abstract updateUserLocationConsistency(userId: string, consistency: any): Promise<boolean>;
  abstract getUserLocationConsistency(userId: string): Promise<any | null>;
  abstract trackLocationChange(userId: string, oldLocation: any, newLocation: any): Promise<boolean>;
  abstract detectImpossibleMovement(userId: string, newLocation: any): Promise<{detected: boolean; evidence: any}>;
  abstract detectDeviceCollisions(deviceHash: string): Promise<{collisions: any[]; users: string[]}>;
  abstract getUsersByIP(ipAddress: string): Promise<string[]>;

  // Multi-account detection methods for StrictMultiAccountDetector
  abstract getDevicesByHash(deviceHash: string): Promise<any[]>;
  abstract getUsersByCanvasFingerprint(canvasFingerprint: string): Promise<string[]>;
  abstract getUsersByHardwareSignature(hardwareSignature: string): Promise<string[]>;
  abstract getLocationValidationHistory(userId: string): Promise<any[]>;

  // Enhanced security audit methods
  abstract saveEnhancedSecurityEvent(event: any): Promise<boolean>;
  abstract getSecurityEventsByDevice(deviceHash: string): Promise<any[]>;
  abstract getSecurityEventsByLocation(ip: string): Promise<any[]>;

  // Multi-account detection methods
  abstract saveMultiAccountViolation(violation: any): Promise<boolean>;
  abstract storeMultiAccountViolation(detection: any): Promise<boolean>;
  abstract getMultiAccountViolations(userId: string): Promise<any[]>;
  abstract getAllMultiAccountViolations(): Promise<any[]>;
  
  // User management for security
  abstract blockUser(userId: string, blockData: any): Promise<boolean>;
  abstract unblockUser(userId: string, reason: string): Promise<boolean>;
  abstract isUserBlocked(userId: string): Promise<boolean>;

  // Device binding methods
  abstract saveDeviceBinding(userId: string, deviceHash: string, metadata: any): Promise<boolean>;
  abstract getDeviceBindings(userId: string): Promise<any[]>;
  abstract removeDeviceBinding(userId: string, deviceHash: string): Promise<boolean>;
  abstract isDeviceBound(deviceHash: string): Promise<boolean>;

  // Enhanced captcha session methods with device data
  abstract saveEnhancedCaptchaSession(session: any): Promise<boolean>;
  abstract getEnhancedCaptchaSession(sessionId: string): Promise<any | null>;
  abstract updateEnhancedCaptchaSession(sessionId: string, updates: any): Promise<boolean>;
  abstract getCaptchaSessionsByDevice(deviceHash: string): Promise<any[]>;

  // Risk assessment storage
  abstract saveRiskAssessment(userId: string, assessment: any): Promise<boolean>;
  abstract getRiskAssessment(userId: string): Promise<any | null>;
  abstract updateUserRiskScore(userId: string, riskScore: number): Promise<boolean>;

  // Privacy-first fingerprint storage methods
  abstract storeSecureHashes(userId: string, hashes: any): Promise<boolean>;
  abstract storeEncryptedFingerprint(userId: string, encrypted: any, ttl: number): Promise<boolean>;
  abstract findByDeviceSignature(deviceSignature: string): Promise<Array<{userId: string, hashes: any}>>;
  abstract findByCombinedHash(combinedHash: string): Promise<Array<{userId: string, hashes: any}>>;
  abstract getAllUserHashes(): Promise<Array<{userId: string, hashes: any}>>;
  abstract deleteExpiredEncryptedData(userId: string): Promise<boolean>;

  // Simple device hash storage methods for multi-account detection
  abstract storeUserDeviceHash(userId: string, deviceHash: string): Promise<boolean>;
  abstract getUsersByDeviceHash(deviceHash: string): Promise<any[]>;

  // ============================================
  // PERFORMANCE OPTIMIZATION: Indexed Query Methods
  // ============================================
  
  /**
   * Find devices by canvas fingerprint (indexed query)
   * Performance: O(log n) with index vs O(n) without
   */
  abstract findDevicesByCanvas(canvasHash: string): Promise<any[]>;
  
  /**
   * Find devices by screen resolution (indexed query)
   * Performance: O(log n) with index vs O(n) without
   */
  abstract findDevicesByScreenResolution(screenResolution: string): Promise<any[]>;
  
  /**
   * Find devices by WebGL renderer (indexed query)
   */
  abstract findDevicesByWebGLRenderer(webglRenderer: string): Promise<any[]>;
  
  /**
   * Get recent device fingerprints (for cache warming)
   * @param days Number of days to look back
   */
  abstract getRecentDeviceFingerprints(days: number): Promise<any[]>;
  
  /**
   * Find users registered recently (indexed by registeredAt)
   * @param timeWindow Time window in milliseconds
   */
  abstract getUsersRegisteredRecently(timeWindow: number): Promise<any[]>;
  
  /**
   * Count devices by canvas fingerprint (for duplicate detection)
   */
  abstract countDevicesByCanvas(canvasHash: string): Promise<number>;
  
  /**
   * Batch get device fingerprints by hashes (optimized for multiple lookups)
   */
  abstract batchGetDeviceFingerprints(hashes: string[]): Promise<Map<string, any>>;

  // Referral methods
  abstract saveReferralRecord(referralData: any): Promise<boolean>;
  abstract getReferralRecords(userId?: string): Promise<any[]>;

  // Data path methods
  abstract getDataPath(): string;

  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  protected validateCollection(collection: string): void {
    if (!collection || typeof collection !== 'string') {
      throw new Error('Invalid collection name');
    }
  }

  protected validateId(id: string): void {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new Error(`Invalid document ID: "${id}". ID must be a non-empty string.`);
    }
  }

  protected handleError(error: any, operation: string): never {
    const message = error?.message || 'Unknown error';
    throw new Error(`Storage ${operation} failed: ${message}`);
  }

  getConnectionStatus(): 'connected' | 'disconnected' | 'error' {
    return this.connectionStatus;
  }

  isReady(): boolean {
    return this.isInitialized && this.connectionStatus === 'connected';
  }
}