import { Logger } from './logger';
import { nanoid } from './id';
import { StorageManager } from '../storage';

export interface JobData {
  id: string;
  type: string;
  payload: any;
  priority?: number;
  attempts?: number;
  delay?: number;
  metadata?: any;
}

export interface JobResult {
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;
  metadata?: any;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface JobDocument {
  id: string;
  queue: string;
  data: Omit<JobData, 'id'>;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  createdAt: Date;
  availableAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  returnvalue?: any;
  failedReason?: string;
}

export class AsyncJobQueueService {
  private static instance: AsyncJobQueueService;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private isInitialized = false;

  private processors = new Map<string, Array<(job: { id: string; data: JobData }) => Promise<JobResult>>>();
  private workerLoops = new Map<string, NodeJS.Timeout[]>();

  private constructor() {}

  static getInstance(): AsyncJobQueueService {
    if (!AsyncJobQueueService.instance) {
      AsyncJobQueueService.instance = new AsyncJobQueueService();
    }
    return AsyncJobQueueService.instance;
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.logger.info('AsyncJobQueueService initialized (Mongo-backed)');
  }

  private getJobsCollection(): any {
    const base = this.storage.getStorageInstance() as any;
    if (!base || typeof base.getRawCollection !== 'function') {
      throw new Error('MongoStorage raw collection access not available');
    }
    return base.getRawCollection('jobs');
  }

  async createQueue(queueName: string): Promise<any> {
    if (!this.processors.has(queueName)) {
      this.processors.set(queueName, []);
    }
    return { name: queueName };
  }

  async createWorker(
    queueName: string,
    processor: (job: { id: string; data: JobData }) => Promise<JobResult>,
    options: any = {}
  ): Promise<any> {
    await this.createQueue(queueName);
    this.processors.get(queueName)!.push(processor);

    const concurrency = Math.max(1, Math.min(10, options.concurrency || 1));
    const loops: NodeJS.Timeout[] = [];

    for (let i = 0; i < concurrency; i++) {
      const loop = setImmediate(async () => {
        await this.workerLoop(queueName, processor).catch((e) => this.logger.error('Worker loop error:', e));
      }) as unknown as NodeJS.Timeout;
      loops.push(loop);
    }

    this.workerLoops.set(queueName, loops);
    const workerId = `${queueName}-worker-${nanoid(8)}`;
    this.logger.info(`Worker registered (Mongo-backed): ${workerId} for queue ${queueName}`);
    return {
      id: workerId,
      close: async () => {
        const ls = this.workerLoops.get(queueName) || [];
        ls.forEach((t) => clearTimeout(t));
        this.workerLoops.delete(queueName);
      }
    };
  }

  private async workerLoop(queueName: string, processor: (job: { id: string; data: JobData }) => Promise<JobResult>): Promise<void> {
    const coll = this.getJobsCollection();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const now = new Date();
        const claim = await coll.findOneAndUpdate(
          { queue: queueName, status: 'waiting', availableAt: { $lte: now } },
          { $set: { status: 'active', startedAt: now } },
          { sort: { priority: -1, availableAt: 1, createdAt: 1 }, returnDocument: 'after' }
        );

        const job: JobDocument | null = claim?.value || null;
        if (!job) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        const started = Date.now();
        try {
          const result = await processor({ id: job.id, data: { id: job.id, ...job.data } as JobData });
          const duration = Date.now() - started;
          await coll.updateOne(
            { id: job.id },
            { $set: { status: result.success ? 'completed' : 'failed', finishedAt: new Date(), returnvalue: result.result, failedReason: result.success ? undefined : (result.error || 'Job failed'), duration } }
          );
        } catch (err: any) {
          await coll.updateOne(
            { id: job.id },
            { $set: { status: 'failed', finishedAt: new Date(), failedReason: err?.message || String(err) } }
          );
        }
      } catch (err) {
        this.logger.error('Job loop iteration error:', err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async addJob(
    queueName: string,
    jobData: Omit<JobData, 'id'>,
    _options: any = {}
  ): Promise<string> {
    await this.createQueue(queueName);
    const coll = this.getJobsCollection();
    const id = nanoid(12);
    const now = new Date();
    const availableAt = new Date(Date.now() + (jobData.delay || 0));
    const doc: JobDocument = {
      id,
      queue: queueName,
      data: jobData,
      status: 'waiting',
      priority: jobData.priority ?? 1,
      attempts: jobData.attempts ?? 1,
      createdAt: now,
      availableAt
    };
    await coll.insertOne(doc as any);
    return id;
  }

  async addBulkJobs(
    queueName: string,
    jobsData: Array<Omit<JobData, 'id'>>,
    _options: any = {}
  ): Promise<string[]> {
    const coll = this.getJobsCollection();
    const now = new Date();
    const docs: JobDocument[] = jobsData.map((data) => ({
      id: nanoid(12),
      queue: queueName,
      data,
      status: 'waiting',
      priority: data.priority ?? 1,
      attempts: data.attempts ?? 1,
      createdAt: now,
      availableAt: new Date(Date.now() + (data.delay || 0))
    }));
    if (docs.length > 0) await coll.insertMany(docs as any);
    return docs.map((d) => d.id);
  }

  async getJob(queueName: string, jobId: string): Promise<{
    isCompleted: () => Promise<boolean>;
    isFailed: () => Promise<boolean>;
    returnvalue?: any;
    failedReason?: string;
    id: string;
  } | null> {
    const coll = this.getJobsCollection();
    const doc: JobDocument | null = await coll.findOne({ id: jobId, queue: queueName });
    if (!doc) return null;
    return {
      id: doc.id,
      returnvalue: doc.returnvalue,
      failedReason: doc.failedReason,
      isCompleted: async () => {
        const d = await coll.findOne({ id: jobId }, { projection: { status: 1 } });
        return !!d && d.status === 'completed';
      },
      isFailed: async () => {
        const d = await coll.findOne({ id: jobId }, { projection: { status: 1 } });
        return !!d && d.status === 'failed';
      }
    };
  }

  async getQueueStats(queueName: string): Promise<QueueStats | null> {
    const coll = this.getJobsCollection();
    const counts = await coll.aggregate([
      { $match: { queue: queueName } },
      { $group: { _id: '$status', c: { $sum: 1 } } }
    ]).toArray();
    const map: Record<string, number> = {};
    counts.forEach((c: any) => (map[c._id] = c.c));
    const delayed = await coll.countDocuments({ queue: queueName, status: 'waiting', availableAt: { $gt: new Date() } });
    return {
      waiting: (map['waiting'] || 0) - delayed,
      active: map['active'] || 0,
      completed: map['completed'] || 0,
      failed: map['failed'] || 0,
      delayed,
      paused: 0
    };
  }

  async getAllQueueStats(): Promise<Record<string, QueueStats>> {
    const coll = this.getJobsCollection();
    // API v1-safe: avoid distinct; use aggregation instead
    const docs = await coll.aggregate([{ $group: { _id: '$queue' } }]).toArray();
    const queues = docs.map((d: any) => d._id).filter((q: any) => !!q);
    const result: Record<string, QueueStats> = {};
    for (const q of queues) {
      const s = await this.getQueueStats(q);
      if (s) result[q] = s;
    }
    return result;
  }

  async pauseQueue(_queueName: string): Promise<boolean> { return true; }
  async resumeQueue(_queueName: string): Promise<boolean> { return true; }
  async cleanFailedJobs(queueName: string, graceMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const coll = this.getJobsCollection();
    const cutoff = new Date(Date.now() - graceMs);
    const res = await coll.deleteMany({ queue: queueName, status: 'failed', finishedAt: { $lt: cutoff } });
    return res.deletedCount || 0;
  }
  async cleanCompletedJobs(queueName: string, graceMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const coll = this.getJobsCollection();
    const cutoff = new Date(Date.now() - graceMs);
    const res = await coll.deleteMany({ queue: queueName, status: 'completed', finishedAt: { $lt: cutoff } });
    return res.deletedCount || 0;
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    queues: number;
    workers: number;
    totalJobs?: Record<string, QueueStats>;
  }> {
    try {
      const stats = await this.getAllQueueStats();
      return {
        healthy: this.isInitialized,
        queues: Object.keys(stats).length,
        workers: Array.from(this.workerLoops.values()).reduce((a, b) => a + b.length, 0),
        totalJobs: stats
      };
    } catch (e) {
      return { healthy: false, queues: 0, workers: 0 };
    }
  }
}

export default AsyncJobQueueService.getInstance();
