import path from 'path';
import fs from 'fs-extra';
import { config } from '../config';
import { logger } from './logger';

export type LogStreamType = 'app' | 'error';

export interface LogEntry {
  timestamp: string | null;
  level: string;
  message: string;
  context?: Record<string, any>;
  raw: Record<string, any>;
}

export interface LogQueryOptions {
  type?: LogStreamType;
  levels?: string[];
  limit?: number;
  search?: string;
  since?: Date;
}

export interface LogQueryResult {
  entries: LogEntry[];
  hasMore: boolean;
  fileSize: number;
  updatedAt: string | null;
  file: string;
}

const FILE_MAP: Record<LogStreamType, string> = {
  app: 'app.log',
  error: 'error.log',
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const parseLine = (line: string) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const normalizeTimestamp = (value: any): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const buildEntry = (data: Record<string, any>): LogEntry => {
  const { timestamp, level, message, ...rest } = data;
  const normalizedTimestamp = normalizeTimestamp(timestamp || rest?.timestamp || rest?.meta?.timestamp);
  const normalizedLevel = typeof level === 'string' ? level.toLowerCase() : 'info';
  const text = typeof message === 'string' ? message : JSON.stringify(message ?? rest?.message ?? '');
  const context = { ...rest };
  return {
    timestamp: normalizedTimestamp,
    level: normalizedLevel,
    message: text,
    context,
    raw: data,
  };
};

const getLogFilePath = (type: LogStreamType) => {
  const fileName = FILE_MAP[type];
  return path.resolve(config.paths.logs, fileName);
};

export const fetchLogs = async (options: LogQueryOptions = {}): Promise<LogQueryResult> => {
  const type = options.type ?? 'app';
  const filePath = getLogFilePath(type);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const levels = (options.levels || ['info', 'warn', 'error']).map((lvl) => lvl.toLowerCase());
  const levelSet = new Set(levels);
  const search = options.search?.trim().toLowerCase();
  const since = options.since instanceof Date && !Number.isNaN(options.since.getTime()) ? options.since : null;

  const exists = await fs.pathExists(filePath);
  if (!exists) {
    return {
      entries: [],
      hasMore: false,
      fileSize: 0,
      updatedAt: null,
      file: filePath,
    };
  }

  const [raw, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const matches: LogEntry[] = [];
  let hasMore = false;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseLine(lines[i]);
    if (!parsed) continue;
    const entry = buildEntry(parsed);
    if (!levelSet.has(entry.level)) continue;
    if (since && entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (ts.getTime() < since.getTime()) continue;
    }
    if (search) {
      const blob = `${entry.message} ${JSON.stringify(entry.raw)}`.toLowerCase();
      if (!blob.includes(search)) continue;
    }
    if (matches.length >= limit) {
      hasMore = true;
      break;
    }
    matches.push(entry);
  }

  const entries = matches
    .slice(0, limit)
    .sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

  return {
    entries,
    hasMore,
    fileSize: stats.size,
    updatedAt: stats.mtime.toISOString(),
    file: filePath,
  };
};

export const resolveLogFile = (type: LogStreamType = 'app') => ({
  path: getLogFilePath(type),
  name: FILE_MAP[type],
});

export const deleteLogs = async (type: LogStreamType, timestamps: string[]): Promise<{ deleted: number }> => {
  const filePath = getLogFilePath(type);
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    return { deleted: 0 };
  }

  if (timestamps.length === 0) {
    logger.warn('deleteLogs called with empty timestamps array');
    return { deleted: 0 };
  }

  // Create a map of timestamp -> count to handle multiple entries with same timestamp
  const timestampCounts = new Map<string, number>();
  for (const ts of timestamps) {
    const isoTs = new Date(ts).toISOString();
    timestampCounts.set(isoTs, (timestampCounts.get(isoTs) || 0) + 1);
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const kept: string[] = [];
  let deleted = 0;

  // Process in reverse order (newest first) to match frontend display order
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const parsed = parseLine(line);
    if (!parsed) {
      kept.unshift(line); // Add to beginning to maintain order
      continue;
    }
    
    const entry = buildEntry(parsed);
    if (entry.timestamp) {
      const count = timestampCounts.get(entry.timestamp);
      if (count && count > 0) {
        // Delete this entry and decrement the count
        timestampCounts.set(entry.timestamp, count - 1);
        deleted += 1;
        logger.debug(`Deleted log entry at ${entry.timestamp}: ${entry.message.substring(0, 50)}`);
        continue;
      }
    }
    kept.unshift(line); // Add to beginning to maintain order
  }

  await fs.writeFile(filePath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  logger.info(`Deleted ${deleted} log entries from ${type}.log, kept ${kept.length} entries`);
  return { deleted };
};
