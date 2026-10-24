// Isolate the official SDK's singleton and background timers. Terminating this
// worker fully disposes a connection on stop, reconnect, or token rotation.
const { parentPort, workerData } = require('node:worker_threads');
// The SDK prints raw diagnostics even with file logging disabled. Only forward
// our structured events; credentials and vendor payloads must not enter logs.
console.log = console.warn = console.error = console.info = console.debug = () => {};
const { fyersDataSocket } = require('fyers-api-v3');
const send = (event) => parentPort.postMessage(event);
(async () => {
  try {
    const socket = fyersDataSocket.getInstance(workerData.authorization, '', false);
    socket.on('connect', () => {
      send({ type: 'connect' });
      // Full mode preserves exchange timestamps when supplied. No depth needed.
      Promise.resolve(socket.subscribe(workerData.symbols)).catch(() => send({ type: 'error' }));
    });
    socket.on('message', (data) => send({ type: 'message', data }));
    socket.on('error', () => send({ type: 'error' }));
    socket.on('close', () => send({ type: 'close' }));
    // Parent owns backoff/reconnect; do not enable the SDK's retry loop as well.
    await socket.connect();
  } catch {
    send({ type: 'error' });
  }
})();
