import path from 'node:path';

export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3334);
export const SERVER_BASE_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
export const DATABASE_PATH = path.resolve(process.cwd(), process.env.APP_DB_PATH ?? 'data/app.sqlite');
export const LEGACY_DB_JSON_PATH = path.resolve(process.cwd(), process.env.LEGACY_DB_JSON_PATH ?? 'data/db.json');
export const CLI_PROXY_BASE_URL = process.env.CLI_PROXY_BASE_URL ?? 'http://localhost:3333';

export function getAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return [
    SERVER_BASE_URL
  ];
}
