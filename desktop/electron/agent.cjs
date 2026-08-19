'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const readline = require('node:readline');
const { existsSync } = require('node:fs');

/**
 * JSON-RPC 2.0 client for the Go agent, over a Unix socket in ~/.dermaga.
 *
 * The agent is no longer this process's child by necessity. One may already be
 * running -- installed as a background service, so that containers are still
 * watched and restarted while no window is open -- and this connects to it.
 * When there is none, one is started here and taken down again on quit, which
 * is the same arrangement as before with a socket in place of a pipe.
 *
 * No ports either way: the socket sits in the user's own directory, readable by
 * nobody else.
 */
class Agent {
  constructor({ binary, socket, env, onNotify, onExit, logger = console }) {
    this.binary = binary;
    this.socket = socket;
    this.env = env;
    this.onNotify = onNotify;
    this.onExit = onExit;
    this.logger = logger;

    this.child = null;
    this.connection = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stopping = false;
  }

  /** Resolves once there is an agent answering, whoever started it. */
  async start() {
    this.stopping = false;

    if (await this.connect()) {
      this.logger.log('[agent] using the agent already running');
      return;
    }

    this.spawn();
    await this.waitForSocket();

    if (!(await this.connect())) {
      throw new Error('The Dermaga agent did not come up');
    }
  }

  spawn() {
    this.child = spawn(this.binary, [], { env: this.env, stdio: ['ignore', 'ignore', 'pipe'] });

    readline.createInterface({ input: this.child.stderr }).on('line', (line) => {
      this.logger.log('[agent]', line);
    });

    this.child.on('exit', (code) => {
      this.child = null;
      if (!this.stopping) this.onExit?.(code);
    });
  }

  /** The socket appears a moment after the process does. */
  async waitForSocket(attempts = 50) {
    for (let i = 0; i < attempts; i += 1) {
      if (existsSync(this.socket)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  connect() {
    return new Promise((resolve) => {
      const connection = net.createConnection(this.socket);

      const fail = () => {
        connection.destroy();
        resolve(false);
      };

      connection.once('error', fail);

      connection.once('connect', () => {
        connection.removeListener('error', fail);
        this.connection = connection;

        readline.createInterface({ input: connection }).on('line', (line) => this.receive(line));

        connection.on('error', (error) => this.logger.log('[agent] socket error', error.message));
        connection.on('close', () => this.dropped());

        resolve(true);
      });
    });
  }

  receive(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger.warn('[agent] unreadable message', line.slice(0, 200));
      return;
    }

    // A message without an id is something the agent decided to tell us.
    if (message.id === undefined || message.id === null) {
      this.onNotify?.(message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  /**
   * The connection went away: the service was restarted, or the agent we
   * started died. Calls in flight will never be answered, and reconnecting is
   * worth trying -- a service that restarts should not cost the user a window.
   */
  dropped() {
    this.connection = null;

    for (const { reject } of this.pending.values()) {
      reject(new Error('The Dermaga agent stopped'));
    }
    this.pending.clear();

    if (this.stopping) return;

    this.onExit?.(null);

    setTimeout(() => {
      if (this.stopping || this.connection) return;
      void this.connect();
    }, 1000);
  }

  invoke(method, params) {
    if (!this.connection) return Promise.reject(new Error('The Dermaga agent is not running'));

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.connection.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /**
   * Lets go of the agent. One this process started goes with it; one that was
   * already running is left alone, because keeping containers up while Dermaga
   * is closed is the whole reason it is there.
   */
  stop() {
    this.stopping = true;

    this.connection?.end();
    this.connection = null;

    if (!this.child) return;
    this.child.kill('SIGTERM');
    this.child = null;
  }
}

module.exports = { Agent };
