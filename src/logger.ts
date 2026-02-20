const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type Level = keyof typeof LOG_LEVELS;

const currentLevel: Level = (process.env.LOG_LEVEL?.toUpperCase() as Level) || 'INFO';

function log(level: Level, component: string, msg: string, data?: any) {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}] [${component}]`;
  if (data) {
    console.log(`${prefix} ${msg}`, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export const logger = {
  debug: (c: string, m: string, d?: any) => log('DEBUG', c, m, d),
  info: (c: string, m: string, d?: any) => log('INFO', c, m, d),
  warn: (c: string, m: string, d?: any) => log('WARN', c, m, d),
  error: (c: string, m: string, d?: any) => log('ERROR', c, m, d),
};
