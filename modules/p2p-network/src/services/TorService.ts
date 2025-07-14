import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import TorControl from 'tor-control';
import type { ITorService, TorConfig } from '../types';

interface Circuit {
  id: string;
  path: string[];
  state: 'building' | 'ready' | 'closed';
  createdAt: Date;
  purpose?: string;
}

export class TorService extends EventEmitter implements ITorService {
  private config: TorConfig | null = null;
  private circuits: Map<string, Circuit> = new Map();
  private hiddenServices: Map<number, string> = new Map();
  private isRunning = false;
  private torProcess: ChildProcessWithoutNullStreams | null = null;
  private control: TorControl | null = null;

  async start(config: TorConfig): Promise<void> {
    this.config = config;

    // Start Tor process
    this.torProcess = spawn('tor', [
      '--ControlPort', config.controlPort?.toString() || '9051',
      '--CookieAuthentication', '0',
      '--DataDirectory', config.dataDir || './tor_data',
      ...(config.extraTorrcArgs || [])
    ]);

    this.torProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Bootstrapped 100%')) {
        console.log('[Tor] Bootstrapped.');
        this.isRunning = true;
        this.emit('ready');
      }
    });

    this.torProcess.stderr.on('data', (data) => {
      console.error('[Tor stderr]', data.toString());
    });

    this.torProcess.on('close', (code) => {
      console.log(`Tor process exited with code ${code}`);
      this.isRunning = false;
      this.emit('stopped');
    });

    // Wait a bit for Tor to start
    await new Promise(resolve => setTimeout(resolve, 7000));

    // Connect to control port
    this.control = new TorControl({
      password: config.password || '',
      port: config.controlPort || 9051,
      host: config.host || '127.0.0.1'
    });

    this.control.connect();

    this.control.on('error', (err) => {
      console.error('Tor control error:', err);
    });

    this.control.on('ready', async () => {
      console.log('[Tor Control] Connected');
      await this.buildInitialCircuits();
      setInterval(() => this.refreshCircuits(), 60000);
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    for (const id of this.circuits.keys()) {
      await this.closeCircuit(id);
    }

    this.circuits.clear();
    this.hiddenServices.clear();

    if (this.control) {
      this.control.quit();
      this.control = null;
    }

    if (this.torProcess) {
      this.torProcess.kill();
      this.torProcess = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  async createHiddenService(port: number): Promise<string> {
    if (!this.control) throw new Error('Tor control not ready');

    const hsCmd = `ADD_ONION NEW:ED25519-V3 Port=${port},127.0.0.1:${port}`;
    const response = await this.sendControlCommand(hsCmd);

    const match = response.match(/ServiceID=(\w+)/);
    if (!match) throw new Error('Failed to create hidden service');

    const onion = `${match[1]}.onion`;
    this.hiddenServices.set(port, onion);
    console.log(`Created hidden service: ${onion} -> localhost:${port}`);
    return onion;
  }

  async connect(onionAddress: string): Promise<void> {
    if (!this.isRunning) throw new Error('Tor not running');
    const circuit = await this.buildCircuit();
    console.log(`Connecting to ${onionAddress} through circuit ${circuit.id}`);
    this.emit('connected', { address: onionAddress, circuit: circuit.id });
  }

  async getCircuits(): Promise<string[]> {
    return Array.from(this.circuits.keys());
  }

  async newCircuit(): Promise<void> {
    const circuit = await this.buildCircuit();
    console.log(`Built new circuit: ${circuit.id}`);
  }

  private async buildInitialCircuits(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await this.buildCircuit();
    }
  }

  private async buildCircuit(): Promise<Circuit> {
    const circuit: Circuit = {
      id: this.generateCircuitId(),
      path: this.selectRelays(),
      state: 'building',
      createdAt: new Date()
    };

    this.circuits.set(circuit.id, circuit);

    await new Promise(resolve => setTimeout(resolve, 300));
    circuit.state = 'ready';
    return circuit;
  }

  private async closeCircuit(circuitId: string): Promise<void> {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) return;
    circuit.state = 'closed';
    this.circuits.delete(circuitId);
  }

  private async refreshCircuits(): Promise<void> {
    if (!this.isRunning) return;

    const now = Date.now();
    for (const [id, circuit] of this.circuits) {
      if (now - circuit.createdAt.getTime() > 10 * 60 * 1000) {
        await this.closeCircuit(id);
      }
    }

    while (this.circuits.size < 3) {
      await this.buildCircuit();
    }
  }

  private selectRelays(): string[] {
    return [
      'relay1.torproject.org',
      'relay2.torproject.org',
      'relay3.torproject.org'
    ];
  }

  private generateCircuitId(): string {
    return `circuit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async sendControlCommand(command: string): Promise<string> {
    if (!this.control) throw new Error('Control connection not ready');

    return new Promise((resolve, reject) => {
      this.control!.send(command, (err: Error, data: string) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  }

  async getInfo(key: string): Promise<string> {
    return this.sendControlCommand(`GETINFO ${key}`);
  }

  async addBridge(bridge: string): Promise<void> {
    if (!this.config) return;
    this.config.bridges = this.config.bridges || [];
    this.config.bridges.push(bridge);
    console.log(`Added bridge: ${bridge}`);
  }

  async removeBridge(bridge: string): Promise<void> {
    if (!this.config?.bridges) return;
    const i = this.config.bridges.indexOf(bridge);
    if (i >= 0) {
      this.config.bridges.splice(i, 1);
      console.log(`Removed bridge: ${bridge}`);
    }
  }

  async isolateStream(purpose: string): Promise<string> {
    const circuit = await this.buildCircuit();
    circuit.purpose = purpose;
    return circuit.id;
  }
}
