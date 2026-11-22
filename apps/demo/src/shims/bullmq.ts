// Never constructed: QueueService only uses BullMQ when REDIS_URL is set, which the browser demo never sets.
export class Queue {}
export class Worker {}
