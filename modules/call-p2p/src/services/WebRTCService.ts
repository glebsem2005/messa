import SimplePeer from 'simple-peer';
import { EventEmitter } from 'events';
import { CallEncryption } from './CallEncryption';
import type { IWebRTCService, CallConfig, CallStats } from '../types';

export class WebRTCService extends EventEmitter implements IWebRTCService {
  private peers: Map<string, SimplePeer.Instance> = new Map();
  private config: CallConfig;
  private callEncryption: CallEncryption;
  private localStream: MediaStream | null = null;

  constructor(config: CallConfig = {}) {
    super();
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      enableVideo: true,
      enableAudio: true,
      enableEncryption: true,
      enableNoiseSuppression: true,
      enableEchoCancellation: true,
      videoQuality: {
        width: 1280,
        height: 720,
        frameRate: 30,
        bitrate: 1500000,
      },
      audioQuality: {
        sampleRate: 48000,
        bitrate: 128000,
        channels: 2,
      },
      ...config,
    };
    this.callEncryption = new CallEncryption();
  }

  async initializeCall(peerId: string, isVideo: boolean): Promise<string> {
    const callId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Получение локального медиа-потока
    const stream = await this.getLocalStream(isVideo);
    this.localStream = stream;

    // Создание peer connection
    const peer = new SimplePeer({
      initiator: true,
      trickle: true,
      stream,
      config: {
        iceServers: this.config.iceServers,
      },
    });

    this.setupPeerEvents(peer, callId, peerId);
    this.peers.set(callId, peer);

    return new Promise((resolve) => {
      peer.on('signal', (data) => {
        if (data.type === 'offer') {
          resolve(callId);
          this.emit('offer', { callId, offer: data, peerId });
        }
      });
    });
  }

  async answerCall(
    callId: string, 
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const stream = await this.getLocalStream(this.config.enableVideo || false);
    this.localStream = stream;

    const peer = new SimplePeer({
      initiator: false,
      trickle: true,
      stream,
      config: {
        iceServers: this.config.iceServers,
      },
    });

    this.setupPeerEvents(peer, callId, '');
    this.peers.set(callId, peer);

    return new Promise((resolve) => {
      peer.on('signal', (data) => {
        if (data.type === 'answer') {
          resolve(data);
        }
      });

      peer.signal(offer);
    });
  }

  async endCall(callId: string): Promise<void> {
    const peer = this.peers.get(callId);
    if (peer) {
      peer.destroy();
      this.peers.delete(callId);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.emit('callEnded', callId);
  }

  async addIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(callId);
    if (peer) {
      peer.signal({ candidate });
    }
  }

  async getCallStats(callId: string): Promise<CallStats> {
    const peer = this.peers.get(callId);
    if (!peer) {
      throw new Error('Call not found');
    }

    // В SimplePeer статистика ограничена, используем базовые метрики
    return {
      packetsLost: 0,
      packetsReceived: 0,
      bytesReceived: 0,
      bytesSent: 0,
      latency: 0,
      jitter: 0,
      audioLevel: 0,
    };
  }

  muteAudio(callId: string): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }
  }

  unmuteAudio(callId: string): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
    }
  }

  muteVideo(callId: string): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });
    }
  }

  unmuteVideo(callId: string): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
      });
    }
  }

  private async getLocalStream(isVideo: boolean): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: this.config.enableEchoCancellation,
        noiseSuppression: this.config.enableNoiseSuppression,
        sampleRate: this.config.audioQuality?.sampleRate,
        channelCount: this.config.audioQuality?.channels,
      },
      video: isVideo ? {
        width: { ideal: this.config.videoQuality?.width },
        height: { ideal: this.config.videoQuality?.height },
        frameRate: { ideal: this.config.videoQuality?.frameRate },
      } : false,
    };

    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private setupPeerEvents(peer: SimplePeer.Instance, callId: string, peerId: string): void {
    peer.on('error', (err) => {
      console.error('Peer error:', err);
      this.emit('error', { callId, error: err });
    });

    peer.on('connect', () => {
      this.emit('connected', { callId, peerId });
    });

    peer.on('stream', (stream) => {
      this.emit('remoteStream', { callId, stream });
    });

    peer.on('close', () => {
      this.endCall(callId);
    });

    peer.on('data', async (data) => {
      if (this.config.enableEncryption) {
        // Расшифровка данных
        const decrypted = await this.callEncryption.decryptMedia(
          new Uint8Array(data),
          new Uint8Array(32) // Ключ должен быть согласован
        );
        this.emit('data', { callId, data: decrypted });
      } else {
        this.emit('data', { callId, data });
      }
    });
  }

  // Дополнительные методы для управления качеством

  async setVideoQuality(callId: string, quality: 'low' | 'medium' | 'high'): Promise<void> {
    const qualitySettings = {
      low: { width: 640, height: 360, bitrate: 500000 },
      medium: { width: 1280, height: 720, bitrate: 1500000 },
      high: { width: 1920, height: 1080, bitrate: 3000000 },
    };

    const settings = qualitySettings[quality];
    
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        await videoTrack.applyConstraints({
          width: { ideal: settings.width },
          height: { ideal: settings.height },
        });
      }
    }
  }

  async switchCamera(callId: string): Promise<void> {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Получение списка камер
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    if (videoDevices.length <= 1) return;

    // Переключение на следующую камеру
    const currentDeviceId = videoTrack.getSettings().deviceId;
    const currentIndex = videoDevices.findIndex(d => d.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % videoDevices.length;
    const nextDevice = videoDevices[nextIndex];

    // Получение нового потока
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: nextDevice.deviceId },
      audio: false,
    });

    // Замена трека
    const peer = this.peers.get(callId);
    if (peer) {
      const sender = (peer as any)._pc.getSenders().find(
        (s: RTCRtpSender) => s.track?.kind === 'video'
      );
      
      if (sender) {
        sender.replaceTrack(newStream.getVideoTracks()[0]);
      }
    }

    // Остановка старого трека
    videoTrack.stop();
    
    // Обновление локального потока
    this.localStream.removeTrack(videoTrack);
    this.localStream.addTrack(newStream.getVideoTracks()[0]);
  }
}
