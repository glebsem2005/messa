import type { Libp2p } from 'libp2p';
import type { PeerId } from '@libp2p/interface';

export interface P2PConfig {
  bootstrapNodes?: string[];
  enableTor?: boolean;
  enableI2P?: boolean;
  enableCoverTraffic?: boolean;
  coverTrafficInterval?: number;
  maxPeers?: number;
  port?: number;
}

export interface PeerInfo {
  id: string;
  addresses: string[];
  protocols: string[];
  metadata: Map<string, Uint8Array>;
  latency?: number;
  lastSeen: Date;
}

export interface DHTRecord {
  key: string;
  value: Uint8Array;
  timestamp: Date;
  signature: Uint8Array;
  author: string;
}

export interface TorConfig {
  socksPort: number;
  controlPort: number;
  hiddenServiceDir: string;
  bridges?: string[];
}

export interface CoverTrafficPacket {
  id: string;
  type: 'cover' | 'real';
  payload: Uint8Array;
  timestamp: Date;
  ttl: number;
}

export interface IP2PService {
  start(config?: P2PConfig): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, protocol: string, data: Uint8Array): Promise<void>;
  broadcast(protocol: string, data: Uint8Array): Promise<void>;
  getPeers(): Promise<PeerInfo[]>;
  getNodeId(): string;
  onMessage(protocol: string, handler: (data: Uint8Array, from: string) => void): void;
}

export interface IDHTService {
  put(key: string, value: Uint8Array): Promise<void>;
  get(key: string): Promise<DHTRecord | null>;
  findPeer(peerId: string): Promise<PeerInfo | null>;
  provide(key: string): Promise<void>;
  findProviders(key: string): Promise<PeerInfo[]>;
}

export interface ITorService {
  start(config: TorConfig): Promise<void>;
  stop(): Promise<void>;
  createHiddenService(port: number): Promise<string>;
  connect(onionAddress: string): Promise<void>;
  getCircuits(): Promise<string[]>;
  newCircuit(): Promise<void>;
}

export interface ICoverTrafficService {
  start(interval: number): void;
  stop(): void;
  wrapMessage(data: Uint8Array): CoverTrafficPacket;
  unwrapPacket(packet: CoverTrafficPacket): Uint8Array | null;
  generateCoverTraffic(): CoverTrafficPacket;
}

export interface INATTraversalService {
  getPublicAddress(): Promise<string>;
  setupSTUN(servers: string[]): Promise<void>;
  setupTURN(servers: string[]): Promise<void>;
  createOffer(): Promise<RTCSessionDescription>;
  handleAnswer(answer: RTCSessionDescription): Promise<void>;
}
