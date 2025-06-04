const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// CORS для всех доменов
app.use(cors());
app.use(express.json());

// Глобальные переменные для mediasoupp
let worker;
let router;
let connections = new Map();
let transports = new Map();
let producers = new Map();
let consumers = new Map();

// Настройки mediasoup
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

// Инициализация mediasoup
async function initializeMediasoup() {
  try {
    console.log('🔄 Инициализация mediasoup worker...');
    
    worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 10000,
      rtcMaxPort: 59999,
    });

    worker.on('died', () => {
      console.error('💀 mediasoup worker died, exiting...');
      process.exit(1);
    });

    router = await worker.createRouter({ mediaCodecs });
    
    console.log('✅ mediasoup инициализирован успешно');
    console.log('📡 Router RTP capabilities готовы');
    
  } catch (error) {
    console.error('❌ Ошибка инициализации mediasoup:', error);
    process.exit(1);
  }
}

// WebSocket соединения
io.on('connection', (socket) => {
  console.log(`🔌 Новое соединение: ${socket.id}`);
  
  connections.set(socket.id, {
    socket: socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    isProducer: false
  });

  socket.emit('routerRtpCapabilities', router.rtpCapabilities);

  socket.on('createWebRtcTransport', async (data, callback) => {
    try {
      console.log(`📦 Создание транспорта для ${socket.id}, направление: ${data.direction}`);
      
      const transport = await router.createWebRtcTransport({
        listenInfos: [{
          protocol: 'udp',
          ip: '127.0.0.1',
          announcedAddress: '127.0.0.1'
        }],
        enableUdp: true,
        enableTcp: false,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
      });

      connections.get(socket.id).transports.set(transport.id, transport);
      transports.set(transport.id, {
        transport,
        socketId: socket.id,
        direction: data.direction
      });

      transport.on('dtlsstatechange', (dtlsState) => {
        console.log(`🔐 Transport ${transport.id} DTLS state: ${dtlsState}`);
      });

      transport.on('icestatechange', (iceState) => {
        console.log(`🧊 Transport ${transport.id} ICE state: ${iceState}`);
      });

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

    } catch (error) {
      console.error('❌ Ошибка создания транспорта:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectTransport', async (data, callback) => {
    try {
      const transportData = transports.get(data.transportId);
      if (!transportData) {
        throw new Error('Transport not found');
      }

      await transportData.transport.connect({
        dtlsParameters: data.dtlsParameters
      });

      console.log(`✅ Transport ${data.transportId} подключен`);
      callback();

    } catch (error) {
      console.error('❌ Ошибка подключения транспорта:', error);
      callback({ error: error.message });
    }
  });

  socket.on('produce', async (data, callback) => {
    try {
      const transportData = transports.get(data.transportId);
      if (!transportData) {
        throw new Error('Transport not found');
      }

      const producer = await transportData.transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      connections.get(socket.id).producers.set(producer.id, producer);
      connections.get(socket.id).isProducer = true;
      producers.set(producer.id, {
        producer,
        socketId: socket.id,
        kind: data.kind
      });

      console.log(`📤 Producer создан: ${producer.id} (${data.kind}) для ${socket.id}`);

      producer.on('transportclose', () => {
        console.log(`❌ Producer ${producer.id}: transport закрыт`);
        cleanupProducer(producer.id);
      });

      broadcastNewProducer(socket.id, producer.id, data.kind);
      callback({ id: producer.id });

    } catch (error) {
      console.error('❌ Ошибка создания producer:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consume', async (data, callback) => {
    try {
      const transportData = transports.get(data.transportId);
      if (!transportData) {
        throw new Error('Transport not found');
      }

      const producerData = producers.get(data.producerId);
      if (!producerData) {
        throw new Error('Producer not found');
      }

      if (!router.canConsume({
        producerId: data.producerId,
        rtpCapabilities: data.rtpCapabilities,
      })) {
        throw new Error('Cannot consume');
      }

      const consumer = await transportData.transport.consume({
        producerId: data.producerId,
        rtpCapabilities: data.rtpCapabilities,
        paused: false,
      });

      connections.get(socket.id).consumers.set(consumer.id, consumer);
      consumers.set(consumer.id, {
        consumer,
        socketId: socket.id,
        producerId: data.producerId
      });

      console.log(`📥 Consumer создан: ${consumer.id} для producer ${data.producerId}`);

      consumer.on('transportclose', () => {
        console.log(`❌ Consumer ${consumer.id}: transport закрыт`);
        cleanupConsumer(consumer.id);
      });

      consumer.on('producerclose', () => {
        console.log(`❌ Consumer ${consumer.id}: producer закрыт`);
        socket.emit('consumerClosed', { consumerId: consumer.id });
        cleanupConsumer(consumer.id);
      });

      callback({
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });

    } catch (error) {
      console.error('❌ Ошибка создания consumer:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consumerResume', async (data, callback) => {
    try {
      const consumerData = consumers.get(data.consumerId);
      if (!consumerData) {
        throw new Error('Consumer not found');
      }

      await consumerData.consumer.resume();
      console.log(`▶️ Consumer ${data.consumerId} возобновлен`);
      callback();

    } catch (error) {
      console.error('❌ Ошибка возобновления consumer:', error);
      callback({ error: error.message });
    }
  });

  socket.on('getProducers', (callback) => {
    const availableProducers = [];
    
    for (const [producerId, producerData] of producers) {
      if (producerData.socketId !== socket.id) {
        availableProducers.push({
          id: producerId,
          kind: producerData.kind
        });
      }
    }
    
    console.log(`📋 Отправка списка producers клиенту ${socket.id}: ${availableProducers.length}`);
    callback(availableProducers);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Отключение: ${socket.id}`);
    cleanupConnection(socket.id);
  });
});

// Utility functions
function broadcastNewProducer(producerSocketId, producerId, kind) {
  for (const [socketId, connection] of connections) {
    if (socketId !== producerSocketId) {
      connection.socket.emit('newProducer', {
        id: producerId,
        kind: kind
      });
    }
  }
}

function cleanupProducer(producerId) {
  const producerData = producers.get(producerId);
  if (producerData) {
    for (const [consumerId, consumerData] of consumers) {
      if (consumerData.producerId === producerId) {
        consumerData.consumer.close();
        connections.get(consumerData.socketId)?.socket.emit('consumerClosed', { consumerId });
        consumers.delete(consumerId);
      }
    }

    producers.delete(producerId);
    connections.get(producerData.socketId)?.producers.delete(producerId);
  }
}

function cleanupConsumer(consumerId) {
  const consumerData = consumers.get(consumerId);
  if (consumerData) {
    consumers.delete(consumerId);
    connections.get(consumerData.socketId)?.consumers.delete(consumerId);
  }
}

function cleanupConnection(socketId) {
  const connection = connections.get(socketId);
  if (connection) {
    for (const [producerId, producer] of connection.producers) {
      producer.close();
      cleanupProducer(producerId);
    }

    for (const [consumerId, consumer] of connection.consumers) {
      consumer.close();
      cleanupConsumer(consumerId);
    }

    for (const [transportId, transport] of connection.transports) {
      transport.close();
      transports.delete(transportId);
    }

    connections.delete(socketId);
  }
}

// Статические файлы
app.use(express.static('public'));

// API endpoints
app.get('/api/status', (req, res) => {
  const activeConnections = connections.size;
  const activeProducers = producers.size;
  const activeConsumers = consumers.size;
  const activeTransports = transports.size;
  
  res.json({
    server: 'mediasoup-client Server',
    status: 'running',
    connections: activeConnections,
    producers: activeProducers,
    consumers: activeConsumers,
    transports: activeTransports,
    mediasoup: {
      workerId: worker?.pid,
      routerId: router?.id,
      rtpCapabilities: router?.rtpCapabilities ? 'loaded' : 'not loaded'
    },
    uptime: process.uptime()
  });
});

// Запуск сервера
async function startServer() {
  try {
    await initializeMediasoup();
    
    server.listen(PORT, () => {
      console.log(`🚀 mediasoup-client сервер запущен на порту ${PORT}`);
      console.log(`📊 Статус: http://localhost:${PORT}/api/status`);
      console.log(`📹 Клиент: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log('');
      console.log('✅ Готов к приему подключений!');
    });
  } catch (error) {
    console.error('❌ Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершение работы...');
  
  for (const [socketId, connection] of connections) {
    cleanupConnection(socketId);
  }
  
  if (worker) {
    worker.close();
  }
  
  process.exit(0);
});

startServer();