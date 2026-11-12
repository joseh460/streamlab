// Calcula bcrypt (bcryptjs, 10 rondas, como pide SPEC.md) en hilos de trabajo para no bloquear
// el hilo principal: con cientos de registros/logins simultáneos, el servidor seguiría respondiendo.
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

// Rondas de bcrypt: 10 por defecto (SPEC.md). Bájalas (p. ej. BCRYPT_ROUNDS=8) solo si necesitas registrar
// cientos de cuentas a la vez en una máquina pequeña: cada ronda menos reduce el coste a la mitad.
const ROUNDS = Math.min(12, Math.max(4, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10));

if (!isMainThread) {
  const bcrypt = require('bcryptjs');
  parentPort.on('message', ({ id, op, password, hash }) => {
    try {
      const result = op === 'hash' ? bcrypt.hashSync(password, ROUNDS) : bcrypt.compareSync(password, hash);
      parentPort.postMessage({ id, result });
    } catch (e) {
      parentPort.postMessage({ id, error: e.message });
    }
  });
} else {
  const os = require('node:os');
  // Hilos de hash: por defecto entre 2 y 4 según los núcleos (BCRYPT_WORKERS para cambiarlo)
  const SIZE = parseInt(process.env.BCRYPT_WORKERS, 10) || Math.max(2, Math.min(4, os.availableParallelism()));
  const workers = [];
  const waiting = new Map(); // id -> { resolve, reject }
  const queue = [];
  let nextId = 1;

  function spawn() {
    const w = new Worker(__filename);
    w.busy = false;
    w.on('message', ({ id, result, error }) => {
      const p = waiting.get(id);
      waiting.delete(id);
      w.busy = false;
      if (p) (error ? p.reject(new Error(error)) : p.resolve(result));
      pump();
    });
    w.on('error', (e) => console.error('[bcrypt-pool]', e.message));
    w.on('exit', () => { const i = workers.indexOf(w); if (i >= 0) workers.splice(i, 1); });
    w.unref(); // no impide que el proceso termine
    workers.push(w);
    return w;
  }

  function pump() {
    while (queue.length) {
      let w = workers.find((x) => !x.busy);
      if (!w && workers.length < SIZE) w = spawn();
      if (!w) return;
      const job = queue.shift();
      w.busy = true;
      w.postMessage(job);
    }
  }

  function run(op, password, hash) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      queue.push({ id, op, password, hash });
      pump();
    });
  }

  module.exports = {
    hashPassword: (password) => run('hash', password),
    checkPassword: (password, hash) => run('compare', password, hash),
  };
}
