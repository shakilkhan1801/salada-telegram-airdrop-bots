import crypto from 'crypto';
import { TransferRecord, UserLookupResult } from '../types/transfer.types';

/**
 * Generate a unique transfer hash
 */
export function generateTransferHash(senderId: string, receiverId: string, amount: number, timestamp?: number): string {
  const time = timestamp || Date.now();
  const data = `${senderId}-${receiverId}-${amount}-${time}-${Math.random()}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32).toUpperCase();
}

/**
 * Generate a transfer ID
 */
export function generateTransferId(senderId: string, receiverId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN_${timestamp}_${senderId}_${receiverId}_${random}`;
}

/**
 * Format transfer hash for display
 */
export function formatTransferHash(hash: string): string {
  return hash.match(/.{4}/g)?.join('-') || hash;
}

/**
 * Calculate transfer fee
 */
export function calculateTransferFee(amount: number, feePercentage: number): number {
  const fee = (amount * feePercentage) / 100;
  return Math.round(fee * 100) / 100; // keep 2 decimals
}

/**
 * Validate transfer amount
 */
export function validateTransferAmount(
  amount: number, 
  senderBalance: number, 
  minAmount: number, 
  maxAmount: number
): { isValid: boolean; error?: string } {
  if (amount <= 0) {
    return { isValid: false, error: 'Amount must be greater than 0' };
  }
  
  if (amount < minAmount) {
    return { isValid: false, error: `Minimum transfer amount is ${minAmount} points` };
  }
  
  if (amount > maxAmount) {
    return { isValid: false, error: `Maximum transfer amount is ${maxAmount} points` };
  }
  
  if (amount > senderBalance) {
    return { isValid: false, error: 'Insufficient balance' };
  }
  
  return { isValid: true };
}

/**
 * Parse recipient input (can be user ID, username, or @username)
 */
export function parseRecipientInput(input: string): { type: 'id' | 'username'; value: string } {
  // Remove @ if present
  const cleanInput = input.replace(/^@/, '');
  
  // Check if it's a numeric ID
  if (/^\d+$/.test(cleanInput)) {
    return { type: 'id', value: cleanInput };
  }
  
  // Otherwise treat as username
  return { type: 'username', value: cleanInput.toLowerCase() };
}

/**
 * Format points with commas
 */
export function formatPoints(points: number): string {
  return points.toLocaleString();
}

/**
 * Get time until next transfer (for daily limits)
 */
export function getTimeUntilNextTransfer(lastTransferTime: Date): { hours: number; minutes: number; canTransfer: boolean } {
  const now = new Date();
  const tomorrow = new Date(lastTransferTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const diffMs = tomorrow.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return { hours: 0, minutes: 0, canTransfer: true };
  }
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  return { hours, minutes, canTransfer: false };
}

/**
 * Create transfer notification message
 */
export function createTransferNotificationMessage(
  type: 'sent' | 'received' | 'failed',
  amount: number,
  otherUser: string,
  hash: string,
  fee?: number
): string {
  const formattedAmount = formatPoints(amount);
  const formattedHash = formatTransferHash(hash);
  
  switch (type) {
    case 'sent':
      return `✅ <b>Transfer Sent Successfully!</b>\n\n` +
             `💸 <b>Amount:</b> ${formattedAmount} points\n` +
             `👤 <b>To:</b> ${otherUser}\n` +
             `💰 <b>Fee:</b> ${fee ? formatPoints(fee) : 0} points\n` +
             `🔗 <b>Transaction ID:</b> <code>${formattedHash}</code>\n\n` +
             `📝 <b>Note:</b> The recipient has been notified.`;
             
    case 'received':
      return `🎉 <b>Points Received!</b>\n\n` +
             `💎 <b>Amount:</b> ${formattedAmount} points\n` +
             `👤 <b>From:</b> ${otherUser}\n` +
             `🔗 <b>Transaction ID:</b> <code>${formattedHash}</code>\n\n` +
             `💰 Your balance has been updated automatically.`;
             
    case 'failed':
      return `❌ <b>Transfer Failed</b>\n\n` +
             `💸 <b>Amount:</b> ${formattedAmount} points\n` +
             `👤 <b>To:</b> ${otherUser}\n` +
             `🔗 <b>Transaction ID:</b> <code>${formattedHash}</code>\n\n` +
             `💡 Your points have been refunded.`;
             
    default:
      return 'Transfer notification';
  }
}

/**
 * Validate username format
 */
export function isValidUsername(username: string): boolean {
  // Telegram username rules: 5-32 characters, letters, digits, underscores
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
  return usernameRegex.test(username);
}

/**
 * Mask sensitive information in transfer logs
 */
export function maskTransferData(transfer: TransferRecord): Partial<TransferRecord> {
  return {
    ...transfer,
    metadata: transfer.metadata ? {
      ...transfer.metadata,
      senderIP: transfer.metadata.senderIP ? transfer.metadata.senderIP.replace(/\.\d+$/, '.***') : undefined,
      deviceFingerprint: transfer.metadata.deviceFingerprint ? transfer.metadata.deviceFingerprint.substring(0, 8) + '...' : undefined
    } : undefined
  };
}