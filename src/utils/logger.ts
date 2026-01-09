/**
 * Log severity levels compatible with Google Cloud Logging
 */
enum LogSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

/**
 * Structured log entry for Cloud Logging
 */
interface LogEntry {
  severity: LogSeverity;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/**
 * Keys that should never be logged (PII/sensitive data)
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'credential',
  'authorization',
  'cookie',
  'email',
  'refreshToken',
  'accessToken',
]);

/**
 * Sanitizes context object by masking sensitive fields
 */
function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = Array.from(SENSITIVE_KEYS).some((sensitive) =>
      lowerKey.includes(sensitive)
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Structured logger for Cloud Functions
 * Outputs JSON format compatible with Google Cloud Logging
 */
export class Logger {
  private readonly runId: string;

  constructor() {
    this.runId = this.generateRunId();
  }

  private generateRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private log(severity: LogSeverity, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      severity,
      message,
      timestamp: new Date().toISOString(),
    };

    if (context) {
      entry.context = {
        runId: this.runId,
        ...sanitizeContext(context),
      };
    } else {
      entry.context = { runId: this.runId };
    }

    const output = JSON.stringify(entry);

    switch (severity) {
      case LogSeverity.ERROR:
        console.error(output);
        break;
      case LogSeverity.WARNING:
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogSeverity.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogSeverity.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogSeverity.WARNING, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogSeverity.ERROR, message, context);
  }

  /**
   * Logs an error with stack trace
   */
  errorWithStack(message: string, error: Error, context?: Record<string, unknown>): void {
    this.log(LogSeverity.ERROR, message, {
      ...context,
      errorMessage: error.message,
      errorStack: error.stack,
    });
  }

  /**
   * Get the current run ID for correlation
   */
  getRunId(): string {
    return this.runId;
  }
}
