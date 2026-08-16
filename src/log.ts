export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

export function createLogger(write: (line: string) => void): Logger {
  const emit = (level: 'info' | 'error', event: string, fields: Record<string, unknown>) => {
    const record = { time: new Date().toISOString(), level, event, ...fields };
    write(JSON.stringify(record) + '\n');
  };

  return {
    info: (event, fields) => emit('info', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
