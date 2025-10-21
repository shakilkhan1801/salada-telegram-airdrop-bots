/**
 * Security Utilities
 * Common security validation functions
 */

import * as crypto from 'crypto';

export class SecurityUtils {
  
  /**
   * Generate a secure random token
   */
  static generateSecureToken(length: number = 8): string {
    try {
      const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789'; // Removed confusing characters
      let result = '';
      
      for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        result += chars[randomIndex];
      }
      
      return result;
    } catch (error) {
      // Fallback if crypto is not available
      const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
      let result = '';
      
      for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
      }
      
      return result;
    }
  }

  /**
   * Generate a secure UUID
   */
  static generateUUID(): string {
    try {
      return crypto.randomUUID();
    } catch (error) {
      // Fallback UUID generation
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  }
  
  /**
   * Validate points amount for security
   */
  static validatePoints(amount: number): { isValid: boolean; error?: string; sanitizedAmount: number } {
    try {
      // Convert to number if it's a string
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      
      // Check if it's a valid number
      if (isNaN(numAmount) || !isFinite(numAmount)) {
        return {
          isValid: false,
          error: 'Invalid points amount: not a number',
          sanitizedAmount: 0
        };
      }
      
      // Check for negative amounts
      if (numAmount < 0) {
        return {
          isValid: false,
          error: 'Invalid points amount: cannot be negative',
          sanitizedAmount: 0
        };
      }
      
      // Check for unreasonably high amounts (security measure)
      const MAX_POINTS = 100000;
      if (numAmount > MAX_POINTS) {
        return {
          isValid: false,
          error: `Invalid points amount: exceeds maximum allowed (${MAX_POINTS})`,
          sanitizedAmount: 0
        };
      }
      
      // Round to avoid floating point issues
      const sanitizedAmount = Math.round(numAmount * 100) / 100;
      
      return {
        isValid: true,
        sanitizedAmount
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        sanitizedAmount: 0
      };
    }
  }

  /**
   * Validate user ID
   */
  static validateUserId(userId: string | number): { isValid: boolean; error?: string; sanitizedId: string } {
    try {
      const stringId = String(userId);
      
      if (!stringId || stringId.trim() === '') {
        return {
          isValid: false,
          error: 'User ID cannot be empty',
          sanitizedId: ''
        };
      }
      
      // Check for valid Telegram user ID pattern (numeric)
      if (!/^\d+$/.test(stringId)) {
        return {
          isValid: false,
          error: 'Invalid user ID format',
          sanitizedId: ''
        };
      }
      
      return {
        isValid: true,
        sanitizedId: stringId
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        sanitizedId: ''
      };
    }
  }

  /**
   * Sanitize text input
   */
  static sanitizeText(text: string, maxLength: number = 1000): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    return text
      .trim()
      .slice(0, maxLength)
      .replace(/[<>]/g, '') // Remove basic HTML tags
      .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, ''); // Remove control characters
  }

  /**
   * Validate and sanitize referral code
   */
  static validateReferralCode(code: string): { isValid: boolean; error?: string; sanitizedCode: string } {
    try {
      if (!code || typeof code !== 'string') {
        return {
          isValid: false,
          error: 'Referral code must be a string',
          sanitizedCode: ''
        };
      }
      
      const sanitized = code.trim().toUpperCase();
      
      // Check length (typically 6-12 characters)
      if (sanitized.length < 4 || sanitized.length > 20) {
        return {
          isValid: false,
          error: 'Referral code must be 4-20 characters long',
          sanitizedCode: ''
        };
      }
      
      // Check for valid characters (alphanumeric only)
      if (!/^[A-Z0-9]+$/.test(sanitized)) {
        return {
          isValid: false,
          error: 'Referral code can only contain letters and numbers',
          sanitizedCode: ''
        };
      }
      
      return {
        isValid: true,
        sanitizedCode: sanitized
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        sanitizedCode: ''
      };
    }
  }
}