import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import TorControl from 'tor-control';
import type { ITorService, TorConfig } from '../types';
import * as fs from 'fs';

export class TorService extends EventEmitter implements ITorService {
  private torProcess: ChildProcessWithoutNullStreams | null = null;
  private control: TorControl | null = null;
  private isRunning = false;
  private hiddenServices = new Map<number, string>();
  private config: TorConfig | null = null;

  async start(config: TorConfig): Promise<void> {
    this.config = config;

    // Ensure hidden service directory exists
    if (!fs.existsSync(config.hiddenServiceDir)) {
      fs.mkdirSync(config.hiddenServiceDir, { recursive: true });
    }

    this.torProcess = spawn('tor', [
      '--ControlPort', config.controlPort.toString(),
      '--SocksPort', config.socksPort.toString(),
      '--CookieAuthentication', '0',
      '--DataDirectory', config.hiddenServiceDir,
      ...(config.bridges ? config.bridges.map(b => `Bridge ${b}`) : []),
    ]);

    this.torProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Bootstrapped 100%')) {
        this.isRunning = true;
        this.emit('ready');
      }
      console.log('[Tor]', msg.trim());
    });

    this.torProcess.stderr.on('data', (data) => {
      console.error('[Tor error]', data.toString().trim());
    });

    this.torProcess.on('close', (code) => {
      console.log(`Tor process exited with code ${code}`);
      this.isRunning = false;
      this.emit('stopped');
    });

    // Wait briefly before connecting
    await new Promise((resolve) => setTimeout(resolve, 7000));

    this.control = new TorControl({
      password: '',
      port: config.controlPort,
      host: '127.0.0.1'
    });

    this.control.connect();

    this.control.on('ready', () => {
      console.log('[Tor Control] Connected');
    });

    this.control.on('error', (err) => {
      console.error('[Tor Control error]', err);
    });
  }

  async stop(): Promise<void> {
    if (this.control) {
      this.control.quit();
      this.control = null;
    }

    if (this.torProcess) {
      this.torProcess.kill();
      this.torProcess = null;
    }

    this.isRunning = false;
    this.hiddenServices.clear();
    this.emit('stopped');
  }

  async createHiddenService(port: number): Promise<string> {
    if (!this.control) throw new Error('Tor control not ready');

    const cmd = `ADD_ONION NEW:ED25519-V3 Port=${port},127.0.0.1:${port}`;
    const result = await this.sendControlCommand(cmd);
    const match = result.match(/ServiceID=(\w+)/);
    if (!match) throw new Error('Failed to parse hidden service ID');
    const onion = `${match[1]}.onion`;
    this.hiddenServices.set(port, onion);
    return onion;
  }

  async connect(onionAddress: string): Promise<void> {
    if (!this.isRunning) throw new Error('Tor is not running');
    console.log(`[TorService] Connecting to ${onionAddress}...`);
    this.emit('connected', { address: onionAddress });
  }

  async getCircuits(): Promise<string[]> {
    if (!this.control) return [];
    const response = await this.sendControlCommand('GETINFO circuit-status');
    return response
      .split('\n')
      .filter(line => line.startsWith('250+'))
      .map(line => line.split(' ')[0].replace('250+', '').trim());
  }

  async newCircuit(): Promise<void> {
    if (!this.control) throw new Error('Tor control not ready');
    await this.sendControlCommand('SIGNAL NEWNYM');
    console.log('[TorService] New circuit signal sent');
  }

  private sendControlCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.control) return reject(new Error('No control connection'));
      this.control.send(command, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  }
}
