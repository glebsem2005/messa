export interface CallConfig {
  iceServers?: RTCIceServer[];
  enableVideo?: boolean;
  enableAudio?: boolean;
  videoQuality?: VideoQuality;
  audioQuality?: AudioQuality;
  enableEncryption?: boolean;
  enableNoiseSuppression?: boolean;
  enableEchoCancellation?: boolean;
}

export interface VideoQuality {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
}

export interface AudioQuality {
  sampleRate: number;
  bitrate: number;
  channels: number;
}

export interface Call {
  id: string;
  peerId: string;
  direction: 'incoming' | 'outgoing';
  state: CallState;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  isVideo: boolean;
  isEncrypted: boolean;
}

export type CallState = 
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed';

export interface MediaStream {
  id: string;
  stream: MediaStream;
  type: 'local' | 'remote';
  kind: 'audio' | 'video' | 'screen';
}

export interface CallStats {
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  bytesSent: number;
  latency: number;
  jitter: number;
  audioLevel: number;
}

export interface IWebRTCService {
  initializeCall(peerId: string, isVideo: boolean): Promise<string>;
  answerCall(callId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  endCall(callId: string): Promise<void>;
  addIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void>;
  getCallStats(callId: string): Promise<CallStats>;
  muteAudio(callId: string): void;
  unmuteAudio(callId: string): void;
  muteVideo(callId: string): void;
  unmuteVideo(callId: string): void;
}

export interface ICallManager {
  startCall(peerId: string, isVideo: boolean): Promise<Call>;
  acceptCall(callId: string): Promise<void>;
  rejectCall(callId: string): Promise<void>;
  endCall(callId: string): Promise<void>;
  getActiveCall(): Call | null;
  getCallHistory(): Call[];
  onIncomingCall(handler: (call: Call) => void): void;
  onCallStateChange(handler: (callId: string, state: CallState) => void): void;
}

export interface IMediaManager {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  getDisplayMedia(): Promise<MediaStream>;
  stopStream(stream: MediaStream): void;
  setAudioInput(deviceId: string): Promise<void>;
  setAudioOutput(deviceId: string): Promise<void>;
  setVideoInput(deviceId: string): Promise<void>;
  getAudioInputs(): Promise<MediaDeviceInfo[]>;
  getAudioOutputs(): Promise<MediaDeviceInfo[]>;
  getVideoInputs(): Promise<MediaDeviceInfo[]>;
  testAudio(): Promise<number>;
  testVideo(): Promise<boolean>;
}

export interface ICallEncryption {
  generateCallKey(): Promise<Uint8Array>;
  encryptMedia(data: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
  decryptMedia(data: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
  deriveSharedSecret(localKey: Uint8Array, remoteKey: Uint8Array): Promise<Uint8Array>;
}
