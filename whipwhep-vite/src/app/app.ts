import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';

// Angular Material imports
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MediasoupService } from './mediasoup.service';

interface RemoteStream {
  id: string;
  stream: MediaStream;
  peerId?: string;
  kind: string;
  producerId: string;
}

interface StreamQuality {
  resolution: string;
  fps: string;
  bitrate: string;
  codec: string;
  simulcast?: boolean;
  svc?: boolean;
  spatialLayers?: number;
  temporalLayers?: number;
}

interface WebRTCStat {
  type: string;
  label: string;
  value: string;
  icon: string;
}

interface NetworkStat {
  type: string;
  label: string;
  value: string;
  icon: string;
}

interface ServerInfo {
  status: string;
  workerId: string;
  routerId: string;
  rtpCapabilities: string;
  uptime: number;
  ip?: string; // For backward compatibility
}

interface TransportInfo {
  id: string;
  direction: 'send' | 'recv';
  state: string;
  protocol: string;
  bytesReceived?: number;
  bytesSent?: number;
  packetsReceived?: number;
  packetsSent?: number;
}

interface ProducerInfo {
  id: string;
  kind: 'audio' | 'video';
  paused: boolean;
  mimeType: string;
  spatialLayers?: number;
  temporalLayers?: number;
}

interface ConsumerInfo {
  id: string;
  kind: 'audio' | 'video';
  paused: boolean;
  producerId: string;
  spatialLayer?: number;
  temporalLayer?: number;
}

interface DataChannelInfo {
  id: string;
  label: string;
  protocol: string;
  ordered: boolean;
  state: string;
  messagesSent: number;
  messagesReceived: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatToolbarModule,
    MatListModule,
    MatDividerModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatTabsModule,
    MatExpansionModule,
    MatBadgeModule,
    MatSliderModule,
    MatTooltipModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  // Connection state
  isConnected = false;
  connectionState = 'disconnected';

  // Media states
  hasAudioProducer = false;
  hasVideoProducer = false;
  hasDataProducer = false;

  // Backward compatibility properties for HTML template
  isBroadcasting = false;
  isViewing = false;

  // Video player properties
  isPlaying = false;
  isBuffering = false;
  isMuted = false;
  isFullscreen = false;
  supportsPiP = false;
  showControls = true;
  volume = 80;
  selectedStreamIndex = 0;
  selectedQuality = 'auto';

  // Control visibility
  private controlsTimeout?: any;

  // Settings - optimized for screen sharing
  simulcastEnabled = true;  // ✅ Perfect for screen capture
  svcEnabled = false;       // ❌ Not needed, simulcast is better
  tcpTransportEnabled = true;
  dataChannelsEnabled = true;
  selectedSimulcastLayer = 3;

  // Stream states
  isLoading = false;
  loadingMessage = '';

  // UI state
  showSettings = false;
  showDiagnostics = false;
  selectedTab = 0;

  // Data
  remoteStreams: RemoteStream[] = [];
  serverUrl = 'ws://localhost:3000';

  // Quality options (keeping for future reference, but not used in UI)
  /*
  qualityOptions = [
    { value: 'low', label: 'Low (180p)', bitrate: 100000 },
    { value: 'medium', label: 'Medium (360p)', bitrate: 500000 },
    { value: 'high', label: 'High (720p)', bitrate: 1500000 },
    { value: 'ultra', label: 'Ultra (1080p 60fps)', bitrate: 3000000 }
  ];
  */

  simulcastLayers = [
    { value: 0, label: 'Low (180p)' },
    { value: 1, label: 'Medium (360p)' },
    { value: 2, label: 'High (720p)' },
    { value: 3, label: 'Ultra (1080p 60fps)' }
  ];

  // Stats and diagnostics
  streamQuality: StreamQuality = {
    resolution: '',
    fps: '',
    bitrate: '',
    codec: '',
    simulcast: false,
    svc: false,
    spatialLayers: 0,
    temporalLayers: 0
  };

  // Backward compatibility for HTML template
  stats = {
    producers: 0,
    consumers: 0,
    connections: 0
  };

  webrtcStats: WebRTCStat[] = [];
  networkStats: NetworkStat[] = [];
  serverInfo: ServerInfo = {
    status: 'disconnected',
    workerId: '',
    routerId: '',
    rtpCapabilities: '',
    uptime: 0,
    ip: 'localhost:3000'
  };

  // Backward compatibility for HTML template  
  serverProof = {
    isRelayed: false,
    rtpEndpoint: '',
    transportId: '',
    producerId: '',
    consumerId: ''
  };

  transports: TransportInfo[] = [];
  producers: ProducerInfo[] = [];
  consumers: ConsumerInfo[] = [];
  dataChannels: DataChannelInfo[] = [];

  // Chat/Data messages
  chatMessages: { from: string, message: string, timestamp: Date }[] = [];
  newMessage = '';

  private subscriptions: Subscription[] = [];
  private statsInterval?: any;

  constructor(
    private mediasoupService: MediasoupService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    try {
      this.setLoading(true, 'Инициализация mediasoup...');
      
      // Initialize device
      await this.mediasoupService.initializeDevice();
      
      // Create transports automatically to be ready for existing producers
      await this.mediasoupService.createTransports();
      
      // Setup subscriptions to track states
      this.setupSubscriptions();
      
      // Check Picture-in-Picture support
      this.supportsPiP = 'pictureInPictureEnabled' in document;
      
      this.showSuccessMessage('Mediasoup инициализирован и готов');
      
    } catch (error) {
      console.error('Failed to initialize:', error);
      this.showErrorMessage('Ошибка инициализации');
    } finally {
      this.setLoading(false);
    }
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
    }
    this.mediasoupService.disconnect();
  }

  private setupSubscriptions(): void {
    // Monitor connection status
    setInterval(() => {
      this.isConnected = this.mediasoupService.isReady;
      this.hasAudioProducer = this.mediasoupService.hasAudioProducer;
      this.hasVideoProducer = this.mediasoupService.hasVideoProducer;
      this.hasDataProducer = this.mediasoupService.hasDataProducer;
      this.connectionState = this.isConnected ? 'connected' : 'disconnected';
      
      // Update backward compatibility properties
      this.isBroadcasting = this.hasAudioProducer || this.hasVideoProducer;
      this.isViewing = this.remoteStreams.length > 0;
    }, 1000);

    // Monitor remote streams
    setInterval(() => {
      const remoteStreams = this.mediasoupService.getRemoteStreams;
      this.remoteStreams = Array.from(remoteStreams.entries()).map(([id, stream]) => ({
        id,
        stream,
        kind: stream.getTracks()[0]?.kind || 'unknown',
        producerId: id
      }));
      
      // Auto-select first stream if none selected
      if (this.remoteStreams.length > 0 && this.selectedStreamIndex >= this.remoteStreams.length) {
        this.selectedStreamIndex = 0;
      }
    }, 1000);

    // Monitor video quality in real-time
    setInterval(() => {
      if (this.isBroadcasting && this.localVideoRef?.nativeElement?.srcObject) {
        const stream = this.localVideoRef.nativeElement.srcObject as MediaStream;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          this.streamQuality = {
            ...this.streamQuality,
            resolution: `${settings.width || 0}x${settings.height || 0}`,
            fps: settings.frameRate?.toFixed(0) || 'Unknown'
          };
        }
      }
    }, 2000);

    // Setup fullscreen event listeners
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
    });

    document.addEventListener('webkitfullscreenchange', () => {
      this.isFullscreen = !!(document as any).webkitFullscreenElement;
    });

    document.addEventListener('mozfullscreenchange', () => {
      this.isFullscreen = !!(document as any).mozFullScreenElement;
    });

    document.addEventListener('msfullscreenchange', () => {
      this.isFullscreen = !!(document as any).msFullscreenElement;
    });

    // Start diagnostics if connected
    this.statsInterval = setInterval(() => {
      if (this.isConnected) {
        this.collectStats();
      }
    }, 2000);
  }

  async connect() {
    try {
      this.setLoading(true, 'Подключение к серверу...');
      
      await this.mediasoupService.initializeDevice();
      await this.mediasoupService.createTransports();
      
      this.showSuccessMessage('Успешно подключено к серверу');
      
    } catch (error) {
      console.error('Connection failed:', error);
      this.showErrorMessage('Не удалось подключиться к серверу');
    } finally {
      this.setLoading(false);
    }
  }

  async disconnect() {
    try {
      this.setLoading(true, 'Отключение...');
      
      await this.mediasoupService.disconnect();
      
      // Clear local video
      if (this.localVideoRef?.nativeElement) {
        this.localVideoRef.nativeElement.srcObject = null;
      }
      
      // Clear remote streams
      this.remoteStreams = [];
      
      this.showInfoMessage('Отключено от сервера');
      
    } catch (error) {
      console.error('Disconnect failed:', error);
      this.showErrorMessage('Ошибка отключения');
    } finally {
      this.setLoading(false);
    }
  }

  async startAudio() {
    try {
      this.setLoading(true, 'Запуск аудио...');
      
      // Create transports if not available
      if (!this.mediasoupService.isReady) {
        await this.mediasoupService.createTransports();
      }
      
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTrack = stream.getAudioTracks()[0];
      
      await this.mediasoupService.produceAudio(audioTrack);
      
      this.showSuccessMessage('Аудио запущено');
      
    } catch (error: any) {
      console.error('Failed to start audio:', error);
      if (error.name === 'NotAllowedError') {
        this.showErrorMessage('Доступ к микрофону запрещен');
      } else {
        this.showErrorMessage('Не удалось запустить аудио');
      }
    } finally {
      this.setLoading(false);
    }
  }

  async startVideo() {
    try {
      this.setLoading(true, 'Запуск видео...');
      
      // Create transports if not available
      if (!this.mediasoupService.isReady) {
        await this.mediasoupService.createTransports();
      }
      
      // Use screen capture with 60fps priority
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 60, max: 60 } // Prioritize 60fps
        },
        audio: true // Include system audio if available
      });
      
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0]; // System audio if available
      
      // Set broadcasting to true BEFORE showing local video
      this.isBroadcasting = true;
      
      // Wait for next change detection cycle
      setTimeout(() => {
        // Show local video
        if (this.localVideoRef?.nativeElement) {
          this.localVideoRef.nativeElement.srcObject = stream;
          console.log('🎥 Local video stream set:', stream);
        } else {
          console.warn('⚠️ localVideoRef not available');
        }
      }, 100);
      
      // Produce video with simulcast if enabled
      await this.mediasoupService.produceVideo(videoTrack, this.simulcastEnabled);
      
      // Produce system audio if available
      if (audioTrack) {
        try {
          await this.mediasoupService.produceAudio(audioTrack);
          console.log('🔊 System audio captured successfully');
        } catch (error) {
          console.warn('⚠️ Failed to capture system audio:', error);
        }
      }
      
      // Update quality info with real values
      const settings = videoTrack.getSettings();
      console.log('🎥 Video track settings:', settings);
      
      this.streamQuality = {
        resolution: `${settings.width || 0}x${settings.height || 0}`,
        fps: settings.frameRate?.toFixed(0) || 'Unknown',
        bitrate: this.getSelectedBitrate(),
        codec: 'VP8', // Will be determined by negotiation
        simulcast: this.simulcastEnabled,
        svc: false, // Disabled - using Simulcast instead
        spatialLayers: this.simulcastEnabled ? 4 : 1, // 4 layers: 180p, 360p, 720p, 1080p
        temporalLayers: this.simulcastEnabled ? 3 : 1  // 3 temporal layers for smooth adaptation
      };
      
      console.log('📊 Stream quality updated:', this.streamQuality);
      
      // Handle screen share ended
      videoTrack.addEventListener('ended', () => {
        console.log('📺 Screen sharing ended');
        this.stopVideo();
      });
      
      this.showSuccessMessage('Захват экрана запущен');
      
    } catch (error: any) {
      console.error('Failed to start video:', error);
      this.isBroadcasting = false; // Reset on error
      if (error.name === 'NotAllowedError') {
        this.showErrorMessage('Доступ к захвату экрана запрещен');
      } else {
        this.showErrorMessage('Не удалось запустить захват экрана');
      }
    } finally {
      this.setLoading(false);
    }
  }

  async startDataChannel() {
    try {
      this.setLoading(true, 'Создание DataChannel...');
      
      await this.mediasoupService.produceData('chat', 'text');
      
      this.showSuccessMessage('DataChannel создан');
      
    } catch (error) {
      console.error('Failed to start data channel:', error);
      this.showErrorMessage('Не удалось создать DataChannel');
    } finally {
      this.setLoading(false);
    }
  }

  async stopAudio() {
    try {
      this.setLoading(true, 'Остановка аудио...');
      
      await this.mediasoupService.pauseProducer('audio');
      
      this.showInfoMessage('Аудио остановлено');
      
    } catch (error) {
      console.error('Failed to stop audio:', error);
      this.showErrorMessage('Ошибка остановки аудио');
    } finally {
      this.setLoading(false);
    }
  }

  async stopVideo() {
    try {
      this.setLoading(true, 'Остановка видео...');
      
      // Stop all tracks in local video
      if (this.localVideoRef?.nativeElement && this.localVideoRef.nativeElement.srcObject) {
        const stream = this.localVideoRef.nativeElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          track.stop();
          console.log(`🛑 Stopped track: ${track.kind}`);
        });
        this.localVideoRef.nativeElement.srcObject = null;
      }
      
      await this.mediasoupService.pauseProducer('video');
      
      // Reset broadcasting state
      this.isBroadcasting = false;
      
      this.showInfoMessage('Видео остановлено');
      
    } catch (error) {
      console.error('Failed to stop video:', error);
      this.showErrorMessage('Ошибка остановки видео');
    } finally {
      this.setLoading(false);
    }
  }

  async sendMessage() {
    if (!this.newMessage.trim()) return;
    
    try {
      await this.mediasoupService.sendData(this.newMessage);
      
      this.chatMessages.push({
        from: 'Me',
        message: this.newMessage,
        timestamp: new Date()
      });
      
      this.newMessage = '';
      
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showErrorMessage('Не удалось отправить сообщение');
    }
  }

  // Backward compatibility methods for HTML template
  async startBroadcast() {
    try {
      this.setLoading(true, 'Запуск захвата экрана...');
      
      // Initialize device if needed
      if (!this.mediasoupService.isReady) {
        await this.mediasoupService.initializeDevice();
        await this.mediasoupService.createTransports();
      }
      
      // Only start screen capture, not microphone
      await this.startVideo();
      
      this.showSuccessMessage('Захват экрана запущен');
      
    } catch (error: any) {
      console.error('Failed to start broadcast:', error);
      this.showErrorMessage('Не удалось запустить захват экрана');
    } finally {
      this.setLoading(false);
    }
  }

  async stopBroadcast() {
    await this.stopVideo();
  }

  async startViewing() {
    try {
      this.setLoading(true, 'Подключение к просмотру...');
      
      // Initialize device and create transports if needed
      if (!this.mediasoupService.isReady) {
        await this.mediasoupService.initializeDevice();
        await this.mediasoupService.createTransports();
      }
      
      this.isViewing = true;
      this.showSuccessMessage('Подключено к просмотру');
      
    } catch (error: any) {
      console.error('Failed to start viewing:', error);
      this.showErrorMessage('Не удалось подключиться к просмотру');
    } finally {
      this.setLoading(false);
    }
  }

  async stopViewing() {
    // Stop receiving streams
    this.isViewing = false;
    this.selectedQuality = 'auto';
    this.showInfoMessage('Отключено от просмотра');
  }

  getTransportIcon(type: string): string {
    switch (type) {
      case 'dtls': return 'security';
      case 'ice': return 'ac_unit';
      case 'sctp': return 'import_export';
      case 'rtp': return 'stream';
      default: return 'device_unknown';
    }
  }

  getNetworkIcon(type: string): string {
    switch (type) {
      case 'bandwidth': return 'speed';
      case 'packets': return 'grain';
      case 'bytes': return 'data_usage';
      case 'jitter': return 'graphic_eq';
      case 'fps': return 'videocam';
      default: return 'network_check';
    }
  }

  // Removed manual quality selection methods - auto quality works better
  /*
  async setQuality(quality: string) {
    this.selectedQuality = quality;
    const option = this.qualityOptions.find(o => o.value === quality);
    
    if (!option) {
      console.warn(`Unknown quality option: ${quality}`);
      return;
    }

    try {
      console.log(`🎯 Setting quality to ${quality} (${option.label})`);

      // For viewers - change simulcast layer
      if (this.isViewing && this.simulcastEnabled) {
        let spatialLayer: number;
        switch (quality) {
          case 'low':
            spatialLayer = 0;
            break;
          case 'medium':
            spatialLayer = 1;
            break;
          case 'high':
            spatialLayer = 2;
            break;
          case 'ultra':
            spatialLayer = 3;
            break;
          default:
            spatialLayer = 3;
        }
        
        console.log(`🔄 Viewer: Setting simulcast layer to ${spatialLayer}`);
        await this.mediasoupService.setSimulcastLayer(spatialLayer);
        this.selectedSimulcastLayer = spatialLayer;
      }

      // For broadcasters - change bandwidth
      if (this.isBroadcasting) {
        console.log(`📊 Broadcaster: Setting bandwidth to ${option.bitrate} bps`);
        await this.mediasoupService.setBandwidth('video', option.bitrate);
      }

      this.showInfoMessage(`Качество установлено: ${option.label}`);
      
    } catch (error) {
      console.error('Failed to change quality:', error);
      this.showErrorMessage('Не удалось изменить качество');
    }
  }
  */

  private getSelectedBitrate(): string {
    // Auto quality - return default high bitrate
    return '3000 kbps';
  }

  private async collectStats() {
    try {
      // Collect transport stats
      const transportStats = await this.mediasoupService.getTransportStats();
      this.updateTransportStats(transportStats);
      
      // Collect WebRTC stats
      await this.collectWebRTCStats();
      
      // Collect network stats
      await this.collectNetworkStats();
      
      // Update server info
      this.updateServerInfo();
      
      // Update backward compatibility properties
      this.stats = {
        producers: this.producers.length,
        consumers: this.consumers.length,
        connections: this.isConnected ? 1 : 0
      };
      
      this.serverProof = {
        isRelayed: this.isConnected,
        rtpEndpoint: this.isConnected ? 'localhost:40000-49999' : '',
        transportId: this.transports[0]?.id || '',
        producerId: this.producers[0]?.id || '',
        consumerId: this.consumers.length > 0 ? Array.from(this.mediasoupService.getConsumers.keys())[0] : ''
      };
      
    } catch (error) {
      console.warn('Failed to collect stats:', error);
    }
  }

  private updateTransportStats(stats: { send?: RTCStatsReport, recv?: RTCStatsReport }) {
    this.transports = [];
    
    if (stats.send) {
      stats.send.forEach(report => {
        if (report.type === 'transport') {
          this.transports.push({
            id: 'send-transport',
            direction: 'send',
            state: report.dtlsState || 'unknown',
            protocol: 'WebRTC',
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent
          });
        }
      });
    }
    
    if (stats.recv) {
      stats.recv.forEach(report => {
        if (report.type === 'transport') {
          this.transports.push({
            id: 'recv-transport',
            direction: 'recv',
            state: report.dtlsState || 'unknown',
            protocol: 'WebRTC',
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived
          });
        }
      });
    }
  }

  private async collectWebRTCStats() {
    this.webrtcStats = [
      {
        type: 'connection',
        label: 'Connection State',
        value: this.connectionState,
        icon: this.isConnected ? 'wifi' : 'wifi_off'
      },
      {
        type: 'producers',
        label: 'Active Producers',
        value: `${this.producers.length}`,
        icon: 'videocam'
      },
      {
        type: 'consumers',
        label: 'Active Consumers',
        value: `${this.consumers.length}`,
        icon: 'video_library'
      },
      {
        type: 'dataChannels',
        label: 'Data Channels',
        value: `${this.dataChannels.length}`,
        icon: 'chat'
      }
    ];
  }

  private async collectNetworkStats() {
    const config = this.mediasoupService.getConfig;
    
    this.networkStats = [
      {
        type: 'simulcast',
        label: 'Simulcast',
        value: config.simulcastEnabled ? 'Enabled' : 'Disabled',
        icon: 'layers'
      },
      {
        type: 'svc',
        label: 'SVC',
        value: config.svcEnabled ? 'Enabled' : 'Disabled',
        icon: 'grain'
      },
      {
        type: 'tcp',
        label: 'TCP Transport',
        value: config.tcpTransportEnabled ? 'Enabled' : 'Disabled',
        icon: 'router'
      },
      {
        type: 'dataChannels',
        label: 'Data Channels',
        value: config.dataChannelsEnabled ? 'Enabled' : 'Disabled',
        icon: 'import_export'
      }
    ];
  }

  private updateServerInfo() {
    // This would be populated from actual server status
    this.serverInfo = {
      status: this.isConnected ? 'connected' : 'disconnected',
      workerId: 'worker-1',
      routerId: 'router-1', 
      rtpCapabilities: 'loaded',
      uptime: Date.now(),
      ip: 'localhost:3000'
    };
  }

  trackByStreamId(index: number, stream: RemoteStream): string {
    return stream.id;
  }

  getPlaceholderIcon(): string {
    if (!this.isConnected) {
      return 'wifi_off';
    }
    if (this.remoteStreams.length === 0) {
      return 'video_library';
    }
    return 'play_circle';
  }

  getPlaceholderText(): string {
    if (!this.isConnected) {
      return 'Connect to the server to start streaming';
    }
    if (this.remoteStreams.length === 0) {
      return 'Start broadcasting from another device or browser tab';
    }
    return 'Select a stream to start viewing';
  }

  private setLoading(loading: boolean, message: string = '') {
    this.isLoading = loading;
    this.loadingMessage = message;
  }

  private showSuccessMessage(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  private showErrorMessage(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showInfoMessage(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['info-snackbar']
    });
  }

  // Helper methods
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatBitrate(bitrate: number): string {
    if (bitrate === 0) return '0 bps';
    const k = 1000;
    const sizes = ['bps', 'kbps', 'Mbps', 'Gbps'];
    const i = Math.floor(Math.log(bitrate) / Math.log(k));
    return parseFloat((bitrate / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getStateIcon(state: string): string {
    switch (state) {
      case 'connected': return 'check_circle';
      case 'connecting': return 'hourglass_empty';
      case 'disconnected': return 'cancel';
      case 'failed': return 'error';
      default: return 'help';
    }
  }

  getStateColor(state: string): string {
    switch (state) {
      case 'connected': return 'primary';
      case 'connecting': return 'accent';
      case 'disconnected': return 'warn';
      case 'failed': return 'warn';
      default: return '';
    }
  }

  // Video Player Methods

  // Get the currently selected video element
  getSelectedVideoElement(): HTMLVideoElement | null {
    if (this.isBroadcasting && this.localVideoRef?.nativeElement) {
      return this.localVideoRef.nativeElement;
    }
    if (this.isViewing && this.remoteVideoRef?.nativeElement) {
      return this.remoteVideoRef.nativeElement;
    }
    return null;
  }

  // Get selected stream
  getSelectedStream() {
    return this.remoteStreams[this.selectedStreamIndex] || null;
  }

  // Select stream by index
  selectStream(index: number): void {
    if (index >= 0 && index < this.remoteStreams.length) {
      this.selectedStreamIndex = index;
      
      // Update video source if viewing
      if (this.isViewing && this.remoteVideoRef?.nativeElement) {
        const selectedStream = this.getSelectedStream();
        if (selectedStream) {
          this.remoteVideoRef.nativeElement.srcObject = selectedStream.stream;
        }
      }
    }
  }

  // Get video display CSS class
  getVideoDisplayClass(): string {
    const classes = ['video-display'];
    if (this.isFullscreen) classes.push('fullscreen');
    if (this.isBuffering) classes.push('buffering');
    return classes.join(' ');
  }

  // Show video controls
  showVideoControls(): void {
    this.showControls = true;
  }

  // Hide video controls with delay
  hideVideoControls(): void {
    this.showControls = true;
  }

  // Toggle play/pause
  togglePlayPause(): void {
    if (this.remoteVideoRef?.nativeElement) {
      const video = this.remoteVideoRef.nativeElement;
      if (this.isPlaying) {
        video.pause();
      } else {
        video.play();
      }
    }
  }

  // Toggle mute
  toggleMute(): void {
    if (this.remoteVideoRef?.nativeElement) {
      const video = this.remoteVideoRef.nativeElement;
      this.isMuted = !this.isMuted;
      video.muted = this.isMuted;
    }
  }

  // Handle volume slider change
  onVolumeSliderChange(event: any): void {
    const value = event.value || event.target?.value;
    if (value !== undefined && value !== null && isFinite(value)) {
      const volume = Math.max(0, Math.min(value, 100));
      this.volume = volume;
      
      const video = this.getSelectedVideoElement();
      if (video) {
        video.volume = volume / 100;
        video.muted = volume === 0;
        this.isMuted = volume === 0;
      }
    }
  }

  // Toggle fullscreen
  toggleFullscreen(): void {
    const videoContainer = document.querySelector('.video-player-wrapper');
    if (!videoContainer) return;

    if (!this.isFullscreen) {
      if (videoContainer.requestFullscreen) {
        videoContainer.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  // Toggle Picture-in-Picture
  async togglePictureInPicture(): Promise<void> {
    if (!this.supportsPiP || !this.remoteVideoRef?.nativeElement) return;

    const video = this.remoteVideoRef.nativeElement;
    
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.error('Picture-in-Picture failed:', error);
    }
  }

  // Video event handlers
  onVideoLoaded(event: Event): void {
    const video = event.target as HTMLVideoElement;
    // Removed time tracking - not needed for live streaming
    // this.duration = video.duration || 0;
    this.isBuffering = false;
  }

  onLocalVideoLoaded(event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.log('🎥 Local video loaded successfully:', {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      // Removed time tracking - not needed for live streaming
      // duration: video.duration,
      srcObject: video.srcObject
    });
  }

  onTimeUpdate(event: Event): void {
    const video = event.target as HTMLVideoElement;
    // Removed time tracking - not needed for live streaming
    // this.currentTime = video.currentTime || 0;
  }

  onDurationChange(event: Event): void {
    const video = event.target as HTMLVideoElement;
    // Removed time tracking - not needed for live streaming
    // this.duration = video.duration || 0;
  }

  onVolumeChange(event: Event): void {
    const video = event.target as HTMLVideoElement;
    this.volume = Math.round(video.volume * 100);
    this.isMuted = video.muted;
  }

  // Format time for display
  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // Get placeholder content
  getPlaceholderTitle(): string {
    if (!this.isConnected) {
      return 'Not Connected';
    }
    if (this.remoteStreams.length === 0) {
      return 'No Streams Available';
    }
    return 'Ready to Play';
  }

  // Change simulcast layer (keeping for backward compatibility)
  async changeSimulcastLayer(layerIndex: number): Promise<void> {
    try {
      if (!this.isViewing) return;
      
      const selectedStream = this.getSelectedStream();
      if (!selectedStream) return;
      
      console.log(`🔄 Changing simulcast layer to ${layerIndex}`);
      await this.mediasoupService.setSimulcastLayer(layerIndex);
      
      this.selectedSimulcastLayer = layerIndex;
      this.showInfoMessage(`Слой изменен на ${layerIndex}`);
      
    } catch (error) {
      console.error('Failed to change simulcast layer:', error);
    }
  }

  async setSimulcastLayer(layer: number) {
    try {
      await this.mediasoupService.setSimulcastLayer(layer);
      this.selectedSimulcastLayer = layer;
      this.showSuccessMessage(`Switched to layer ${layer}`);
      await this.collectStats();
    } catch (error) {
      console.error('Failed to set simulcast layer:', error);
      this.showErrorMessage(`Failed to switch to layer ${layer}`);
    }
  }

  onQualityChange(event: any): void {
    const quality = event.value;
    console.log('🎯 Quality change requested:', quality);
    
    this.selectedQuality = quality;
    
    // Получаем ID video consumer
    const videoConsumerId = this.mediasoupService.getVideoConsumerId();
    if (!videoConsumerId) {
      console.warn('⚠️ No video consumer available for quality change');
      this.showErrorMessage('No active video stream to change quality');
      return;
    }
    
    console.log('🔍 Video Consumer ID:', videoConsumerId);
    
    if (quality === 'auto') {
      // Сброс на автоматический режим - убираем предпочтительные слои
      console.log('🔄 Setting quality to AUTO mode');
      this.mediasoupService.setConsumerPreferredLayers(videoConsumerId)
        .then(() => {
          console.log('✅ AUTO mode activated successfully');
          this.showInfoMessage('Quality set to AUTO');
        })
        .catch((error) => {
          console.error('❌ Failed to set AUTO mode:', error);
          this.showErrorMessage('Failed to set AUTO mode');
        });
    } else {
      // Принудительная установка слоя
      const layer = this.getQualityLayer(quality);
      console.log('🎯 Quality layer for', quality, ':', layer);
      
      if (layer) {
        console.log('🔄 Setting preferred layers:', layer);
        this.mediasoupService.setConsumerPreferredLayers(
          videoConsumerId, 
          layer.spatialLayer, 
          layer.temporalLayer
        )
        .then(() => {
          console.log('✅ Quality locked to', quality);
          this.showInfoMessage(`Quality locked to ${quality}`);
        })
        .catch((error) => {
          console.error('❌ Failed to set quality:', error);
          this.showErrorMessage(`Failed to set quality to ${quality}`);
        });
      } else {
        console.error('❌ Invalid quality layer for', quality);
        this.showErrorMessage('Invalid quality setting');
      }
    }
  }

  private getQualityLayer(quality: string) {
    console.log('🔍 Getting quality layer for:', quality);
    
    const layers: { [key: string]: { spatialLayer: number; temporalLayer: number } } = {
      '1080p': { spatialLayer: 3, temporalLayer: 2 }, // r3 - High quality
      '720p': { spatialLayer: 2, temporalLayer: 2 },  // r2 - Medium quality  
      '480p': { spatialLayer: 1, temporalLayer: 1 },  // r1 - Low quality
      '360p': { spatialLayer: 0, temporalLayer: 0 }   // r0 - Lowest quality
    };
    
    const result = layers[quality] || null;
    console.log('🎯 Layer mapping result:', result);
    return result;
  }
}
