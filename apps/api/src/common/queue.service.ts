import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

type Handler = (data: any) => Promise<unknown>;

/**
 * Background job runner. Uses BullMQ when REDIS_URL is configured; otherwise runs
 * jobs in-process on the next tick so local development works without Redis.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<string, Handler>();
  private queue?: Queue;
  private worker?: Worker;

  get mode() {
    return this.queue ? 'bullmq' : 'in-process';
  }

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.log('REDIS_URL not set — background jobs run in-process');
      return;
    }
    const u = new URL(url);
    const connection = {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue('windguard', { connection });
    this.worker = new Worker(
      'windguard',
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`No handler for job ${job.name}`);
        return handler(job.data);
      },
      { connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.name} failed: ${err.message}`));
    this.logger.log('BullMQ queue connected');
  }

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown) {
    if (this.queue) {
      await this.queue.add(name, data, { attempts: 2, removeOnComplete: 200, removeOnFail: 500 });
      return;
    }
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for job ${name}`);
    setImmediate(() => {
      handler(data).catch((err: Error) => this.logger.error(`Job ${name} failed: ${err.message}`));
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
