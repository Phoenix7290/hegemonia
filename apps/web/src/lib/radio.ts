import type {
  IceServerConfig,
  VoicePresence,
  VoiceSignalInput,
} from "@hegemonia/shared";

interface RadioRoom {
  send(type: string, payload: unknown): void;
}

export interface RadioSignalPayload {
  channelId: string;
  fromPlayerId: string;
  signal: VoiceSignalInput["signal"];
}

export type RadioConnectionState = "disconnected" | "connecting" | "connected" | "failed";

interface RadioCallbacks {
  onError(message: string): void;
  onSpeakingChange(playerId: string, speaking: boolean): void;
  onConnectionChange(state: RadioConnectionState): void;
}

interface PeerConnectionEntry {
  connection: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
  audio: HTMLAudioElement | null;
  stream: MediaStream | null;
}

interface MonitoredStream {
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
}

const SPEAKING_THRESHOLD = 0.025;

export class RadioManager {
  private room: RadioRoom | null = null;
  private myPlayerId = "";
  private activeChannelId: string | null = null;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerConnectionEntry>();
  private iceServers: IceServerConfig[] = [];
  private microphoneId = "";
  private outputVolume = 0.8;
  private pushToTalk = true;
  private transmitting = false;
  private muted = false;
  private audioContext: AudioContext | null = null;
  private monitored = new Map<string, MonitoredStream>();
  private monitorInterval: number | null = null;
  private generation = 0;

  constructor(private readonly callbacks: RadioCallbacks) {}

  attach(room: RadioRoom, myPlayerId: string): void {
    this.dispose();
    this.room = room;
    this.myPlayerId = myPlayerId;
  }

  setIceServers(iceServers: IceServerConfig[]): void {
    this.iceServers = iceServers;
  }

  configure(options: { pushToTalk?: boolean; outputVolume?: number; microphoneId?: string }): void {
    if (options.pushToTalk !== undefined) {
      this.pushToTalk = options.pushToTalk;
      this.applyTrackState();
    }
    if (options.outputVolume !== undefined) {
      this.outputVolume = Math.max(0, Math.min(1, options.outputVolume));
      for (const peer of this.peers.values()) {
        if (peer.audio) peer.audio.volume = this.outputVolume;
      }
    }
    if (options.microphoneId !== undefined && options.microphoneId !== this.microphoneId) {
      this.microphoneId = options.microphoneId;
      if (this.activeChannelId) void this.replaceMicrophone();
    }
  }

  async join(channelId: string): Promise<boolean> {
    if (!this.room || !this.myPlayerId) return false;
    if (this.activeChannelId === channelId) return true;
    this.leave();
    const generation = ++this.generation;
    this.callbacks.onConnectionChange("connecting");

    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      this.callbacks.onError("Este navegador não oferece suporte ao rádio WebRTC.");
      this.callbacks.onConnectionChange("failed");
      return false;
    }

    let requestedStream: MediaStream | null = null;
    try {
      requestedStream = this.localStream ?? await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.microphoneId ? { exact: this.microphoneId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      if (generation !== this.generation) {
        if (requestedStream !== this.localStream) {
          for (const track of requestedStream.getTracks()) track.stop();
        }
        return false;
      }
      this.localStream = requestedStream;
      this.activeChannelId = channelId;
      this.monitorStream(this.myPlayerId, this.localStream);
      this.applyTrackState();
      this.room.send("voice_join", { channelId });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      this.callbacks.onError(
        denied
          ? "Permita o acesso ao microfone para entrar na linha de rádio."
          : "Não foi possível inicializar o microfone selecionado."
      );
      this.callbacks.onConnectionChange("failed");
      this.stopLocalMedia();
      return false;
    }
  }

  leave(): void {
    const previousChannelId = this.activeChannelId;
    this.activeChannelId = null;
    this.generation++;
    if (previousChannelId && this.room) {
      this.room.send("voice_leave", { channelId: previousChannelId });
    }
    this.closeAllPeers();
    this.stopMonitoring();
    this.transmitting = false;
    this.callbacks.onConnectionChange("disconnected");
  }

  dispose(): void {
    this.leave();
    this.stopLocalMedia();
    this.room = null;
    this.myPlayerId = "";
    if (this.audioContext) void this.audioContext.close();
    this.audioContext = null;
  }

  handlePresence(presence: VoicePresence): void {
    if (presence.channelId !== this.activeChannelId || !this.room) return;
    const expected = new Set(presence.playerIds.filter((id) => id !== this.myPlayerId));
    for (const [playerId] of this.peers) {
      if (!expected.has(playerId)) this.closePeer(playerId);
    }
    for (const playerId of expected) {
      if (this.peers.has(playerId)) continue;
      const shouldOffer = this.myPlayerId.localeCompare(playerId) < 0;
      this.createPeer(playerId);
      if (shouldOffer) void this.sendOffer(playerId);
    }
  }

  async handleSignal(payload: RadioSignalPayload): Promise<void> {
    if (payload.channelId !== this.activeChannelId) return;
    const peer = this.peers.get(payload.fromPlayerId) ?? this.createPeer(payload.fromPlayerId);
    try {
      if (payload.signal.type === "description") {
        await peer.connection.setRemoteDescription(payload.signal.description);
        if (payload.signal.description.type === "offer") {
          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);
          this.room?.send("voice_signal", {
            channelId: payload.channelId,
            targetPlayerId: payload.fromPlayerId,
            signal: {
              type: "description",
              description: {
                type: peer.connection.localDescription!.type,
                sdp: peer.connection.localDescription!.sdp,
              },
            },
          });
        }
        const pending = peer.pendingCandidates.splice(0);
        for (const candidate of pending) await peer.connection.addIceCandidate(candidate);
      } else if (peer.connection.remoteDescription) {
        await peer.connection.addIceCandidate(payload.signal.candidate);
      } else {
        peer.pendingCandidates.push(payload.signal.candidate);
      }
    } catch {
      this.callbacks.onError("Falha ao negociar uma conexão de voz. Tentando restabelecer a linha.");
      this.callbacks.onConnectionChange("failed");
    }
  }

  setTransmitting(transmitting: boolean): void {
    this.transmitting = transmitting;
    this.applyTrackState();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.transmitting = false;
    this.applyTrackState();
  }

  private createPeer(playerId: string): PeerConnectionEntry {
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: PeerConnectionEntry = {
      connection,
      pendingCandidates: [],
      audio: null,
      stream: null,
    };
    this.peers.set(playerId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) connection.addTrack(track, this.localStream);
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate || !this.activeChannelId) return;
      this.room?.send("voice_signal", {
        channelId: this.activeChannelId,
        targetPlayerId: playerId,
        signal: {
          type: "candidate",
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment,
          },
        },
      });
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      peer.stream = stream;
      if (!peer.audio) {
        peer.audio = document.createElement("audio");
        peer.audio.autoplay = true;
        peer.audio.dataset.radioPlayer = playerId;
        peer.audio.style.display = "none";
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = stream;
      peer.audio.volume = this.outputVolume;
      void peer.audio.play().catch(() => {
        this.callbacks.onError("Interaja com a página para liberar a reprodução do rádio.");
      });
      this.monitorStream(playerId, stream);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        this.callbacks.onConnectionChange("connected");
      } else if (connection.connectionState === "failed") {
        this.callbacks.onConnectionChange("failed");
      } else if (connection.connectionState === "connecting") {
        this.callbacks.onConnectionChange("connecting");
      }
    };
    return peer;
  }

  private async sendOffer(playerId: string): Promise<void> {
    const peer = this.peers.get(playerId);
    if (!peer || !this.activeChannelId) return;
    try {
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      this.room?.send("voice_signal", {
        channelId: this.activeChannelId,
        targetPlayerId: playerId,
        signal: {
          type: "description",
          description: {
            type: peer.connection.localDescription!.type,
            sdp: peer.connection.localDescription!.sdp,
          },
        },
      });
    } catch {
      this.callbacks.onError("Não foi possível abrir a conexão de voz com um comandante.");
      this.callbacks.onConnectionChange("failed");
    }
  }

  private applyTrackState(): void {
    const enabled = Boolean(this.activeChannelId) && !this.muted && (!this.pushToTalk || this.transmitting);
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  private async replaceMicrophone(): Promise<void> {
    const generation = this.generation;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.microphoneId ? { exact: this.microphoneId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      if (generation !== this.generation || !this.activeChannelId) {
        for (const track of replacement.getTracks()) track.stop();
        return;
      }
      const nextTrack = replacement.getAudioTracks()[0];
      const previousTrack = this.localStream?.getAudioTracks()[0];
      if (!nextTrack) {
        for (const track of replacement.getTracks()) track.stop();
        return;
      }
      for (const peer of this.peers.values()) {
        const sender = peer.connection
          .getSenders()
          .find((entry) => entry.track?.kind === "audio" || (!entry.track && previousTrack));
        if (sender) await sender.replaceTrack(nextTrack);
      }
      previousTrack?.stop();
      this.localStream = replacement;
      this.stopMonitoring(this.myPlayerId);
      this.monitorStream(this.myPlayerId, replacement);
      this.applyTrackState();
    } catch {
      this.callbacks.onError("Não foi possível trocar o dispositivo de microfone.");
    }
  }

  private monitorStream(playerId: string, stream: MediaStream): void {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") void this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    this.monitored.set(playerId, {
      analyser,
      data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
    });
    if (this.monitorInterval !== null) return;
    this.monitorInterval = window.setInterval(() => this.measureSpeaking(), 120);
  }

  private measureSpeaking(): void {
    for (const [playerId, monitor] of this.monitored) {
      monitor.analyser.getByteTimeDomainData(monitor.data);
      let sum = 0;
      for (const sample of monitor.data) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / monitor.data.length);
      const locallyEnabled = playerId !== this.myPlayerId || (!this.muted && (!this.pushToTalk || this.transmitting));
      this.callbacks.onSpeakingChange(playerId, locallyEnabled && rms > SPEAKING_THRESHOLD);
    }
  }

  private stopMonitoring(playerId?: string): void {
    if (playerId) {
      this.monitored.delete(playerId);
      this.callbacks.onSpeakingChange(playerId, false);
    } else {
      for (const id of this.monitored.keys()) this.callbacks.onSpeakingChange(id, false);
      this.monitored.clear();
    }
    if (this.monitored.size === 0 && this.monitorInterval !== null) {
      window.clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  private closePeer(playerId: string): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    peer.connection.close();
    peer.audio?.pause();
    if (peer.audio) peer.audio.srcObject = null;
    peer.audio?.remove();
    this.stopMonitoring(playerId);
    this.peers.delete(playerId);
  }

  private closeAllPeers(): void {
    for (const playerId of [...this.peers.keys()]) this.closePeer(playerId);
  }

  private stopLocalMedia(): void {
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
  }
}
