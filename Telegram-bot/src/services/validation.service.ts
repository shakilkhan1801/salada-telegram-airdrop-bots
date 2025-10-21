/**
 * Unified Validation Service
 * Consolidates input-validation.ts, security/validation.ts, and input-validation.js
 * into a single, comprehensive validation system
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

// Core interfaces - merged from all validation systems
export interface ValidationSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url' | 'wallet' | 'telegram_id';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  allowedValues?: Array<string | number>;
  properties?: Record<string, ValidationSchema>;
  arrayItemType?: ValidationSchema;
  custom?: (value: any) => ValidationResult;
  sanitize?: (value: any) => any;
}

export interface ValidationResult {
  isValid: boolean;
  success?: boolean; // For backward compatibility
  data?: any;
  sanitized?: any;
  errors: string[];
  warnings?: string[];
  error?: string; // For backward compatibility
}

export interface SafeJSONResult<T = any> extends ValidationResult {
  data?: T | null;
}

export interface UserIDValidation {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

export interface FilePathValidation {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: ValidationSchema['type'];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => ValidationResult;
  sanitize?: (value: any) => any;
}

export interface SanitizationOptions {
  trimWhitespace?: boolean;
  removeHtml?: boolean;
  escapeHtml?: boolean;
  removeSqlInjection?: boolean;
  removeXss?: boolean;
  normalizeUnicode?: boolean;
}

/**
 * Unified Validation Service
 * Combines all validation functionality into a single service
 */
export class ValidationService {
  private static instance: ValidationService;
  private readonly logger = Logger.getInstance();
  
  // Constants from original validators
  private static readonly MAX_JSON_SIZE = 1024 * 1024; // 1MB limit
  private static readonly USER_ID_PATTERN = /^[0-9]+$/;
  private static readonly SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
  private static readonly PATH_TRAVERSAL_PATTERN = /\.\.|\/\.\.|\.\.\/|\\\.\.|\.\.\\/;
  private static readonly EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly URL_PATTERN = /^https?:\/\/.+/;
  private static readonly TELEGRAM_ID_PATTERN = /^[0-9]{1,15}$/;
  private static readonly WALLET_PATTERN = /^(0x[a-fA-F0-9]{40}|[A-Za-z0-9_-]{48,66})$/;

  private constructor() {}

  public static getInstance(): ValidationService {
    if (!ValidationService.instance) {
      ValidationService.instance = new ValidationService();
    }
    return ValidationService.instance;
  }

  /**
   * Validate data against a set of rules
   * Merged from security/validation.ts
   */
  validate(data: any, rules: ValidationRule[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitized: any = {};

    for (const rule of rules) {
      const value = data[rule.field];
      const fieldResult = this.validateField(value, rule);

      if (!fieldResult.isValid) {
        errors.push(...fieldResult.errors);
      }

      if (fieldResult.warnings) {
        warnings.push(...fieldResult.warnings);
      }

      if (fieldResult.sanitized !== undefined) {
        sanitized[rule.field] = fieldResult.sanitized;
      }
    }

    return {
      isValid: errors.length === 0,
      success: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
      sanitized
    };
  }

  /**
   * Validate individual field against a rule
   */
  private validateField(value: any, rule: ValidationRule): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitized = value;

    // Required field check
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${rule.field} is required`);
      return { isValid: false, errors };
    }

    // Skip validation for optional empty values
    if (!rule.required && (value === undefined || value === null || value === '')) {
      return { isValid: true, errors: [], sanitized: undefined };
    }

    // Type validation
    if (rule.type) {
      const typeResult = this.validateType(value, rule.type);
      if (!typeResult.isValid) {
        errors.push(`${rule.field}: ${typeResult.errors.join(', ')}`);
      }
      if (typeResult.sanitized !== undefined) {
        sanitized = typeResult.sanitized;
      }
    }

    // Length validation for strings
    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`${rule.field} must be at least ${rule.minLength} characters`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`${rule.field} must not exceed ${rule.maxLength} characters`);
      }
    }

    // Numeric range validation
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`${rule.field} must be at least ${rule.min}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`${rule.field} must not exceed ${rule.max}`);
      }
    }

    // Pattern validation
    if (rule.pattern && typeof value === 'string') {
      if (!rule.pattern.test(value)) {
        errors.push(`${rule.field} format is invalid`);
      }
    }

    // Custom validation
    if (rule.custom) {
      const customResult = rule.custom(value);
      if (!customResult.isValid) {
        errors.push(...customResult.errors);
      }
      if (customResult.warnings) {
        warnings.push(...customResult.warnings);
      }
    }

    // Sanitization
    if (rule.sanitize) {
      sanitized = rule.sanitize(value);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
      sanitized
    };
  }

  /**
   * Validate value type
   */
  private validateType(value: any, type: ValidationSchema['type']): ValidationResult {
    const errors: string[] = [];
    let sanitized = value;

    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push('must be a string');
        }
        break;

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push('must be a valid number');
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push('must be a boolean');
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          errors.push('must be an array');
        }
        break;

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push('must be an object');
        }
        break;

      case 'email':
        if (typeof value !== 'string' || !ValidationService.EMAIL_PATTERN.test(value)) {
          errors.push('must be a valid email address');
        } else {
          sanitized = value.toLowerCase().trim();
        }
        break;

      case 'url':
        if (typeof value !== 'string' || !ValidationService.URL_PATTERN.test(value)) {
          errors.push('must be a valid URL');
        }
        break;

      case 'telegram_id':
        if (!ValidationService.TELEGRAM_ID_PATTERN.test(String(value))) {
          errors.push('must be a valid Telegram ID');
        } else {
          sanitized = String(value);
        }
        break;

      case 'wallet':
        if (typeof value !== 'string' || !ValidationService.WALLET_PATTERN.test(value)) {
          errors.push('must be a valid wallet address');
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Safely parse JSON with size limits and validation
   * Merged from input-validation.ts
   */
  public safeJSONParse<T = any>(
    jsonString: string,
    schemaOrFallback?: ValidationSchema | T,
    maxSize: number = ValidationService.MAX_JSON_SIZE
  ): SafeJSONResult<T> {
    const isSchema = (obj: any): obj is ValidationSchema => !!obj && typeof obj === 'object' && 'type' in obj;
    const fallback = schemaOrFallback && !isSchema(schemaOrFallback) ? (schemaOrFallback as T) : undefined;
    const schema = isSchema(schemaOrFallback) ? (schemaOrFallback as ValidationSchema) : undefined;

    try {
      // Check size limit
      if (jsonString.length > maxSize) {
        return {
          isValid: false,
          success: false,
          data: null,
          errors: ['JSON string exceeds size limit'],
          error: 'JSON string exceeds size limit'
        };
      }

      // Parse JSON
      const parsed = JSON.parse(jsonString);

      // Validate against schema if provided
      if (schema) {
        const validation = this.validateAgainstSchema(parsed, schema);
        if (!validation.isValid) {
          return {
            isValid: false,
            success: false,
            data: fallback ?? null,
            errors: validation.errors,
            error: validation.errors.join(', ')
          };
        }
        
        return {
          isValid: true,
          success: true,
          data: (validation.sanitized || parsed) as T,
          errors: []
        };
      }

      return {
        isValid: true,
        success: true,
        data: parsed as T,
        errors: []
      };

    } catch (error) {
      return {
        isValid: false,
        success: false,
        data: fallback ?? null,
        errors: ['Invalid JSON format'],
        error: 'Invalid JSON format'
      };
    }
  }

  /**
   * Safely read and parse JSON file
   */
  public safeJSONReadFile<T = any>(filePath: string, schema?: ValidationSchema): SafeJSONResult<T> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      return this.safeJSONParse<T>(fileContent, schema);
    } catch (error) {
      return {
        isValid: false,
        success: false,
        errors: ['Failed to read file'],
        error: 'Failed to read file'
      };
    }
  }

  /**
   * Validate user ID
   * Merged from input-validation.ts
   */
  public validateUserID(userId: string | number | undefined | null): UserIDValidation {
    if (userId === undefined || userId === null) {
      return { valid: false, error: 'User ID is required' };
    }

    const userIdStr = String(userId);
    
    if (!ValidationService.USER_ID_PATTERN.test(userIdStr)) {
      return { valid: false, error: 'Invalid user ID format' };
    }

    return { valid: true, sanitized: userIdStr };
  }

  /**
   * Validate file path for security
   * Merged from input-validation.ts
   */
  public validateFilePath(filePath: string): FilePathValidation {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: 'File path is required' };
    }

    // Check for path traversal attacks
    if (ValidationService.PATH_TRAVERSAL_PATTERN.test(filePath)) {
      return { valid: false, error: 'Path traversal detected' };
    }

    // Extract filename and validate
    const filename = path.basename(filePath);
    if (!ValidationService.SAFE_FILENAME_PATTERN.test(filename)) {
      return { valid: false, error: 'Invalid filename format' };
    }

    return { valid: true, sanitized: path.normalize(filePath) };
  }

  /**
   * Safe integer parsing
   * Merged from input-validation.ts
   */
  public safeParseInt(
    value: any,
    min: number = Number.MIN_SAFE_INTEGER,
    max: number = Number.MAX_SAFE_INTEGER,
    defaultValue?: number
  ): { success: boolean; valid: boolean; value?: number; error?: string } {
    if (value === undefined || value === null || value === '') {
      if (defaultValue !== undefined) {
        return { success: true, valid: true, value: defaultValue };
      }
      return { success: false, valid: false, error: 'Value is required' };
    }

    const parsed = parseInt(String(value), 10);
    
    if (isNaN(parsed)) {
      if (defaultValue !== undefined) {
        return { success: true, valid: true, value: defaultValue };
      }
      return { success: false, valid: false, error: 'Invalid number format' };
    }

    if (parsed < min || parsed > max) {
      return { success: false, valid: false, error: `Number must be between ${min} and ${max}` };
    }

    return { success: true, valid: true, value: parsed };
  }

  /**
   * Safe regex compilation
   * Merged from input-validation.ts
   */
  public safeRegex(pattern: string, flags?: string): RegExp | null {
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      this.logger.warn('Invalid regex pattern', { pattern, error });
      return null;
    }
  }

  /**
   * Validate against schema (recursive)
   */
  private validateAgainstSchema(data: any, schema: ValidationSchema): ValidationResult {
    const errors: string[] = [];
    let sanitized = data;

    // Type validation
    const typeResult = this.validateSchemaType(data, schema);
    if (!typeResult.isValid) {
      errors.push(...typeResult.errors);
    } else if (typeResult.sanitized !== undefined) {
      sanitized = typeResult.sanitized;
    }

    // Additional validations based on type
    if (schema.type === 'string' && typeof data === 'string') {
      if (schema.minLength && data.length < schema.minLength) {
        errors.push(`String must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength && data.length > schema.maxLength) {
        errors.push(`String must not exceed ${schema.maxLength} characters`);
      }
      if (schema.pattern && !schema.pattern.test(data)) {
        errors.push('String format is invalid');
      }
      if (schema.allowedValues && !schema.allowedValues.includes(data)) {
        errors.push(`Value must be one of: ${schema.allowedValues.join(', ')}`);
      }
    }

    if (schema.type === 'number' && typeof data === 'number') {
      if (schema.min !== undefined && data < schema.min) {
        errors.push(`Number must be at least ${schema.min}`);
      }
      if (schema.max !== undefined && data > schema.max) {
        errors.push(`Number must not exceed ${schema.max}`);
      }
      if (schema.allowedValues && !schema.allowedValues.includes(data)) {
        errors.push(`Value must be one of: ${schema.allowedValues.join(', ')}`);
      }
    }

    // Object validation
    if (schema.type === 'object' && schema.properties && typeof data === 'object' && data !== null) {
      const objectSanitized: any = {};
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        const propertyResult = this.validateAgainstSchema(data[key], propertySchema);
        if (!propertyResult.isValid) {
          errors.push(...propertyResult.errors.map(err => `${key}: ${err}`));
        } else if (propertyResult.sanitized !== undefined) {
          objectSanitized[key] = propertyResult.sanitized;
        } else {
          objectSanitized[key] = data[key];
        }
      }
      if (Object.keys(objectSanitized).length > 0) {
        sanitized = objectSanitized;
      }
    }

    // Array validation
    if (schema.type === 'array' && schema.arrayItemType && Array.isArray(data)) {
      const arraySanitized: any[] = [];
      for (let i = 0; i < data.length; i++) {
        const itemResult = this.validateAgainstSchema(data[i], schema.arrayItemType);
        if (!itemResult.isValid) {
          errors.push(...itemResult.errors.map(err => `[${i}]: ${err}`));
        } else {
          arraySanitized.push(itemResult.sanitized !== undefined ? itemResult.sanitized : data[i]);
        }
      }
      if (arraySanitized.length > 0) {
        sanitized = arraySanitized;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined
    };
  }

  private validateSchemaType(data: any, schema: ValidationSchema): ValidationResult {
    return this.validateType(data, schema.type);
  }

  /**
   * Validate Telegram WebApp data
   * Merged from security/validation.ts
   */
  public validateTelegramWebAppData(initData: string): boolean {
    try {
      const params = new URLSearchParams(initData);
      const receivedHash = params.get('hash');
      if (!receivedHash) return false;

      params.delete('hash');

      // Build data check string from sorted key=value pairs
      const dataPairs: string[] = [];
      Array.from(params.keys())
        .sort()
        .forEach((key) => {
          const value = params.get(key) ?? '';
          dataPairs.push(`${key}=${value}`);
        });
      const dataCheckString = dataPairs.join('\n');

      // Compute secret key: sha256 of bot token
      const { getConfig } = require('../config');
      const botToken: string = getConfig().bot.token;
      const crypto = require('crypto');
      const secretKey = crypto.createHash('sha256').update(botToken).digest();

      // Compute HMAC-SHA256 of dataCheckString
      const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      return hmac === receivedHash;
    } catch (error) {
      this.logger.error('Telegram WebApp data validation failed:', error);
      return false;
    }
  }

  /**
   * Sanitize string input
   * Merged from security/validation.ts
   */
  public sanitizeString(input: string, options: SanitizationOptions = {}): string {
    let sanitized = input;

    if (options.trimWhitespace !== false) {
      sanitized = sanitized.trim();
    }

    if (options.removeHtml) {
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }

    if (options.escapeHtml) {
      sanitized = sanitized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    if (options.removeSqlInjection) {
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
        /(\b(UNION|OR|AND)\s+\d+\s*=\s*\d+)/gi,
        /('|\"|;|--|\|\|)/g
      ];
      
      for (const pattern of sqlPatterns) {
        sanitized = sanitized.replace(pattern, '');
      }
    }

    if (options.removeXss) {
      const xssPatterns = [
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe[^>]*>.*?<\/iframe>/gi
      ];
      
      for (const pattern of xssPatterns) {
        sanitized = sanitized.replace(pattern, '');
      }
    }

    if (options.normalizeUnicode) {
      sanitized = sanitized.normalize('NFC');
    }

    return sanitized;
  }

  // Backward-compatible helpers expected by older tests
  public sanitizeInput(input: any, options?: { preserveBasicHTML?: boolean; maxLength?: number; trim?: boolean }): string {
    let str = '';
    if (input === null || input === undefined) return '';
    if (typeof input !== 'string') {
      str = String(input);
    } else {
      str = input;
    }

    // Trim if requested
    if (options?.trim) str = str.trim();

    // Apply maxLength if provided
    if (typeof options?.maxLength === 'number' && options.maxLength >= 0) {
      str = str.slice(0, options.maxLength);
    }

    if (options?.preserveBasicHTML) {
      // Remove script/style and dangerous attributes but keep basic formatting tags
      str = str.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
               .replace(/ on\w+\s*=\s*"[^"]*"/gi, '')
               .replace(/ on\w+\s*=\s*'[^']*'/gi, '')
               .replace(/ javascript:/gi, '');
      // Strip all tags except a small allowlist
      const allowed = ['b', 'strong', 'i', 'em', 'u'];
      str = str.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (match, tag) => {
        return allowed.includes(String(tag).toLowerCase()) ? match : '';
      });
      return str;
    }

    // Otherwise remove all HTML
    return this.sanitizeString(str, { removeHtml: true, trimWhitespace: options?.trim !== false });
  }

  public isValidTelegramId(value: any): boolean {
    if (value === null || value === undefined) return false;
    const str = String(value);
    return ValidationService.TELEGRAM_ID_PATTERN.test(str) && str !== '0';
  }

  public isValidUsername(value: any): boolean {
    if (typeof value !== 'string') return false;
    const str = value.trim();
    if (str.length < 3 || str.length > 32) return false;
    // Must start with a letter, then letters/numbers/underscore
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(str);
  }

  public isValidWalletAddress(value: any): boolean {
    if (typeof value !== 'string') return false;
    return ValidationService.WALLET_PATTERN.test(value);
  }

  public isValidPoints(value: any): boolean {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
  }

  public safeRegexTest(regex: RegExp, input: string, timeoutMs: number = 1000): boolean {
    // Heuristic: detect nested quantifiers which often cause catastrophic backtracking
    const src = regex.source;
    // Simple, robust heuristics to avoid catastrophic patterns without complex regex parsing
    const nestedQuantifier = /\([^)]*[+*][^)]*\)[+*]/;
    const dotStarPlus = /\.\*[+*]/;
    const dotPlusPlus = /\.\+[+*]/;
    if (nestedQuantifier.test(src)) {
      return false;
    }
    try {
      // Fast test path; we don't actually enforce a timeout in single-threaded JS
      return regex.test(input);
    } catch {
      return false;
    }
  }

  // Express-style middleware for request validation using Joi-like schemas
  public validateRequest(schema: any, source: 'body' | 'query' | 'params' = 'body') {
    return async (req: any, res: any, next: any): Promise<void> => {
      try {
        let value: any = req?.[source];
        if (schema && typeof schema.validate === 'function') {
          const result = schema.validate(value, { abortEarly: false, convert: true });
          if (result.error) {
            res.status?.(400);
            res.json?.({ success: false, error: 'Validation Error', details: result.error.details?.map((d: any) => d.message) });
            return;
          }
          value = result.value;
        }
        if (req && source) req[source] = value;
        next?.();
      } catch {
        res.status?.(400);
        res.json?.({ success: false, error: 'Validation Error' });
      }
    };
  }

  public validateLength(input: any, min: number, max: number): boolean {
    if (typeof input !== 'string') return false;
    const len = input.length;
    return len >= min && len <= max;
  }

  public isWithinBounds(value: any, min: number, max: number): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }
}

// Common validation schemas - merged from input-validation.ts
export const CommonSchemas = {
  userId: {
    type: 'telegram_id' as const,
    required: true
  },
  
  messageText: {
    type: 'string' as const,
    required: true,
    minLength: 1,
    maxLength: 4096
  },
  
  username: {
    type: 'string' as const,
    required: true,
    minLength: 3,
    maxLength: 32,
    pattern: /^[a-zA-Z0-9_]+$/
  },
  
  email: {
    type: 'email' as const,
    required: true
  },
  
  walletAddress: {
    type: 'wallet' as const,
    required: true
  },
  
  pagination: {
    type: 'object' as const,
    properties: {
      page: {
        type: 'number' as const,
        min: 1,
        max: 1000
      },
      limit: {
        type: 'number' as const,
        min: 1,
        max: 500
      }
    }
  }
};

// Singleton instance
export const validationService = ValidationService.getInstance();

// Convenience functions for backward compatibility
export function safeJSONParse<T = any>(jsonString: string, schema?: ValidationSchema): SafeJSONResult<T> {
  return validationService.safeJSONParse<T>(jsonString, schema);
}

export function safeJSONReadFile<T = any>(filePath: string, schema?: ValidationSchema): SafeJSONResult<T> {
  return validationService.safeJSONReadFile<T>(filePath, schema);
}

export function validateUserID(userId: string | number | undefined | null): UserIDValidation {
  return validationService.validateUserID(userId);
}

export function validateFilePath(filePath: string): FilePathValidation {
  return validationService.validateFilePath(filePath);
}

export function safeParseInt(
  value: any,
  min?: number,
  max?: number,
  defaultValue?: number
): { success: boolean; valid: boolean; value?: number; error?: string } {
  return validationService.safeParseInt(value, min, max, defaultValue);
}

export function safeRegex(pattern: string, flags?: string): RegExp | null {
  return validationService.safeRegex(pattern, flags);
}

export function validateTelegramWebAppData(initData: string): boolean {
  return validationService.validateTelegramWebAppData(initData);
}

// Export the service instance as default for easy import
export default validationService;

// Legacy compatibility exports
export const validator = validationService;
export const Validator = ValidationService;