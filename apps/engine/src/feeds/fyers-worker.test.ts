import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("boots the SDK worker with logging disabled and subscribes after every connect", async () => {
  // Execute the actual CommonJS worker entry with a deterministic SDK double.
  // No account credentials, vendor calls, or database access are involved.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(id, ...args) {
      if (id !== 'fyers-api-v3') return originalLoad.call(this, id, ...args);
      return { fyersDataSocket: { getInstance(authorization, logPath, logging) {
        parentPort.postMessage({ type: 'setup', authorization, logPath, logging });
        const handlers = {};
        return {
          on(name, fn) { handlers[name] = fn; },
          subscribe(symbols) { parentPort.postMessage({ type: 'subscribed', symbols }); },
          async connect() {
            handlers.connect();
            handlers.message({ type: 'if', symbol: 'NSE:NIFTY50-INDEX', ltp: 22600 });
            handlers.connect();
            handlers.error({ secret: 'must-not-be-forwarded' });
            handlers.close();
          }
        };
      } } };
    };
    require(workerData.entry);
  `, { eval: true, execArgv: [], workerData: {
    entry: fileURLToPath(new URL('./fyers-worker.cjs', import.meta.url)),
    authorization: 'DUMMY-100:fake-token', symbols: ['NSE:NIFTY50-INDEX'],
  } });
  try {
    const events: unknown[] = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker test timed out')), 3000);
      const messages: unknown[] = [];
      worker.on('message', message => {
        messages.push(message);
        if (message.type === 'close') { clearTimeout(timer); resolve(messages); }
      });
      worker.on('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(events).toEqual([
      { type: 'setup', authorization: 'DUMMY-100:fake-token', logPath: '', logging: false },
      { type: 'connect' }, { type: 'subscribed', symbols: ['NSE:NIFTY50-INDEX'] },
      { type: 'message', data: { type: 'if', symbol: 'NSE:NIFTY50-INDEX', ltp: 22600 } },
      { type: 'connect' }, { type: 'subscribed', symbols: ['NSE:NIFTY50-INDEX'] },
      { type: 'error' }, { type: 'close' },
    ]);
  } finally { await worker.terminate(); }
});
