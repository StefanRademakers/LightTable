export type LightTableDebugSeverity = 'info' | 'warning' | 'error';

export interface LightTableDebugMessage {
  id: number;
  timestamp: number;
  severity: LightTableDebugSeverity;
  source: string;
  message: string;
  details?: string;
}

export const formatLightTableDebugLog = (messages: readonly LightTableDebugMessage[]) =>
  messages.map((entry) => [
    `[${new Date(entry.timestamp).toISOString()}]`,
    `[${entry.severity.toUpperCase()}]`,
    `[${entry.source}]`,
    entry.message,
    entry.details ? `\n${entry.details}` : ''
  ].join(' ')).join('\n');
