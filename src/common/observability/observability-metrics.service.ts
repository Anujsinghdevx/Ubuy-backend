import { Injectable } from '@nestjs/common';

type RequestRecord = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

type RequestAggregate = {
  count: number;
  durationSumMs: number;
  durationMinMs: number;
  durationMaxMs: number;
};

type QueueJobEvent = 'active' | 'completed' | 'failed' | 'error';

type RedisSnapshot = {
  status: string;
  pingResponse?: string;
};

type MongoSnapshot = {
  readyState: number;
  dbName?: string;
  pingOk?: number;
};

@Injectable()
export class ObservabilityMetricsService {
  private readonly requestCounters = new Map<string, number>();

  private readonly requestAggregates = new Map<string, RequestAggregate>();

  private readonly queueCounters = new Map<string, number>();

  private redisSnapshot: RedisSnapshot = {
    status: 'unknown',
  };

  private mongoSnapshot: MongoSnapshot = {
    readyState: 0,
  };

  private totalRequests = 0;

  recordHttpRequest(record: RequestRecord) {
    const key = this.buildKey(record.method, record.route, record.statusCode);
    const existingCount = this.requestCounters.get(key) ?? 0;
    const existingAggregate = this.requestAggregates.get(key) ?? {
      count: 0,
      durationSumMs: 0,
      durationMinMs: Number.POSITIVE_INFINITY,
      durationMaxMs: 0,
    };

    this.requestCounters.set(key, existingCount + 1);
    this.requestAggregates.set(key, {
      count: existingAggregate.count + 1,
      durationSumMs: existingAggregate.durationSumMs + record.durationMs,
      durationMinMs: Math.min(
        existingAggregate.durationMinMs,
        record.durationMs,
      ),
      durationMaxMs: Math.max(
        existingAggregate.durationMaxMs,
        record.durationMs,
      ),
    });
    this.totalRequests += 1;
  }

  recordQueueJob(input: {
    queue: string;
    jobName: string;
    event: QueueJobEvent;
  }) {
    const key = `${input.queue}|${input.jobName}|${input.event}`;
    const existing = this.queueCounters.get(key) ?? 0;
    this.queueCounters.set(key, existing + 1);
  }

  recordRedisSnapshot(snapshot: RedisSnapshot) {
    this.redisSnapshot = snapshot;
  }

  recordMongoSnapshot(snapshot: MongoSnapshot) {
    this.mongoSnapshot = snapshot;
  }

  normalizeRoute(path: string) {
    const route = path.split('?')[0] ?? path;

    return route
      .split('/')
      .map((segment) => {
        if (!segment) {
          return segment;
        }

        if (/^[0-9]+$/.test(segment)) {
          return ':id';
        }

        if (/^[0-9a-fA-F]{24}$/.test(segment)) {
          return ':id';
        }

        if (
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
            segment,
          )
        ) {
          return ':id';
        }

        return segment;
      })
      .join('/');
  }

  getPrometheusMetrics() {
    const lines: string[] = [];

    lines.push(
      '# HELP ubuy_http_requests_observed_total Total number of HTTP requests observed across all routes',
    );
    lines.push('# TYPE ubuy_http_requests_observed_total counter');
    lines.push(`ubuy_http_requests_observed_total ${this.totalRequests}`);

    lines.push(
      '# HELP ubuy_http_requests_total Total number of HTTP requests observed',
    );
    lines.push('# TYPE ubuy_http_requests_total counter');

    const sortedKeys = [...this.requestCounters.keys()].sort();
    for (const key of sortedKeys) {
      const [method, route, status] = key.split('|');
      const count = this.requestCounters.get(key) ?? 0;
      lines.push(
        `ubuy_http_requests_total{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status="${this.escapeLabel(status)}"} ${count}`,
      );
    }

    lines.push(
      '# HELP ubuy_http_request_duration_ms HTTP request duration statistics in milliseconds',
    );
    lines.push('# TYPE ubuy_http_request_duration_ms summary');

    for (const key of sortedKeys) {
      const [method, route, status] = key.split('|');
      const aggregate = this.requestAggregates.get(key);

      if (!aggregate) {
        continue;
      }

      lines.push(
        `ubuy_http_request_duration_ms_count{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status="${this.escapeLabel(status)}"} ${aggregate.count}`,
      );
      lines.push(
        `ubuy_http_request_duration_ms_sum{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status="${this.escapeLabel(status)}"} ${aggregate.durationSumMs.toFixed(2)}`,
      );
      lines.push(
        `ubuy_http_request_duration_ms_min{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status="${this.escapeLabel(status)}"} ${aggregate.durationMinMs.toFixed(2)}`,
      );
      lines.push(
        `ubuy_http_request_duration_ms_max{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status="${this.escapeLabel(status)}"} ${aggregate.durationMaxMs.toFixed(2)}`,
      );
    }

    lines.push(
      '# HELP ubuy_queue_jobs_total Total number of queue job lifecycle events observed',
    );
    lines.push('# TYPE ubuy_queue_jobs_total counter');

    const queueKeys = [...this.queueCounters.keys()].sort();
    for (const key of queueKeys) {
      const [queue, jobName, event] = key.split('|');
      const count = this.queueCounters.get(key) ?? 0;

      lines.push(
        `ubuy_queue_jobs_total{queue="${this.escapeLabel(queue)}",job="${this.escapeLabel(jobName)}",event="${this.escapeLabel(event)}"} ${count}`,
      );
    }

    lines.push(
      '# HELP ubuy_redis_connection_status Redis connection status snapshot',
    );
    lines.push('# TYPE ubuy_redis_connection_status gauge');
    lines.push(
      `ubuy_redis_connection_status{status="${this.escapeLabel(this.redisSnapshot.status)}"} 1`,
    );
    if (this.redisSnapshot.pingResponse) {
      lines.push('# HELP ubuy_redis_last_ping_ok Redis ping success snapshot');
      lines.push('# TYPE ubuy_redis_last_ping_ok gauge');
      lines.push(
        `ubuy_redis_last_ping_ok ${this.redisSnapshot.pingResponse === 'PONG' ? 1 : 0}`,
      );
    }

    lines.push(
      '# HELP ubuy_mongo_connection_ready_state Mongo ready state snapshot',
    );
    lines.push('# TYPE ubuy_mongo_connection_ready_state gauge');
    lines.push(
      `ubuy_mongo_connection_ready_state{db="${this.escapeLabel(this.mongoSnapshot.dbName ?? 'unknown')}"} ${this.mongoSnapshot.readyState}`,
    );
    if (typeof this.mongoSnapshot.pingOk === 'number') {
      lines.push('# HELP ubuy_mongo_last_ping_ok Mongo ping success snapshot');
      lines.push('# TYPE ubuy_mongo_last_ping_ok gauge');
      lines.push(`ubuy_mongo_last_ping_ok ${this.mongoSnapshot.pingOk}`);
    }

    lines.push('# HELP ubuy_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE ubuy_process_uptime_seconds gauge');
    lines.push(`ubuy_process_uptime_seconds ${process.uptime().toFixed(2)}`);

    lines.push(
      '# HELP ubuy_process_memory_rss_bytes Resident set size in bytes',
    );
    lines.push('# TYPE ubuy_process_memory_rss_bytes gauge');
    lines.push(`ubuy_process_memory_rss_bytes ${process.memoryUsage().rss}`);

    lines.push('# HELP ubuy_process_memory_heap_used_bytes Heap used in bytes');
    lines.push('# TYPE ubuy_process_memory_heap_used_bytes gauge');
    lines.push(
      `ubuy_process_memory_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    );

    return lines.join('\n') + '\n';
  }

  private buildKey(method: string, route: string, statusCode: number) {
    return `${method.toUpperCase()}|${route}|${statusCode}`;
  }

  private escapeLabel(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
