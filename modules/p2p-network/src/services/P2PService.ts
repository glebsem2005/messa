import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { pipe } from 'it-pipe';
import { fromString, toString } from 'uint8arrays';
import type { IP2PService, P2PConfig, PeerInfo } from '../types';
import { DHTService } from './DHTService';
import { CoverTrafficService } from './CoverTrafficService';

export class P2PService implements IP2PService {
  private node: Libp2p | null = null;
  private config: P2PConfig;
  private handlers: Map<string, (data: Uint8Array, from: string) => void> = new Map();
  private dht: DHTService;
  private coverTraffic: CoverTrafficService;
  private peerId: any = null;

  constructor() {
    this.config = {};
    this.dht = new DHTService();
    this.coverTraffic = new CoverTrafficService();
  }

  async start(config: P2PConfig = {}): Promise<void> {
    this.config = config;

    // Генерация или загрузка Peer ID
    this.peerId = await createEd25519PeerId();

    // Создание libp2p узла
    this.node = await createLibp2p({
      peerId: this.peerId,
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${config.port || 0}`,
          '/ip4/0.0.0.0/tcp/0/ws',
          '/webrtc',
        ],
      },
      transports: [
        tcp(),
        webSockets(),
        webRTC(),
        circuitRelayTransport({
          discoverRelays: 1,
        }),
      ],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        ...(config.bootstrapNodes ? [bootstrap({
          list: config.bootstrapNodes,
        })] : []),
        mdns(),
      ],
      services: {
        dht: kadDHT({
          kBucketSize: 20,
          clientMode: false,
        }),
        identify: identify(),
      },
    });

    // Запуск узла
    await this.node.start();

    // Инициализация DHT сервиса
    this.dht.initialize(this.node);

    // Запуск cover traffic если включен
    if (config.enableCoverTraffic) {
      this.coverTraffic.start(config.coverTrafficInterval || 30000);
    }

    // Обработка входящих соединений
    this.setupProtocolHandlers();

    console.log('P2P node started with ID:', this.peerId.toString());
    console.log('Listening on:');
    this.node.getMultiaddrs().forEach(addr => {
      console.log('  ', addr.toString());
    });
  }

  async stop(): Promise<void> {
    this.coverTraffic.stop();
    
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
  }

  async connect(peerId: string): Promise<void> {
    if (!this.node) {
      throw new Error('P2P node not started');
    }

    try {
      // Поиск peer через DHT
      const peerInfo = await this.dht.findPeer(peerId);
      if (!peerInfo) {
        throw new Error('Peer not found in DHT');
      }

      // Подключение к найденным адресам
      for (const addr of peerInfo.addresses) {
        try {
          await this.node.dial(addr);
          console.log(`Connected to peer ${peerId} at ${addr}`);
          return;
        } catch (err) {
          console.error(`Failed to dial ${addr}:`, err);
        }
      }

      throw new Error('Failed to connect to any address');
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  async disconnect(peerId: string): Promise<void> {
    if (!this.node) return;

    const connections = this.node.getConnections(peerId);
    for (const conn of connections) {
      await conn.close();
    }
  }

  async send(peerId: string, protocol: string, data: Uint8Array): Promise<void> {
    if (!this.node) {
      throw new Error('P2P node not started');
    }

    // Обертка сообщения в cover traffic если включен
    const packet = this.config.enableCoverTraffic
      ? this.coverTraffic.wrapMessage(data)
      : { payload: data };

    const stream = await this.node.dialProtocol(peerId, protocol);
    
    await pipe(
      [packet.payload],
      stream
    );
  }

  async broadcast(protocol: string, data: Uint8Array): Promise<void> {
    if (!this.node) {
      throw new Error('P2P node not started');
    }

    const peers = await this.getPeers();
    
    // Отправка всем подключенным пирам
    await Promise.allSettled(
      peers.map(peer => this.send(peer.id, protocol, data))
    );
  }

  async getPeers(): Promise<PeerInfo[]> {
    if (!this.node) return [];

    const peers: PeerInfo[] = [];
    const connections = this.node.getConnections();

    for (const conn of connections) {
      const peerId = conn.remotePeer.toString();
      const peer = await this.node.peerStore.get(conn.remotePeer);
      
      peers.push({
        id: peerId,
        addresses: peer.addresses.map(a => a.multiaddr.toString()),
        protocols: Array.from(peer.protocols || []),
        metadata: peer.metadata || new Map(),
        latency: conn.stat.latency,
        lastSeen: new Date(),
      });
    }

    return peers;
  }

  getNodeId(): string {
    return this.peerId ? this.peerId.toString() : '';
  }

  onMessage(protocol: string, handler: (data: Uint8Array, from: string) => void): void {
    this.handlers.set(protocol, handler);
    
    if (this.node) {
      this.setupProtocolHandler(protocol);
    }
  }

  private setupProtocolHandlers(): void {
    if (!this.node) return;

    for (const [protocol, handler] of this.handlers) {
      this.setupProtocolHandler(protocol);
    }
  }

  private setupProtocolHandler(protocol: string): void {
    if (!this.node) return;

    this.node.handle(protocol, async ({ stream, connection }) => {
      try {
        const chunks: Uint8Array[] = [];
        
        for await (const chunk of stream.source) {
          chunks.push(chunk.subarray());
        }
        
        const data = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }

        // Распаковка из cover traffic если нужно
        let payload = data;
        if (this.config.enableCoverTraffic) {
          const packet = this.coverTraffic.unwrapPacket({
            id: '',
            type: 'real',
            payload: data,
            timestamp: new Date(),
            ttl: 0,
          });
          
          if (packet) {
            payload = packet;
          }
        }

        const handler = this.handlers.get(protocol);
        if (handler) {
          handler(payload, connection.remotePeer.toString());
        }
      } catch (error) {
        console.error('Error handling protocol:', protocol, error);
      }
    });
  }

  // Дополнительные методы для управления сетью

  async publishPresence(): Promise<void> {
    if (!this.node) return;

    // Публикация информации о себе в DHT
    const presenceData = {
      peerId: this.getNodeId(),
      addresses: this.node.getMultiaddrs().map(a => a.toString()),
      timestamp: Date.now(),
      protocols: Array.from(this.handlers.keys()),
    };

    await this.dht.put(
      `presence:${this.getNodeId()}`,
      new TextEncoder().encode(JSON.stringify(presenceData))
    );
  }

  async findPeersByProtocol(protocol: string): Promise<PeerInfo[]> {
    if (!this.node) return [];

    const providers = await this.dht.findProviders(protocol);
    return providers;
  }

  async setupRelay(): Promise<void> {
    if (!this.node) return;

    // Настройка circuit relay для NAT traversal
    const relayAddrs = this.node.getMultiaddrs().filter(
      addr => addr.toString().includes('p2p-circuit')
    );

    if (relayAddrs.length > 0) {
      console.log('Relay addresses:', relayAddrs.map(a => a.toString()));
    }
  }

  // Метрики и мониторинг

  getNetworkStats(): {
    connections: number;
    bandwidth: { in: number; out: number };
    protocols: string[];
    uptime: number;
  } {
    if (!this.node) {
      return {
        connections: 0,
        bandwidth: { in: 0, out: 0 },
        protocols: [],
        uptime: 0,
      };
    }

    const connections = this.node.getConnections().length;
    const metrics = this.node.metrics;
    
    return {
      connections,
      bandwidth: {
        in: 0, // В реальной реализации из метрик
        out: 0,
      },
      protocols: Array.from(this.handlers.keys()),
      uptime: Date.now(), // В реальной реализации вычисляется
    };
  }

  // Обфускация трафика

  async sendObfuscated(peerId: string, protocol: string, data: Uint8Array): Promise<void> {
    // Добавление случайного шума
    const noise = new Uint8Array(Math.floor(Math.random() * 100));
    crypto.getRandomValues(noise);

    // Случайная задержка
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

    // Фрагментация сообщения
    const fragments = this.fragmentMessage(data);
    
    for (const fragment of fragments) {
      await this.send(peerId, protocol, fragment);
      
      // Случайная задержка между фрагментами
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
    }
  }

  private fragmentMessage(data: Uint8Array, maxSize: number = 1024): Uint8Array[] {
    const fragments: Uint8Array[] = [];
    const fragmentCount = Math.ceil(data.length / maxSize);
    
    for (let i = 0; i < fragmentCount; i++) {
      const start = i * maxSize;
      const end = Math.min(start + maxSize, data.length);
      
      // Добавление заголовка фрагмента
      const fragment = new Uint8Array(end - start + 8);
      const view = new DataView(fragment.buffer);
      
      view.setUint32(0, i, false); // Номер фрагмента
      view.setUint32(4, fragmentCount, false); // Общее количество
      
      fragment.set(data.slice(start, end), 8);
      fragments.push(fragment);
    }
    
    return fragments;
  }
}
