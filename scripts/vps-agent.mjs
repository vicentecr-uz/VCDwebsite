import { execFile as execFileCb } from 'node:child_process';

const VPS_HOST = 'atlas';
const VPS_AGENT = '~/bin/vcd-agent';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

/** Send one bounded JSON request to the VPS agent without invoking a shell. */
export function requestVpsAgent(payload, { timeout = 20_000 } = {}) {
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) {
    return Promise.reject(new Error('VPS agent request exceeds the 2MB limit.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const child = execFileCb('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      VPS_HOST,
      VPS_AGENT,
    ], {
      timeout,
      maxBuffer: 8192,
    }, (error, stdout) => {
      if (error) {
        finish(reject, error);
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout));
      } catch (parseError) {
        finish(reject, parseError);
      }
    });

    child.stdin.on('error', (error) => finish(reject, error));
    child.stdin.end(input);
  });
}
