export interface StorageAdapter {
  initialize(): Promise<void>;
  get<T>(collection: string, id?: string): Promise<T | null>;
  set<T>(collection: string, data: T, id?: string): Promise<boolean>;
  update<T>(collection: string, updates: Partial<T>, id?: string): Promise<boolean>;
  delete(collection: string, id?: string): Promise<boolean>;
  exists(collection: string, id?: string): Promise<boolean>;
  list(collection?: string): Promise<string[]>;
  backup(backupPath?: string): Promise<string>;
  restore(backupPath: string): Promise<boolean>;
  getStats(): Promise<StorageStats>;
  cleanup(): Promise<CleanupResult>;
  close(): Promise<void>;
}

export interface StorageConfig {
  type: StorageType;
  file?: FileStorageConfig;

  mongodb?: MongoStorageConfig;
}

export type StorageType = 'file' | 'mongodb';

export interface FileStorageConfig {
  basePath: string;
  batchSize: number;
  backupRetention: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  encryptionKey?: string;
}



export interface MongoStorageConfig {
  url: string;
  database: string;
  options: {
    useUnifiedTopology: boolean;
    useNewUrlParser: boolean;
    serverApi: any;
    retryWrites: boolean;
    w: string;
  };
  collections: Record<string, MongoCollectionConfig>;
}

export interface MongoCollectionConfig {
  name: string;
  indexes: MongoIndexConfig[];
  schema?: any;
  options?: any;
}

export interface MongoIndexConfig {
  fields: Record<string, number | string>;
  options?: {
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    expireAfterSeconds?: number;
    name?: string;
  };
}

export interface StorageStats {
  type: StorageType;
  collections: CollectionStats[];
  totalSize: number;
  totalDocuments: number;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  performance: PerformanceStats;
  health: HealthStats;
}

export interface CollectionStats {
  name: string;
  documentCount: number;
  sizeBytes: number;
  indexes?: IndexStats[];
  lastModified: string;
}

export interface IndexStats {
  name: string;
  keys: Record<string, number>;
  unique: boolean;
  sparse: boolean;
  size: number;
}

export interface PerformanceStats {
  readLatency: number;
  writeLatency: number;
  throughput: {
    reads: number;
    writes: number;
  };
  cacheHitRate?: number;
  connectionPoolUsage?: number;
}

export interface HealthStats {
  uptime: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastChecked: string;
  errors: ErrorStats[];
}

export interface ErrorStats {
  type: string;
  count: number;
  lastOccurred: string;
  message: string;
}

export interface CleanupResult {
  deletedItems: number;
  freedSpace: number;
  duration: number;
  errors: string[];
  details: Record<string, any>;
}

export interface BackupMetadata {
  timestamp: string;
  version: string;
  storageType: StorageType;
  collections: string[];
  totalSize: number;
  compression: boolean;
  encryption: boolean;
  checksum: string;
}

export interface RestoreOptions {
  overwriteExisting: boolean;
  selectiveRestore: string[];
  validateChecksum: boolean;
  createBackupBefore: boolean;
}

export interface StorageTransaction {
  id: string;
  operations: StorageOperation[];
  status: 'pending' | 'committed' | 'aborted';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface StorageOperation {
  type: 'create' | 'update' | 'delete';
  collection: string;
  id?: string;
  data?: any;
  conditions?: any;
}

export interface StorageQuery {
  collection: string;
  filter?: Record<string, any>;
  projection?: Record<string, number>;
  sort?: Record<string, number>;
  limit?: number;
  skip?: number;
}

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    executionTime: number;
    affectedRows?: number;
    insertedId?: string;
  };
}