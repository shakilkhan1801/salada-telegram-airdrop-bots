/**
 * Types for the Points Transfer System
 */

export interface TransferRecord {
  id: string;
  hash: string; // Unique transaction hash
  senderId: string;
  senderUsername?: string;
  receiverId: string;
  receiverUsername?: string;
  amount: number;
  fee: number;
  netAmount: number; // amount - fee
  status: TransferStatus;
  type: TransferType;
  createdAt: string;
  processedAt?: string;
  failureReason?: string;
  metadata?: {
    senderIP?: string;
    deviceFingerprint?: string;
    userAgent?: string;
    confirmationRequired?: boolean;
  };
}

export type TransferStatus = 
  | 'pending'
  | 'confirmed' 
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TransferType =
  | 'user_to_user'
  | 'admin_transfer'
  | 'bonus_transfer'
  | 'refund_transfer';

export interface TransferRequest {
  senderId: string;
  recipient: string; // Can be userId, username, or telegram handle
  amount: number;
  type?: TransferType;
  message?: string;
}

export interface TransferConfirmation {
  transferId: string;
  hash: string;
  senderId: string;
  receiverId: string;
  amount: number;
  fee: number;
  requireConfirmation: boolean;
  expiresAt: string;
}

export interface TransferValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  transferLimits: {
    dailyTransfersUsed: number;
    dailyTransfersLimit: number;
    dailyAmountUsed: number;
    dailyAmountLimit: number;
    canTransfer: boolean;
  };
}

export interface TransferLimits {
  minAmount: number;
  maxAmount: number;
  maxDailyAmount: number;
  dailyLimit: number;
  feePercentage: number;
  enabled: boolean;
  requireConfirmation: boolean;
}

export interface TransferNotification {
  type: 'transfer_sent' | 'transfer_received' | 'transfer_failed';
  transferHash: string;
  userId: string;
  amount: number;
  otherUserId: string;
  otherUsername?: string;
  message?: string;
}

export interface DailyTransferStats {
  userId: string;
  date: string;
  transferCount: number;
  totalAmountTransferred: number;
  totalFeesPaid: number;
  transfersRemaining: number;
  amountRemaining: number;
}

// Lookup interface for finding users
export interface UserLookupResult {
  found: boolean;
  user?: {
    id: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  };
  error?: string;
}