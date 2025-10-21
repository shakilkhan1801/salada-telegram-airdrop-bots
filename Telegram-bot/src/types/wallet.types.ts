// ============= WalletConnect v2 Types =============
import { SessionTypes } from '@walletconnect/types';

export interface WalletConnectSession {
  topic: string;
  peer: SessionTypes.Struct['peer'];
  namespaces: SessionTypes.Struct['namespaces'];
  expiry: number;
  acknowledged: boolean;
}

export interface WalletConnectRequest {
  id: string;
  userId: string;
  uri: string;
  expiryTimestamp: number;
  expiresAt?: Date;
  createdAt: Date;
  isUsed: boolean;
  walletAppId?: WalletAppId;
}

export interface QRCodeSession {
  id: string;
  userId: string;
  uri: string;
  qrCodeDataUrl: string;
  expiryTimestamp: number;
  expiresAt?: Date;
  createdAt: Date;
  walletAppId?: string;
  isExpired: boolean;
  isConnected: boolean;
  scannedAt?: Date;
  connectedAt?: Date;
}

// ============= Wallet App Configuration =============
export type WalletAppId = 
  | 'metamask'
  | 'trust'
  | 'coinbase'
  | 'rainbow'
  | 'bitget'
  | 'phantom'
  | 'exodus'
  | 'atomic'
  | 'safepal'
  | 'tokenpocket'
  | 'imtoken'
  | 'oneinch'
  | 'mathwallet'
  | 'alphaWallet'
  | 'zerion'
  | 'pillar';

export interface WalletAppConfig {
  id: WalletAppId;
  name: string;
  description: string;
  icon: string;
  color: string;
  enabled: boolean;
  deepLink: {
    mobile: string;
    desktop?: string;
  };
  universalLink?: string;
  downloadUrl: {
    ios?: string;
    android?: string;
    chrome?: string;
  };
  supportedChains: number[];
}

// ============= Updated Connection Types =============
export interface WalletConnection {
  id: string;
  userId: string;
  walletAddress: string;
  walletType: WalletType;
  chainId: number;
  connectedAt: Date;
  lastActiveAt: string;
  isActive: boolean;
  expiresAt?: Date;
  sessionId?: string;
  walletConnectSession?: WalletConnectSession;
  metadata: WalletConnectionMetadata;
}

export type WalletType = 
  | 'metamask' 
  | 'trust' 
  | 'coinbase' 
  | 'rainbow' 
  | 'bitget' 
  | 'phantom' 
  | 'exodus' 
  | 'atomic' 
  | 'safepal' 
  | 'tokenpocket' 
  | 'imtoken'
  | 'oneinch'
  | 'mathwallet'
  | 'alphaWallet'
  | 'zerion'
  | 'pillar'
  | 'walletconnect' 
  | 'manual'
  | 'ethereum'
  | 'bitcoin'
  | 'solana'
  | 'ton'
  | 'unknown';

export interface WalletConnectionMetadata {
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  connectionMethod: 'qr_code' | 'deep_link' | 'manual_entry' | 'browser_extension' | 'walletconnect';
  verificationStatus: 'pending' | 'verified' | 'failed';
  lastVerificationAt?: string;
  walletConnectPeer?: string;
  signature?: string;
  customData?: Record<string, any>;
}

// ============= Withdrawal Types =============
export interface WithdrawalRequest {
  id: string;
  userId: string;
  walletAddress: string;
  pointsAmount: number;
  tokenAmount: number;
  conversionRate: number;
  status: WithdrawalStatus;
  requestedAt: string;
  processedAt?: string;
  completedAt?: string;
  transactionHash?: string;
  estimatedGas?: string;
  actualGas?: string;
  networkFee?: string;
  failureReason?: string;
  retryCount: number;
  metadata: WithdrawalRequestMetadata;
}

// Legacy withdrawal record interface for backward compatibility
export interface WithdrawalRecord {
  id: string;
  userId: string;
  amount: number;
  status: string;
  requestedAt: Date;
  processedAt?: Date;
  transactionHash?: string;
}

export type WithdrawalStatus = 
  | 'pending' 
  | 'processing' 
  | 'broadcasted' 
  | 'confirmed' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export interface WithdrawalRequestMetadata {
  requestSource: 'bot' | 'admin_panel' | 'api';
  adminProcessed?: boolean;
  adminNotes?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  verificationRequired?: boolean;
  riskScore?: number;
  walletConnectSession?: string; // Topic ID if connected via WalletConnect
  customData?: Record<string, any>;
}

// ============= Blockchain Configuration =============
export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  chainId: number;
  logoUrl?: string;
  verified: boolean;
}

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockTime: number;
  confirmations: number;
  walletConnectChainReference: string; // e.g., "eip155:1" for Ethereum mainnet
  isTestnet: boolean;
}

// ============= Statistics Types =============
export interface WalletStats {
  totalConnections: number;
  activeConnections: number;
  totalWithdrawals: number;
  totalTokensDistributed: string;
  totalNetworkFees: string;
  averageWithdrawalTime: number;
  walletConnectStats: {
    totalRequests: number;
    successfulConnections: number;
    successRate: number;
    averageConnectionTime: number;
  };
  qrCodeStats: {
    totalGenerated: number;
    totalScanned: number;
    scanRate: number;
  };
  popularWallets: Array<{
    type: WalletType;
    connections: number;
    percentage: number;
  }>;
  popularWalletApps: Array<{
    app: WalletAppId;
    connections: number;
    percentage: number;
  }>;
  withdrawalHistory: Array<{
    date: string;
    count: number;
    amount: string;
    fees: string;
  }>;
}

// ============= Wallet Validation =============
export interface WalletValidation {
  address: string;
  isValid: boolean;
  format: 'ethereum' | 'bitcoin' | 'solana' | 'ton' | 'other';
  checksumValid?: boolean;
  isContract?: boolean;
  balance?: string;
  verified: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
}

// ============= Point Transaction Types =============
export interface PointTransaction {
  id: string;
  userId: string;
  amount: number;
  type: 'wallet_connection' | 'task_completion' | 'referral' | 'withdrawal' | 'bonus' | 'penalty';
  description: string;
  timestamp: Date;
  metadata?: {
    walletAddress?: string;
    taskId?: string;
    referralId?: string;
    [key: string]: any;
  };
}

// ============= Connection Status Types =============
export interface ConnectionStatus {
  isConnected: boolean;
  connectionMethod?: 'walletconnect' | 'manual';
  connectedAt?: Date;
  walletAddress?: string;
  chainId?: number;
  sessionActive?: boolean;
}

// ============= Deep Link Generation =============
export interface DeepLinkOptions {
  walletAppId: WalletAppId;
  uri: string;
  userAgent?: string;
  platform?: 'mobile' | 'desktop';
}

export interface TelegramInlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

// ============= Service Response Types =============
export interface WalletConnectionResponse {
  success: boolean;
  walletAddress?: string;
  error?: string;
  connectionId?: string;
}

export interface QRCodeResponse {
  success: boolean;
  sessionId?: string;
  qrCodeDataUrl?: string;
  expiryTimestamp?: number;
  error?: string;
}

export interface DeepLinkResponse {
  success: boolean;
  deepLink?: string;
  walletApp?: WalletAppConfig;
  error?: string;
}

// ============= Legacy Types for Backward Compatibility =============
// These ensure existing code continues to work
export type LegacyWalletType = 'metamask' | 'trust' | 'ton' | 'manual' | 'ethereum' | 'bitcoin' | 'solana' | 'unknown';

// ============= Type Guards and Utilities =============
export const isWalletAppId = (value: string): value is WalletAppId => {
  const validIds: WalletAppId[] = [
    'metamask', 'trust', 'coinbase', 'rainbow', 'bitget', 'phantom',
    'exodus', 'atomic', 'safepal', 'tokenpocket', 'imtoken', 'oneinch',
    'mathwallet', 'alphaWallet', 'zerion', 'pillar'
  ];
  return validIds.includes(value as WalletAppId);
};

export const isEthereumAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export const isBitcoinAddress = (address: string): boolean => {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[a-z0-9]{39,59}$/.test(address);
};

export const isSolanaAddress = (address: string): boolean => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

export const isTonAddress = (address: string): boolean => {
  return /^EQ[A-Za-z0-9_-]{46}$/.test(address) || /^[0-9a-fA-F]{48}$/.test(address);
};

// Export the WalletConnect types as aliases for easier imports
export type { SessionTypes } from '@walletconnect/types';

// ============= Default Export =============
const WalletTypes = {
  isWalletAppId,
  isEthereumAddress,
  isBitcoinAddress,
  isSolanaAddress,
  isTonAddress,
};

export default WalletTypes;