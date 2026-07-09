import { createConnection } from 'node:net';

export const DOCKER_START_HINT = 'sudo systemctl start docker';

export function isLocalDatabaseHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isDockerAvailable(exec: (command: string) => string): boolean {
  try {
    exec('docker info --format "{{.ServerVersion}}"');
    return true;
  } catch {
    return false;
  }
}

export function isPostgresContainerRunning(
  exec: (command: string) => string,
  serviceName: string,
): boolean {
  try {
    const output = exec(`docker compose ps ${serviceName} --status running -q`);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function startPostgresContainer(
  execInherit: (command: string) => void,
  serviceName: string,
): void {
  execInherit(`docker compose up -d ${serviceName}`);
}

export function checkTcpPort(
  host: string,
  port: number,
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
