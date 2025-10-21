export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
  requestId?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  code?: string | number;
  details?: Record<string, any>;
  timestamp: string;
  requestId?: string;
}

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
  requestId?: string;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  rule?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitized?: any;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface TimeRange {
  from: number;
  to: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeoLocation {
  country: string;
  region?: string;
  city?: string;
  coordinates?: Coordinates;
  timezone?: string;
  isp?: string;
  organization?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export interface CacheInfo {
  key: string;
  ttl: number;
  size?: number;
  hitCount?: number;
  missCount?: number;
}

export interface LogLevel {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  timestamp: string;
  message: string;
  metadata?: Record<string, any>;
  correlationId?: string;
}

export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  duration: number;
  details?: Record<string, any>;
}

export interface EventEmitter<T = any> {
  on(event: string, listener: (data: T) => void): void;
  emit(event: string, data: T): void;
  off(event: string, listener: (data: T) => void): void;
  once(event: string, listener: (data: T) => void): void;
}

export interface Queue<T> {
  enqueue(item: T): Promise<void>;
  dequeue(): Promise<T | null>;
  peek(): Promise<T | null>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

export interface Cache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

export interface Metrics {
  name: string;
  value: number;
  unit: string;
  timestamp: string;
  tags?: Record<string, string>;
}

export interface Performance {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface Feature {
  name: string;
  enabled: boolean;
  rolloutPercentage?: number;
  conditions?: Record<string, any>;
}

export interface Config {
  environment: 'development' | 'staging' | 'production';
  debug: boolean;
  features: Record<string, Feature>;
  limits: Record<string, number>;
  timeouts: Record<string, number>;
}

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  data?: Record<string, any>;
  timestamp: string;
  read: boolean;
  expiresAt?: string;
}

export interface FileInfo {
  filename: string;
  size: number;
  mimeType: string;
  path: string;
  url?: string;
  checksum?: string;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface ImageInfo extends FileInfo {
  width: number;
  height: number;
  format: string;
  thumbnails?: {
    small: string;
    medium: string;
    large: string;
  };
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  nextRun: string;
  metadata?: Record<string, any>;
}

export interface WebhookPayload {
  event: string;
  data: any;
  timestamp: string;
  signature: string;
  version: string;
}

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  version: string;
  uptime: number;
  memory: number;
  cpu: number;
  lastChecked: string;
}