import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadBackendEnvironment() {
  return dotenv.config({ path: path.join(backendRoot, '.env') });
}
