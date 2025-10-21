// Import types from security.types to avoid duplication
import type { 
  HardwareFingerprint, 
  BrowserFingerprint, 
  RenderingFingerprint, 
  NetworkFingerprint, 
  BehavioralFingerprint 
} from './security.types';

// SECURITY FIX: Proper fingerprint typing to prevent security bypass
interface DeviceFingerprint {
  deviceId: string;
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookiesEnabled: boolean;
  doNotTrack: boolean;
  webGLRenderer: string;
  audioFingerprint: string;
  canvasFingerprint: string;
  touchSupport: boolean;
  hardwareConcurrency: number;
  colorDepth: number;
  pixelRatio: number;
}

interface EnhancedDeviceData {
  fingerprint: DeviceFingerprint;
  ipAddress: string;
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  networkInfo?: {
    downlink?: number;
    rtt?: number;
    effectiveType?: string;
  };
  behavioralMetrics?: {
    mouseMovements: number;
    keystrokes: number;
    clickPatterns: number[];
    scrollBehavior: number[];
  };
}

interface SecurityEvidence {
  type: string;
  description: string;
  confidence: number;
  timestamp: string;
  data: Record<string, string | number | boolean>;
}

export interface User {
  id: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium: boolean;
  points: number;
  totalEarned: number;
  isBlocked: boolean;
  blockedAt?: string;
  blockedUntil?: string;
  blockReason?: string;
  isVerified: boolean;
  verifiedAt?: string;
  verificationMethod?: 'svg' | 'enhanced_miniapp' | 'miniapp';
  svgCaptchaVerified: boolean;
  svgCaptchaVerifiedAt?: string;
  miniappVerified?: boolean;
  miniappVerifiedAt?: string;
  logicCaptchaVerified?: boolean;
  logicCaptchaVerifiedAt?: string;
  // Additional ban properties
  isTaskBanned?: boolean;
  taskBanUntil?: string;
  isReferralBanned?: boolean;
  referralBanUntil?: string;
  // Additional timestamp properties
  firstSeen?: string;
  // Wallet and transaction properties
  retweetLink?: string;
  claimed?: boolean;
  claimTimestamp?: string;
  transactionHash?: string;
  nonce?: number;
  lastClaimedPoints?: number;
  totalClaimedPoints?: number;
  previousWallet?: string;
  // Additional referral properties
  referrerId?: string;
  referrals?: string[];
  // Additional task properties
  completedTaskCount?: number;
  // QR Code properties
  qrCodeGeneratedToday?: number;
  lastQrCodeDate?: string;
  currentQrCodeExpiry?: string;
  qrCodeSessionTopic?: string;
  // Optimized fingerprint system
  associatedFingerprintHash?: string;
  fingerprint?: DeviceFingerprint; // SECURITY FIX: Proper fingerprint typing
  deviceCollisionData?: DeviceCollisionData;
  ipAddress?: string;
  country?: string;
  locationData?: LocationData;
  geolocationData?: GeolocationData[];
  locationConsistency?: LocationConsistency;
  vpnDetected: boolean;
  proxyDetected: boolean;
  torDetected: boolean;
  networkRiskFactors: string[];
  registeredAt: string;
  lastActiveAt: string;
  updatedAt: string;
  riskScore: number;
  overallThreatLevel: 'low' | 'medium' | 'high' | 'critical';
  multiAccountDetected: boolean;
  multiAccountData?: MultiAccountData;
  behavioralData?: BehavioralData;
  automationDetected: boolean;
  botScore: number;
  walletAddress?: string;
  walletConnectedAt?: string;
  walletDisconnectedAt?: string;
  referredBy?: string;
  referralCode: string;
  totalReferrals: number;
  activeReferrals: number;
  referralBonusActivated: boolean;
  completedTasks: string[];
  tasksCompleted: number;
  taskCompletionStatus: Record<string, 'Pending' | 'Completed' | 'Rejected'>;
  dailyTasksCompleted: Record<string, string>;
  lastTaskCompletedAt?: string;
  pointsHistory: PointTransaction[];
  withdrawalHistory: WithdrawalRecord[];
  suspiciousActivity: SuspiciousActivityRecord[];
  securityEvents: SecurityEvent[];
  awaitingTaskSubmission?: string;
  awaitingTicketMessage?: boolean;
  submissionHistory?: Array<{ taskTitle: string; submissionText: string; status: 'pending' | 'approved' | 'rejected' }>;
  metadata: UserMetadata;
}

export interface PointTransaction {
  id: string;
  userId: string;
  type: 'earned' | 'spent' | 'bonus' | 'referral' | 'penalty';
  amount: number;
  source: string;
  description: string;
  taskId?: string;
  referralId?: string;
  timestamp: Date;
  metadata?: Record<string, string | number | boolean>;
}

export interface WithdrawalRecord {
  id: string;
  amount: number;
  tokenAmount: number;
  walletAddress: string;
  transactionHash?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  processedAt?: string;
  failureReason?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SuspiciousActivityRecord {
  id: string;
  type: 'device_collision' | 'ip_collision' | 'rapid_registration' | 'behavioral_anomaly' | 'automation_detected' | 
        'location_inconsistent' | 'vpn_detected' | 'proxy_detected' | 'impossible_movement' | 'device_spoofing';
  description: string;
  riskScore: number;
  evidence: SecurityEvidence[];
  timestamp: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  action?: 'none' | 'warning' | 'temporary_block' | 'permanent_block' | 'enhanced_monitoring';
  correlatedEvents?: string[]; // IDs of related security events
}

export interface UserMetadata {
  createdBy: 'registration' | 'referral' | 'admin';
  registrationFlow: 'standard' | 'verification_required' | 'enhanced_verification';
  verificationAttempts: number;
  lastVerificationAttempt?: string;
  deviceChanges: number;
  ipChanges: number;
  locationChanges: number;
  lastDeviceChange?: string;
  lastIpChange?: string;
  lastLocationChange?: string;
  browserInfo?: BrowserInfo;
  systemInfo?: SystemInfo;
  enhancedBrowserInfo?: EnhancedBrowserInfo;
  enhancedSystemInfo?: EnhancedSystemInfo;
  firstDeviceHash?: string;
  deviceBindingHistory: DeviceBindingRecord[];
  locationHistory: LocationHistoryRecord[];
  verificationHistory: VerificationRecord[];
  riskAssessmentHistory: RiskAssessmentRecord[];
  customFields: Record<string, any>;
}

export interface BrowserInfo {
  userAgent: string;
  language: string;
  platform: string;
  vendor?: string;
  cookiesEnabled: boolean;
  doNotTrack?: boolean;
  screenResolution: string;
  timezone: string;
}

export interface SystemInfo {
  os: string;
  browser: string;
  version: string;
  mobile: boolean;
  webGLRenderer?: string;
  canvasFingerprint?: string;
  fontList?: string[];
  architecture?: string;
  cores?: number;
  platform: string;
  touchSupport: boolean;
  screenResolution: string;
}

export interface UserStats {
  totalUsers: number;
  verifiedUsers: number;
  activeUsers: number;
  blockedUsers: number;
  premiumUsers: number;
  usersWithWallet: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  totalPointsAwarded: number;
  totalWithdrawals: number;
  averagePointsPerUser: number;
  topUsers: Array<{
    id: string;
    username?: string;
    firstName?: string;
    points: number;
    tasksCompleted: number;
  }>;
}

export interface UserFilter {
  verified?: boolean;
  blocked?: boolean;
  premium?: boolean;
  hasWallet?: boolean;
  minPoints?: number;
  maxPoints?: number;
  minTasks?: number;
  maxTasks?: number;
  registeredAfter?: string;
  registeredBefore?: string;
  country?: string;
  referredBy?: string;
  lastActiveAfter?: string;
  lastActiveBefore?: string;
  search?: string;
}

export interface UserCreationData {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium: boolean;
  referredBy?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  enhancedDeviceData?: EnhancedDeviceData; // SECURITY FIX: Structured device data
  geolocationData?: { latitude: number; longitude: number; accuracy: number; };
  behavioralData?: { mouseMovements: number; keystrokes: number; clickPatterns: number[]; scrollBehavior: number[]; };
  browserInfo?: BrowserInfo;
  systemInfo?: SystemInfo;
  verificationMethod?: 'svg' | 'enhanced_miniapp' | 'miniapp';
  initialRiskScore?: number;
}

export interface UserUpdateData {
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  points?: number;
  isBlocked?: boolean;
  blockedAt?: string;
  blockedUntil?: string;
  blockReason?: string;
  isVerified?: boolean;
  verifiedAt?: string;
  updatedAt?: string;
  riskScore?: number;
  overallThreatLevel?: 'low' | 'medium' | 'high' | 'critical';
  verificationMethod?: 'svg' | 'enhanced_miniapp' | 'miniapp';
  svgCaptchaVerified?: boolean;
  miniappVerified?: boolean;
  logicCaptchaVerified?: boolean;
  // Optimized fingerprint system
  associatedFingerprintHash?: string;
  fingerprint?: DeviceFingerprint; // SECURITY FIX: Proper fingerprint typing
  deviceCollisionData?: DeviceCollisionData;
  locationData?: LocationData;
  geolocationData?: GeolocationData[];
  locationConsistency?: LocationConsistency;
  vpnDetected?: boolean;
  proxyDetected?: boolean;
  torDetected?: boolean;
  networkRiskFactors?: string[];
  multiAccountDetected?: boolean;
  multiAccountData?: MultiAccountData;
  behavioralData?: BehavioralData;
  automationDetected?: boolean;
  botScore?: number;
  walletAddress?: string;
  completedTasks?: string[];
  tasksCompleted?: number;
  taskCompletionStatus?: Record<string, 'Pending' | 'Completed' | 'Rejected'>;
  lastActiveAt?: string;
  ipAddress?: string;
  country?: string;
  detailedDeviceFingerprint?: DeviceFingerprint;
  detailedFingerprintData?: EnhancedDeviceData;
  fingerprintSubmittedAt?: Date;
  captchaCompleted?: boolean;
  lastCaptchaAt?: Date;
  captchaType?: string;
  userAgent?: string;
  browserInfo?: { userAgent: string; vendor: string; language: string; platform: string; };
  screenInfo?: { width: number; height: number; colorDepth: number; pixelRatio: number; };
  timezoneOffset?: number;
  lastVerificationData?: { timestamp: string; method: string; success: boolean; };
  registrationStatus?: string;
  metadata?: Partial<UserMetadata>;
}

// Enhanced device fingerprinting interfaces
export interface EnhancedDeviceFingerprint {
  hash: string;
  components: {
    hardware: HardwareFingerprint;
    browser: BrowserFingerprint;
    rendering: RenderingFingerprint;
    network: NetworkFingerprint;
    behavioral: BehavioralFingerprint;
  };
  quality: {
    overall: number;
    hardware: number;
    browser: number;
    rendering: number;
    network: number;
    uniqueness: number;
    stability: number;
  };
  riskScore: number;
  uniquenessScore: number;
  consistencyScore: number;
  createdAt: string;
  lastSeenAt: string;
}

// Location and geolocation interfaces
export interface LocationData {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  regionCode: string;
  city: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  isp: string;
  org: string;
  asn: string;
  proxy: boolean;
  vpn: boolean;
  tor: boolean;
  hosting: boolean;
  mobile: boolean;
  accuracy?: number;
  query?: string;
  timestamp: string;
}

export interface GeolocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  source: 'browser' | 'ip' | 'manual';
}

export interface LocationConsistency {
  ipLocationConsistent: boolean;
  geolocationConsistent: boolean;
  timezoneConsistent: boolean;
  languageConsistent: boolean;
  overallConsistency: number;
  discrepancies: string[];
  riskScore: number;
  lastCheckedAt: string;
}

// Device collision and multi-account data
export interface DeviceCollisionData {
  detectedAt: string;
  conflictingUsers: string[];
  originalUser: string;
  confidence: number;
  deviceHash: string;
  similarity: number;
  evidence: SecurityEvidence[];
}

export interface MultiAccountData {
  violations: Array<{
    type: string;
    severity: string;
    description: string;
    evidence: SecurityEvidence[];
    detectedAt: string;
  }>;
  riskScore: number;
  confidence: number;
  relatedAccounts: string[];
  detectionMethod: string;
  detectionDate: Date;
  detectionContext: string;
  bannedAccounts?: string[];
}

// Behavioral and bot detection data
export interface BehavioralData {
  mouseMovements?: Array<{x: number; y: number; timestamp: number}>;
  keyboardTimings?: number[];
  clickPatterns?: Array<{x: number; y: number; timestamp: number}>;
  scrollBehavior?: Array<{scrollY: number; timestamp: number}>;
  focusEvents?: Array<{type: string; timestamp: number}>;
  interactionTiming?: number[];
  automationScore: number;
  humanLikelihood: number;
  suspiciousPatterns: string[];
  collectedAt: string;
}

// Enhanced browser and system info
export interface EnhancedBrowserInfo extends BrowserInfo {
  webRTCSupport: boolean;
  webGLSupport: boolean;
  webAssemblySupport: boolean;
  serviceWorkerSupport: boolean;
  indexedDBSupport: boolean;
  localStorageSupport: boolean;
  sessionStorageSupport: boolean;
  notificationSupport: boolean;
  geolocationSupport: boolean;
  cameraSupport: boolean;
  microphoneSupport: boolean;
  bluetoothSupport: boolean;
  usbSupport: boolean;
  extensions: string[];
  plugins: Array<{name: string; version: string}>;
}

export interface EnhancedSystemInfo extends SystemInfo {
  architecture: string;
  cores: number;
  memory?: number;
  gpu?: string;
  displayCount: number;
  primaryDisplayResolution: string;
  colorGamut: string;
  hdrSupport: boolean;
  touchSupport: boolean;
  keyboardLayout?: string;
  installedFonts: string[];
  audioDevices: string[];
  videoDevices: string[];
  sensors: string[];
}

// History and tracking records
export interface DeviceBindingRecord {
  deviceHash: string;
  bindingStrength: number;
  boundAt: string;
  unboundAt?: string;
  reason: string;
  metadata: Record<string, any>;
}

export interface LocationHistoryRecord {
  location: LocationData;
  geolocation?: GeolocationData;
  consistency: LocationConsistency;
  recordedAt: string;
  ipAddress: string;
  suspicious: boolean;
  riskFactors: string[];
}

export interface VerificationRecord {
  method: 'svg' | 'enhanced_miniapp' | 'miniapp';
  completedAt: string;
  success: boolean;
  attempts: number;
  riskScore: number;
  deviceHash?: string;
  ipAddress: string;
  evidence: SecurityEvidence[];
}

export interface RiskAssessmentRecord {
  overallRiskScore: number;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: Array<{
    type: string;
    severity: string;
    score: number;
    description: string;
  }>;
  assessedAt: string;
  assessedBy: string; // 'system' or admin ID
  recommendations: string[];
  actionTaken?: string;
}

export interface SecurityEvent {
  id: string;
  type: 'device_collision' | 'location_inconsistent' | 'automation_detected' | 
        'vpn_detected' | 'impossible_movement' | 'device_change' | 'ip_change' | 
        'verification_failed' | 'suspicious_behavior';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: SecurityEvidence[];
  riskScore: number;
  timestamp: string;
  ipAddress?: string;
  deviceHash?: string;
  location?: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  actionTaken?: string;
  correlatedEvents: string[];
}

// User blocking data
export interface UserBlockData {
  reason: string;
  blockedBy: string;
  permanent: boolean;
  expiresAt?: string;
  violationType: string;
  evidence?: Record<string, any>;
  appealable: boolean;
  appealSubmitted?: boolean;
  appealReason?: string;
  appealedAt?: string;
}