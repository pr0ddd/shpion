import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

// Используем типы напрямую из mediasoup-client
type Device = mediasoupClient.types.Device;
type Transport = mediasoupClient.types.Transport;
type Producer = mediasoupClient.types.Producer;
type Consumer = mediasoupClient.types.Consumer;
type DataProducer = mediasoupClient.types.DataProducer;
type DataConsumer = mediasoupClient.types.DataConsumer;
type RtpCapabilities = mediasoupClient.types.RtpCapabilities;
type MediaKind = mediasoupClient.types.MediaKind;
type ProducerOptions = mediasoupClient.types.ProducerOptions;
type ConsumerOptions = mediasoupClient.types.ConsumerOptions;
type RtpCodecCapability = mediasoupClient.types.RtpCodecCapability;

interface MediasoupConfig {
  simulcastEnabled: boolean;
  svcEnabled: boolean;
  dataChannelsEnabled: boolean;
  tcpTransportEnabled: boolean;
  preferredCodecs: {
    audio: string[];
    video: string[];
  };
  simulcastEncodings: RTCRtpEncodingParameters[];
  svcModes: {
    [key: string]: string;
  };
  bandwidthSettings: {
    audio: number;
    video: {
      low: number;
      medium: number;
      high: number;
      ultra: number;
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class MediasoupService {
  private socket!: Socket;
  private device!: Device;
  private isConnected = false;
  private isDeviceLoaded = false;
  private isDisconnecting = false;

  // Transport instances
  private sendTransport?: Transport;
  private recvTransport?: Transport;

  // Producer instances
  private audioProducer?: Producer;
  private videoProducer?: Producer;

  // Data instances
  private dataProducer?: DataProducer;
  private dataConsumers = new Map<string, DataConsumer>();

  // Consumer instances
  private consumers = new Map<string, Consumer>();

  // Local tracks
  private localVideoTrack?: MediaStreamTrack;
  private localAudioTrack?: MediaStreamTrack;
  public remoteStreams = new Map<string, MediaStream>();

  // Stats intervals tracking
  private consumerStatsIntervals = new Map<string, any>();
  private producerStatsIntervals = new Map<string, any>();

  // Configuration based on official documentation
  private config: MediasoupConfig = {
    simulcastEnabled: true,
    svcEnabled: true,
    dataChannelsEnabled: true,
    tcpTransportEnabled: true,
    preferredCodecs: {
      audio: ['audio/opus'],
      video: ['video/VP8', 'video/VP9', 'video/h264', 'video/AV1']
    },
    simulcastEncodings: [
      // Low quality - 180p
      { 
        rid: 'r0',
        maxBitrate: 100000,
        maxFramerate: 15,
        scaleResolutionDownBy: 6.0
      },
      // Medium quality - 360p
      { 
        rid: 'r1',
        maxBitrate: 300000,
        maxFramerate: 30,
        scaleResolutionDownBy: 3.0
      },
      // High quality - 720p
      { 
        rid: 'r2',
        maxBitrate: 1500000,
        maxFramerate: 30,
        scaleResolutionDownBy: 1.5
      },
      // Ultra quality - 1080p 60fps
      { 
        rid: 'r3',
        maxBitrate: 3000000,
        maxFramerate: 60,
        scaleResolutionDownBy: 1.0
      }
    ],
    svcModes: {
      'L1T3': 'Single spatial layer, 3 temporal layers',
      'L2T3': '2 spatial layers, 3 temporal layers',  
      'L3T3': '3 spatial layers, 3 temporal layers',
      'L4T3': '4 spatial layers, 3 temporal layers (with 1080p)',
      'L4T7': '4 spatial layers, 7 temporal layers (ultra quality)'
    },
    bandwidthSettings: {
      audio: 128000, // 128kbps for Opus
      video: {
        low: 100000,    // 100kbps
        medium: 500000, // 500kbps
        high: 2000000,  // 2Mbps
        ultra: 3000000  // 3Mbps for 1080p 60fps
      }
    }
  };

  constructor() {
    this.initializeSocket();
  }

  // Initialize socket connection
  private initializeSocket(): void {
    this.socket = io('http://localhost:3000', {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.isDisconnecting = false; // Reset disconnecting flag
      console.log('✅ Socket connected:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('❌ Socket disconnected:', reason);
      if (reason === 'io server disconnect' || reason === 'transport close') {
        this.handleDisconnection();
      }
    });

    this.socket.on('connect_error', (error) => {
      this.isConnected = false;
      console.error('❌ Socket connection error:', error);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      this.isConnected = true;
      console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('❌ Socket reconnection error:', error);
    });

    this.setupMediasoupEventHandlers();
  }

  // Setup all mediasoup-related socket event handlers
  private setupMediasoupEventHandlers(): void {
    // Transport events
    this.socket.on('transportCreated', (data: any) => {
      console.log('🚚 Transport created:', data.transportId);
    });

    // Producer events  
    this.socket.on('newProducer', async (data: any) => {
      await this.consume(data);
    });

    this.socket.on('producerClosed', (data: any) => {
      this.handleProducerClosed(data.producerId);
    });

    this.socket.on('producerPaused', (data: any) => {
      this.handleProducerPaused(data.producerId);
    });

    this.socket.on('producerResumed', (data: any) => {
      this.handleProducerResumed(data.producerId);
    });

    // Consumer events
    this.socket.on('consumerClosed', (data: any) => {
      this.handleConsumerClosed(data.consumerId);
    });

    this.socket.on('consumerPaused', (data: any) => {
      this.handleConsumerPaused(data.consumerId);
    });

    this.socket.on('consumerResumed', (data: any) => {
      this.handleConsumerResumed(data.consumerId);
    });

    // Data events
    this.socket.on('newDataProducer', async (data: any) => {
      await this.consumeData(data);
    });

    this.socket.on('dataProducerClosed', (data: any) => {
      this.handleDataProducerClosed(data.dataProducerId);
    });

    // Error handlers
    this.socket.on('error', (error: any) => {
      console.error('❌ Socket error:', error);
    });
  }

  // Initialize device with optimal settings
  async initializeDevice(): Promise<void> {
    try {
      // Use Device.factory() for better browser detection
      this.device = await mediasoupClient.Device.factory();
      console.log('📱 Device created with handler:', this.device.handlerName);
      
      // Request router capabilities from server
      return new Promise((resolve, reject) => {
        this.socket.emit('getRouterRtpCapabilities', async (response: any) => {
          try {
            console.log('📋 Received RTP capabilities from server:', response);
            if (response && response.rtpCapabilities) {
              await this.loadDevice(response.rtpCapabilities);
              resolve();
            } else {
              console.error('❌ Invalid RTP capabilities response:', response);
              reject(new Error('Invalid RTP capabilities response'));
            }
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('❌ Failed to create device:', error);
      throw error;
    }
  }

  // Load device with server capabilities
  private async loadDevice(routerRtpCapabilities: RtpCapabilities): Promise<void> {
    try {
      await this.device.load({ 
        routerRtpCapabilities,
        preferLocalCodecsOrder: false // Use server codec order for better compatibility
      });
      
      this.isDeviceLoaded = true;
      console.log('✅ Device loaded successfully');
      console.log('🎯 Supported RTP capabilities:', this.device.rtpCapabilities);
      console.log('📊 SCTP capabilities:', this.device.sctpCapabilities);
      
      // Check codec support
      this.logCodecSupport();
      
    } catch (error) {
      console.error('❌ Failed to load device:', error);
      throw error;
    }
  }

  // Log supported codecs for debugging
  private logCodecSupport(): void {
    console.log('🎧 Can produce audio:', this.device.canProduce('audio'));
    console.log('📹 Can produce video:', this.device.canProduce('video'));
    
    const audioCodecs = this.device.rtpCapabilities.codecs?.filter((c: RtpCodecCapability) => c.kind === 'audio');
    const videoCodecs = this.device.rtpCapabilities.codecs?.filter((c: RtpCodecCapability) => c.kind === 'video');
    
    console.log('🎵 Audio codecs:', audioCodecs?.map((c: RtpCodecCapability) => c.mimeType));
    console.log('🎬 Video codecs:', videoCodecs?.map((c: RtpCodecCapability) => c.mimeType));
  }

  // Create optimized WebRTC transports
  async createTransports(): Promise<void> {
    if (!this.isDeviceLoaded) {
      throw new Error('Device not loaded');
    }

    try {
      // Create send transport
      await this.createSendTransport();
      
      // Create receive transport  
      await this.createRecvTransport();
      
      console.log('✅ Transports created successfully');
      
      // Now that transports are ready, request existing producers from server
      this.requestExistingProducers();
    } catch (error) {
      console.error('❌ Failed to create transports:', error);
      throw error;
    }
  }

  // Request existing producers from server after transports are ready
  private requestExistingProducers(): void {
    console.log('🔍 Requesting existing producers from server...');
    this.socket.emit('getExistingProducers', (response: any) => {
      if (response && response.producers) {
        console.log(`📡 Received ${response.producers.length} existing producers`);
        response.producers.forEach((producerData: any) => {
          console.log('🎬 Processing existing producer:', producerData);
          this.consume(producerData);
        });
      } else {
        console.log('📡 No existing producers found');
      }
    });
  }

  // Create send transport with optimal settings
  private async createSendTransport(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', { 
        direction: 'send',
        enableSctp: this.config.dataChannelsEnabled,
        numSctpStreams: { OS: 1024, MIS: 1024 },
        enableTcp: this.config.tcpTransportEnabled,
        enableUdp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000
      }, async (data: any) => {
        if (data.error) {
          console.error('❌ Error creating send transport:', data.error);
          reject(data.error);
          return;
        }

        try {
          this.sendTransport = this.device.createSendTransport({
            id: data.id,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
            sctpParameters: data.sctpParameters,
            iceServers: [], // Add TURN servers if needed
            iceTransportPolicy: 'all',
            additionalSettings: {
              // Enable experimental features if supported
            },
            appData: { 
              direction: 'send',
              createdAt: Date.now()
            }
          });

          this.setupSendTransportEvents();
          console.log('📤 Send transport created:', this.sendTransport.id);
          resolve();
        } catch (error) {
          console.error('❌ Failed to create send transport:', error);
          reject(error);
        }
      });
    });
  }

  // Create receive transport with optimal settings
  private async createRecvTransport(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', { 
        direction: 'recv',
        enableSctp: this.config.dataChannelsEnabled,
        numSctpStreams: { OS: 1024, MIS: 1024 },
        enableTcp: this.config.tcpTransportEnabled,
        enableUdp: true,
        preferUdp: true
      }, async (data: any) => {
        if (data.error) {
          console.error('❌ Error creating recv transport:', data.error);
          reject(data.error);
          return;
        }

        try {
          this.recvTransport = this.device.createRecvTransport({
            id: data.id,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
            sctpParameters: data.sctpParameters,
            iceServers: [], // Add TURN servers if needed
            iceTransportPolicy: 'all',
            appData: { 
              direction: 'recv',
              createdAt: Date.now()
            }
          });

          this.setupRecvTransportEvents();
          console.log('📥 Receive transport created:', this.recvTransport.id);
          resolve();
        } catch (error) {
          console.error('❌ Failed to create receive transport:', error);
          reject(error);
        }
      });
    });
  }

  // Setup send transport events
  private setupSendTransportEvents(): void {
    if (!this.sendTransport) return;

    // Handle connection
    this.sendTransport.on('connect', async ({ dtlsParameters }: any, callback: () => void, errback: (error: Error) => void) => {
      try {
        this.socket.emit('connectWebRtcTransport', {
          transportId: this.sendTransport!.id,
          dtlsParameters
        }, (response: any) => {
          if (response && response.error) {
            errback(new Error(response.error));
          } else {
            callback();
          }
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    // Handle produce
    this.sendTransport.on('produce', async (parameters: any, callback: (data: { id: string }) => void, errback: (error: Error) => void) => {
      try {
        this.socket.emit('produce', {
          transportId: this.sendTransport!.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData
        }, (response: any) => {
          if (response && response.error) {
            errback(new Error(response.error));
          } else {
            callback({ id: response.id });
          }
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    // Handle produce data
    this.sendTransport.on('producedata', async (parameters: any, callback: (data: { id: string }) => void, errback: (error: Error) => void) => {
      try {
        this.socket.emit('produceData', {
          transportId: this.sendTransport!.id,
          sctpStreamParameters: parameters.sctpStreamParameters,
          label: parameters.label,
          protocol: parameters.protocol,
          appData: parameters.appData
        }, (response: any) => {
          if (response && response.error) {
            errback(new Error(response.error));
          } else {
            callback({ id: response.id });
          }
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    // Connection state monitoring
    this.sendTransport.on('connectionstatechange', (state) => {
      console.log('📤 Send transport state:', state);
      if (state === 'failed' || state === 'disconnected') {
        this.handleTransportFailure('send');
      }
    });

    this.sendTransport.on('icegatheringstatechange', (state) => {
      console.log('📤 Send transport ICE gathering state:', state);
    });
  }

  // Setup receive transport events  
  private setupRecvTransportEvents(): void {
    if (!this.recvTransport) return;

    // Handle connection
    this.recvTransport.on('connect', async ({ dtlsParameters }: any, callback: () => void, errback: (error: Error) => void) => {
      try {
        this.socket.emit('connectWebRtcTransport', {
          transportId: this.recvTransport!.id,
          dtlsParameters
        }, (response: any) => {
          if (response && response.error) {
            errback(new Error(response.error));
          } else {
            callback();
          }
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    // Connection state monitoring
    this.recvTransport.on('connectionstatechange', (state) => {
      console.log('📥 Receive transport state:', state);
      if (state === 'failed' || state === 'disconnected') {
        this.handleTransportFailure('recv');
      }
    });

    this.recvTransport.on('icegatheringstatechange', (state) => {
      console.log('📥 Receive transport ICE gathering state:', state);
    });
  }

  // Produce audio with optimal settings
  async produceAudio(audioTrack: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Send transport not available');
    }

    try {
      const codecOptions = {
        opusStereo: true,
        opusFec: true,
        opusDtx: true,
        opusMaxPlaybackRate: 48000,
        opusMaxAverageBitrate: this.config.bandwidthSettings.audio,
        opusPtime: 20,
        opusNack: true
      };

      const producerOptions: ProducerOptions = {
        track: audioTrack,
        codecOptions,
        stopTracks: false, // Let app manage track lifecycle
        disableTrackOnPause: true,
        zeroRtpOnPause: false,
        appData: { 
          source: 'microphone',
          createdAt: Date.now()
        }
      };

      this.audioProducer = await this.sendTransport.produce(producerOptions);
      this.localAudioTrack = audioTrack;

      this.setupProducerEvents(this.audioProducer, 'audio');
      console.log('🎧 Audio producer created:', this.audioProducer.id);

    } catch (error) {
      console.error('❌ Failed to produce audio:', error);
      throw error;
    }
  }

  // Produce video with simulcast/SVC support
  async produceVideo(videoTrack: MediaStreamTrack, enableSimulcast = true): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Send transport not available');
    }

    try {
      let producerOptions: ProducerOptions;

      if (enableSimulcast && this.config.simulcastEnabled) {
        // Simulcast configuration
        producerOptions = {
          track: videoTrack,
          encodings: this.config.simulcastEncodings,
          codecOptions: {
            videoGoogleStartBitrate: 1000,
            videoGoogleMaxBitrate: this.config.bandwidthSettings.video.high,
            videoGoogleMinBitrate: this.config.bandwidthSettings.video.low
          },
          stopTracks: false,
          disableTrackOnPause: true,
          zeroRtpOnPause: false,
          appData: { 
            source: 'camera',
            simulcast: true,
            createdAt: Date.now()
          }
        };
      } else if (this.config.svcEnabled) {
        // SVC configuration
        producerOptions = {
          track: videoTrack,
          encodings: [{
            scalabilityMode: 'L4T3', // 4 spatial, 3 temporal layers (включая 1080p)
            maxBitrate: this.config.bandwidthSettings.video.ultra
          }],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
            videoGoogleMaxBitrate: this.config.bandwidthSettings.video.ultra,
            videoGoogleMinBitrate: this.config.bandwidthSettings.video.low
          },
          stopTracks: false,
          disableTrackOnPause: true,
          zeroRtpOnPause: false,
          appData: { 
            source: 'camera',
            svc: true,
            scalabilityMode: 'L4T3',
            createdAt: Date.now()
          }
        };
      } else {
        // Single stream
        producerOptions = {
          track: videoTrack,
          encodings: [{
            maxBitrate: this.config.bandwidthSettings.video.high
          }],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
            videoGoogleMaxBitrate: this.config.bandwidthSettings.video.high,
            videoGoogleMinBitrate: this.config.bandwidthSettings.video.low
          },
          stopTracks: false,
          disableTrackOnPause: true,
          zeroRtpOnPause: false,
          appData: { 
            source: 'camera',
            createdAt: Date.now()
          }
        };
      }

      this.videoProducer = await this.sendTransport.produce(producerOptions);
      this.localVideoTrack = videoTrack;

      this.setupProducerEvents(this.videoProducer, 'video');
      console.log('📹 Video producer created:', this.videoProducer.id);

    } catch (error) {
      console.error('❌ Failed to produce video:', error);
      throw error;
    }
  }

  // Setup producer events
  private setupProducerEvents(producer: Producer, kind: string): void {
    producer.on('transportclose', () => {
      console.log(`${kind} producer transport closed`);
      this.cleanupProducer(producer.id, kind);
    });

    producer.on('trackended', () => {
      console.log(`${kind} producer track ended`);
      // Notify server and UI
      this.socket.emit('producerClosed', { producerId: producer.id });
      this.cleanupProducer(producer.id, kind);
    });

    // Monitor stats for quality control with proper cleanup
    const statsInterval = setInterval(async () => {
      try {
        // Check if producer is still valid and not closed
        if (producer.closed || (!this.audioProducer?.id && !this.videoProducer?.id)) {
          console.log(`🔄 Clearing stats interval for closed producer: ${producer.id}`);
          clearInterval(statsInterval);
          this.producerStatsIntervals.delete(producer.id);
          return;
        }

        const stats = await producer.getStats();
        this.logProducerStats(stats, kind);
      } catch (error: any) {
        console.warn(`Failed to get ${kind} producer stats for ${producer.id}:`, error);
        // If getting stats fails, the producer might be closed
        if (error?.message?.includes('closed') || error?.name === 'InvalidStateError') {
          console.log(`🔄 Clearing stats interval for invalid producer: ${producer.id}`);
          clearInterval(statsInterval);
          this.producerStatsIntervals.delete(producer.id);
        }
      }
    }, 5000);

    // Track the interval for cleanup
    this.producerStatsIntervals.set(producer.id, statsInterval);
  }

  // Cleanup producer and its resources
  private cleanupProducer(producerId: string, kind: string): void {
    // Clear stats interval
    const statsInterval = this.producerStatsIntervals.get(producerId);
    if (statsInterval) {
      clearInterval(statsInterval);
      this.producerStatsIntervals.delete(producerId);
      console.log(`🔄 Cleared stats interval for ${kind} producer: ${producerId}`);
    }

    // Reset producer references
    if (kind === 'audio' && this.audioProducer?.id === producerId) {
      this.audioProducer = undefined;
      this.localAudioTrack = undefined;
    } else if (kind === 'video' && this.videoProducer?.id === producerId) {
      this.videoProducer = undefined;
      this.localVideoTrack = undefined;
    }
  }

  // Log producer statistics
  private logProducerStats(stats: RTCStatsReport, kind: string): void {
    stats.forEach(report => {
      if (report.type === 'outbound-rtp') {
        console.log(`📊 ${kind} producer stats:`, {
          bytesSent: report.bytesSent,
          packetsSent: report.packetsSent,
          packetsLost: report.packetsLost,
          targetBitrate: report.targetBitrate,
          qualityLimitationReason: report.qualityLimitationReason
        });
      }
    });
  }

  // Consume media with optimal settings
  async consume(data: any): Promise<void> {
    if (!this.recvTransport || !this.isDeviceLoaded || !this.isConnected) {
      console.warn('Receive transport, device, or connection not ready');
      return;
    }

    // Check if transport is still connected
    if (this.recvTransport.connectionState === 'disconnected' || 
        this.recvTransport.connectionState === 'failed' ||
        this.recvTransport.closed) {
      console.warn('Receive transport is disconnected/closed, skipping consume');
      return;
    }

    try {
      console.log('🔍 New producer detected:', data);
      
      // Request consume from server
      this.socket.emit('consume', {
        transportId: this.recvTransport.id,
        producerId: data.id,
        rtpCapabilities: this.device.rtpCapabilities,
      }, async (response: any) => {
        if (response && response.error) {
          console.error('❌ Error consuming:', response.error);
          return;
        }

        try {
          const consumerOptions: ConsumerOptions = {
            id: response.id,
            producerId: response.producerId,
            kind: response.kind as MediaKind,
            rtpParameters: response.rtpParameters,
            appData: response.appData || {}
          };

          const consumer = await this.recvTransport!.consume(consumerOptions);
          
          this.consumers.set(consumer.id, consumer);
          this.setupConsumerEvents(consumer);

          // Create media stream
          const stream = new MediaStream([consumer.track]);
          this.remoteStreams.set(consumer.id, stream);

          console.log(`✅ Consumer created: ${consumer.kind} from producer ${consumer.producerId}`);

          // Resume consumer after creation (recommended pattern)
          this.socket.emit('consumerResume', { consumerId: consumer.id }, (response: any) => {
            if (response && response.error) {
              console.error('❌ Error resuming consumer:', response.error);
            } else {
              console.log('✅ Consumer resumed successfully:', consumer.id);
            }
          });
          
        } catch (error) {
          console.error('❌ Failed to create consumer:', error);
        }
      });

    } catch (error) {
      console.error('❌ Failed to consume:', error);
    }
  }

  // Setup consumer events
  private setupConsumerEvents(consumer: Consumer): void {
    consumer.on('transportclose', () => {
      console.log('Consumer transport closed:', consumer.id);
      this.cleanupConsumer(consumer.id);
    });

    consumer.on('trackended', () => {
      console.log('Consumer track ended:', consumer.id);
    });

    // Monitor stats with proper cleanup
    const statsInterval = setInterval(async () => {
      try {
        // Check if consumer is still valid and not closed
        if (consumer.closed || !this.consumers.has(consumer.id)) {
          console.log(`🔄 Clearing stats interval for closed consumer: ${consumer.id}`);
          clearInterval(statsInterval);
          this.consumerStatsIntervals.delete(consumer.id);
          return;
        }

        const stats = await consumer.getStats();
        this.logConsumerStats(stats, consumer.kind);
      } catch (error: any) {
        console.warn(`Failed to get consumer stats for ${consumer.id}:`, error);
        // If getting stats fails, the consumer might be closed
        if (error?.message?.includes('closed') || error?.name === 'InvalidStateError') {
          console.log(`🔄 Clearing stats interval for invalid consumer: ${consumer.id}`);
          clearInterval(statsInterval);
          this.consumerStatsIntervals.delete(consumer.id);
        }
      }
    }, 5000);

    // Track the interval for cleanup
    this.consumerStatsIntervals.set(consumer.id, statsInterval);
  }

  // Cleanup consumer and its resources
  private cleanupConsumer(consumerId: string): void {
    // Clear stats interval
    const statsInterval = this.consumerStatsIntervals.get(consumerId);
    if (statsInterval) {
      clearInterval(statsInterval);
      this.consumerStatsIntervals.delete(consumerId);
      console.log(`🔄 Cleared stats interval for consumer: ${consumerId}`);
    }

    // Remove from collections
    this.consumers.delete(consumerId);
    this.remoteStreams.delete(consumerId);
  }

  // Log consumer statistics
  private logConsumerStats(stats: RTCStatsReport, kind: string): void {
    stats.forEach(report => {
      if (report.type === 'inbound-rtp') {
        console.log(`📊 ${kind} consumer stats:`, {
          bytesReceived: report.bytesReceived,
          packetsReceived: report.packetsReceived,
          packetsLost: report.packetsLost,
          fractionLost: report.fractionLost,
          jitter: report.jitter
        });
      }
    });
  }

  // Produce data with DataChannel
  async produceData(label = 'default', protocol = ''): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Send transport not available');
    }

    try {
      this.dataProducer = await this.sendTransport.produceData({
        ordered: true,
        maxRetransmits: 3,
        label,
        protocol,
        appData: { 
          type: 'chat',
          createdAt: Date.now()
        }
      });

      this.setupDataProducerEvents();
      console.log('📡 Data producer created:', this.dataProducer.id);

    } catch (error) {
      console.error('❌ Failed to produce data:', error);
      throw error;
    }
  }

  // Setup data producer events
  private setupDataProducerEvents(): void {
    if (!this.dataProducer) return;

    this.dataProducer.on('open', () => {
      console.log('📡 Data producer opened');
    });

    this.dataProducer.on('error', (error) => {
      console.error('❌ Data producer error:', error);
    });

    this.dataProducer.on('close', () => {
      console.log('📡 Data producer closed');
    });

    this.dataProducer.on('transportclose', () => {
      console.log('📡 Data producer transport closed');
    });
  }

  // Consume data
  async consumeData(data: any): Promise<void> {
    if (!this.recvTransport) {
      console.warn('Receive transport not ready');
      return;
    }

    try {
      const dataConsumer = await this.recvTransport.consumeData({
        id: data.id,
        dataProducerId: data.dataProducerId,
        sctpStreamParameters: data.sctpStreamParameters,
        label: data.label,
        protocol: data.protocol,
        appData: data.appData || {}
      });

      this.dataConsumers.set(dataConsumer.id, dataConsumer);
      this.setupDataConsumerEvents(dataConsumer);

      console.log('📡 Data consumer created:', dataConsumer.id);

    } catch (error) {
      console.error('❌ Failed to consume data:', error);
    }
  }

  // Setup data consumer events
  private setupDataConsumerEvents(dataConsumer: DataConsumer): void {
    dataConsumer.on('open', () => {
      console.log('📡 Data consumer opened:', dataConsumer.id);
    });

    dataConsumer.on('message', (data) => {
      console.log('📡 Data received:', data);
      // Handle received data (chat, file transfer, etc.)
    });

    dataConsumer.on('error', (error) => {
      console.error('❌ Data consumer error:', error);
    });

    dataConsumer.on('close', () => {
      console.log('📡 Data consumer closed:', dataConsumer.id);
      this.dataConsumers.delete(dataConsumer.id);
    });

    dataConsumer.on('transportclose', () => {
      console.log('📡 Data consumer transport closed:', dataConsumer.id);
      this.dataConsumers.delete(dataConsumer.id);
    });
  }

  // Send data via DataChannel
  async sendData(message: string | ArrayBuffer): Promise<void> {
    if (!this.dataProducer) {
      throw new Error('Data producer not available');
    }

    try {
      this.dataProducer.send(message);
      console.log('📡 Data sent:', message);
    } catch (error) {
      console.error('❌ Failed to send data:', error);
      throw error;
    }
  }

  // Handle producer closed
  private handleProducerClosed(producerId: string): void {
    console.log('Producer closed:', producerId);
    
    // Determine the kind and cleanup
    let kind = 'unknown';
    if (this.audioProducer?.id === producerId) {
      kind = 'audio';
    } else if (this.videoProducer?.id === producerId) {
      kind = 'video';
    }
    
    this.cleanupProducer(producerId, kind);
  }

  // Handle producer paused
  private handleProducerPaused(producerId: string): void {
    console.log('Producer paused:', producerId);
    // Update UI to show paused state
  }

  // Handle producer resumed
  private handleProducerResumed(producerId: string): void {
    console.log('Producer resumed:', producerId);
    // Update UI to show resumed state
  }

  // Handle consumer closed
  private handleConsumerClosed(consumerId: string): void {
    const consumer = this.consumers.get(consumerId);
    if (consumer && !consumer.closed) {
      consumer.close();
    }
    
    this.cleanupConsumer(consumerId);
    console.log('Consumer closed and cleaned up:', consumerId);
  }

  // Handle consumer paused
  private handleConsumerPaused(consumerId: string): void {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      consumer.pause();
      console.log('Consumer paused:', consumerId);
    }
  }

  // Handle consumer resumed
  private handleConsumerResumed(consumerId: string): void {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      consumer.resume();
      console.log('Consumer resumed:', consumerId);
    }
  }

  // Handle data producer closed
  private handleDataProducerClosed(dataProducerId: string): void {
    console.log('Data producer closed:', dataProducerId);
    if (this.dataProducer?.id === dataProducerId) {
      this.dataProducer = undefined;
    }
  }

  // Handle transport failure
  private handleTransportFailure(direction: 'send' | 'recv'): void {
    console.warn(`${direction} transport failed, attempting recovery...`);
    
    // Implement reconnection logic
    if (direction === 'send') {
      this.createSendTransport().catch(console.error);
    } else {
      this.createRecvTransport().catch(console.error);
    }
  }

  // Handle disconnection
  private handleDisconnection(): void {
    if (this.isDisconnecting) {
      return; // Already handling disconnection
    }
    
    this.isDisconnecting = true;
    console.log('🔄 Handling disconnection...');
    
    // Clear all stats intervals first
    this.consumerStatsIntervals.forEach((interval, consumerId) => {
      clearInterval(interval);
      console.log(`🔄 Cleared consumer stats interval: ${consumerId}`);
    });
    this.consumerStatsIntervals.clear();

    this.producerStatsIntervals.forEach((interval, producerId) => {
      clearInterval(interval);
      console.log(`🔄 Cleared producer stats interval: ${producerId}`);
    });
    this.producerStatsIntervals.clear();

    // Close all producers
    if (this.audioProducer && !this.audioProducer.closed) {
      this.audioProducer.close();
    }
    if (this.videoProducer && !this.videoProducer.closed) {
      this.videoProducer.close();
    }
    if (this.dataProducer && !this.dataProducer.closed) {
      this.dataProducer.close();
    }

    // Close all consumers
    this.consumers.forEach(consumer => {
      if (!consumer.closed) {
        consumer.close();
      }
    });
    
    this.dataConsumers.forEach(dataConsumer => {
      if (!dataConsumer.closed) {
        dataConsumer.close();
      }
    });

    // Close transports
    if (this.sendTransport && !this.sendTransport.closed) {
      this.sendTransport.close();
    }
    if (this.recvTransport && !this.recvTransport.closed) {
      this.recvTransport.close();
    }

    // Clear collections
    this.consumers.clear();
    this.dataConsumers.clear();
    this.remoteStreams.clear();

    // Reset state
    this.audioProducer = undefined;
    this.videoProducer = undefined;
    this.dataProducer = undefined;
    this.sendTransport = undefined;
    this.recvTransport = undefined;
    this.localAudioTrack = undefined;
    this.localVideoTrack = undefined;
    this.isDeviceLoaded = false; // Reset device loaded state
    this.isConnected = false;

    console.log('🔄 Disconnection handled, state reset');
    
    // Reset the disconnecting flag after a short delay
    setTimeout(() => {
      this.isDisconnecting = false;
    }, 1000);
  }

  // Pause/Resume producers
  async pauseProducer(kind: 'audio' | 'video'): Promise<void> {
    const producer = kind === 'audio' ? this.audioProducer : this.videoProducer;
    if (producer && !producer.paused) {
      producer.pause();
      this.socket.emit('pauseProducer', { producerId: producer.id });
      console.log(`⏸️ ${kind} producer paused`);
    }
  }

  async resumeProducer(kind: 'audio' | 'video'): Promise<void> {
    const producer = kind === 'audio' ? this.audioProducer : this.videoProducer;
    if (producer && producer.paused) {
      producer.resume();
      this.socket.emit('resumeProducer', { producerId: producer.id });
      console.log(`▶️ ${kind} producer resumed`);
    }
  }

  // Advanced bandwidth management
  async setBandwidth(kind: 'audio' | 'video', bitrate: number): Promise<void> {
    const producer = kind === 'audio' ? this.audioProducer : this.videoProducer;
    if (!producer) return;

    try {
      // For video, we can adjust encoding parameters
      if (kind === 'video' && this.videoProducer) {
        await this.videoProducer.setRtpEncodingParameters({
          maxBitrate: bitrate
        });
        console.log(`📊 ${kind} bitrate set to ${bitrate} bps`);
      }
    } catch (error) {
      console.error(`❌ Failed to set ${kind} bitrate:`, error);
    }
  }

  // Simulcast layer control  
  async setSimulcastLayer(spatialLayer: number): Promise<void> {
    if (this.videoProducer && this.config.simulcastEnabled) {
      try {
        await this.videoProducer.setMaxSpatialLayer(spatialLayer);
        console.log(`📊 Simulcast spatial layer set to: ${spatialLayer}`);
      } catch (error) {
        console.error('❌ Failed to set simulcast layer:', error);
      }
    }
  }

  // Get transport stats
  async getTransportStats(): Promise<{ send?: RTCStatsReport, recv?: RTCStatsReport }> {
    const stats: { send?: RTCStatsReport, recv?: RTCStatsReport } = {};
    
    try {
      if (this.sendTransport) {
        stats.send = await this.sendTransport.getStats();
      }
      if (this.recvTransport) {
        stats.recv = await this.recvTransport.getStats();
      }
    } catch (error) {
      console.error('❌ Failed to get transport stats:', error);
    }
    
    return stats;
  }

  // Cleanup
  async disconnect(): Promise<void> {
    console.log('🔄 Disconnecting...');
    
    this.handleDisconnection();
    
    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }
    
    console.log('✅ Disconnected successfully');
  }

  // Getters
  get isReady(): boolean {
    return this.isConnected && this.isDeviceLoaded && !!this.sendTransport;
  }

  get hasAudioProducer(): boolean {
    return !!this.audioProducer && !this.audioProducer.closed;
  }

  get hasVideoProducer(): boolean {
    return !!this.videoProducer && !this.videoProducer.closed;
  }

  get hasDataProducer(): boolean {
    return !!this.dataProducer && !this.dataProducer.closed;
  }

  get getRemoteStreams(): Map<string, MediaStream> {
    return this.remoteStreams;
  }

  get getConsumers(): Map<string, Consumer> {
    return this.consumers;
  }

  get getDataConsumers(): Map<string, DataConsumer> {
    return this.dataConsumers;
  }

  get getConfig(): MediasoupConfig {
    return { ...this.config };
  }
} 