// Глобальные переменные
let socket;
let device;
let routerRtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumers = new Map();
let localStream;
let isProducing = false;

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 mediasoup-client приложение инициализировано');
  
  try {
    // Подключаемся к серверу
    await connectToServer();
    
    // Инициализируем device
    await initializeDevice();
    
    console.log('✅ Приложение готово к работе');
    updateConnectionStatus(true);
    
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    updateConnectionStatus(false);
  }
});

// Подключение к серверу через WebSocket
async function connectToServer() {
  return new Promise((resolve, reject) => {
    socket = io();
    
    socket.on('connect', () => {
      console.log('🔌 Подключено к серверу');
      resolve();
    });
    
    socket.on('disconnect', () => {
      console.log('🔌 Отключено от сервера');
      updateConnectionStatus(false);
    });
    
    socket.on('connect_error', (error) => {
      console.error('❌ Ошибка подключения:', error);
      reject(error);
    });
    
    // Получаем RTP capabilities от сервера
    socket.on('routerRtpCapabilities', (rtpCapabilities) => {
      console.log('📡 Получены RTP capabilities от сервера');
      routerRtpCapabilities = rtpCapabilities;
    });
    
    // Новый producer появился
    socket.on('newProducer', async (data) => {
      console.log(`📤 Новый producer доступен: ${data.id} (${data.kind})`);
      if (!isProducing) {
        await consumeMedia(data.id);
      }
    });
    
    // Consumer закрыт
    socket.on('consumerClosed', (data) => {
      console.log(`📥 Consumer закрыт: ${data.consumerId}`);
      const consumer = consumers.get(data.consumerId);
      if (consumer) {
        consumer.close();
        consumers.delete(data.consumerId);
      }
    });
  });
}

// Инициализация mediasoup Device
async function initializeDevice() {
  try {
    // Проверяем разные варианты экспорта библиотеки
    let MediasoupDevice;
    
    if (window.mediasoupClient && window.mediasoupClient.Device) {
      MediasoupDevice = window.mediasoupClient.Device;
      console.log('📚 Используем window.mediasoupClient.Device');
    } else if (window.MediasoupClient && window.MediasoupClient.Device) {
      MediasoupDevice = window.MediasoupClient.Device;
      console.log('📚 Используем window.MediasoupClient.Device');
    } else if (window.mediasoup && window.mediasoup.Device) {
      MediasoupDevice = window.mediasoup.Device;
      console.log('📚 Используем window.mediasoup.Device');
    } else if (window.Device) {
      MediasoupDevice = window.Device;
      console.log('📚 Используем window.Device');
    } else {
      throw new Error('mediasoup-client Device класс не найден в глобальной области видимости');
    }
    
    device = new MediasoupDevice();
    
    console.log('🔄 Загрузка RTP capabilities в device...');
    await device.load({ routerRtpCapabilities });
    
    console.log('✅ Device инициализирован');
    console.log('📋 RTP capabilities загружены:', {
      canProduce: device.canProduce('video'),
      canConsume: device.loaded
    });
    
  } catch (error) {
    console.error('❌ Ошибка инициализации device:', error);
    throw error;
  }
}

// Создание транспорта
async function createTransport(direction) {
  return new Promise((resolve, reject) => {
    socket.emit('createWebRtcTransport', { direction }, (data) => {
      if (data.error) {
        console.error(`❌ Ошибка создания транспорта ${direction}:`, data.error);
        reject(new Error(data.error));
        return;
      }
      
      console.log(`📦 Транспорт ${direction} создан:`, data.id);
      
      let transport;
      if (direction === 'send') {
        transport = device.createSendTransport(data);
      } else {
        transport = device.createRecvTransport(data);
      }
      
      // Обработчик подключения
      transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          console.log(`🔗 Подключение транспорта ${direction}...`);
          
          socket.emit('connectTransport', {
            transportId: data.id,
            dtlsParameters
          }, (response) => {
            if (response && response.error) {
              console.error(`❌ Ошибка подключения транспорта ${direction}:`, response.error);
              errback(new Error(response.error));
            } else {
              console.log(`✅ Транспорт ${direction} подключен`);
              callback();
            }
          });
        } catch (error) {
          errback(error);
        }
      });
      
      // Обработчик produce (только для send транспорта)
      if (direction === 'send') {
        transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          try {
            console.log(`📤 Создание producer для ${kind}...`);
            
            socket.emit('produce', {
              transportId: data.id,
              kind,
              rtpParameters
            }, (response) => {
              if (response.error) {
                console.error(`❌ Ошибка создания producer:`, response.error);
                errback(new Error(response.error));
              } else {
                console.log(`✅ Producer создан: ${response.id}`);
                callback({ id: response.id });
              }
            });
          } catch (error) {
            errback(error);
          }
        });
      }
      
      resolve(transport);
    });
  });
}

// Начало трансляции экрана
async function startBroadcast() {
  try {
    console.log('🎬 Начинаем трансляцию экрана...');
    
    // Получаем доступ к экрану
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        mediaSource: 'screen',
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: true
    });
    
    console.log('📹 Локальный поток получен:');
    console.log('  Треков всего:', localStream.getTracks().length);
    localStream.getTracks().forEach((track, index) => {
      console.log(`  Трек ${index}:`, {
        kind: track.kind,
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
        label: track.label
      });
    });
    
    // Отображаем локальный поток
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = localStream;
    
    // Создаем send транспорт
    producerTransport = await createTransport('send');
    
    // Создаем producers для каждого трека
    for (const track of localStream.getTracks()) {
      console.log(`📤 Создание producer для трека ${track.kind}...`);
      
      const producerOptions = {
        track,
        encodings: track.kind === 'video' ? [
          { maxBitrate: 1000000 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 100000, scaleResolutionDownBy: 4 }
        ] : undefined,
        codecOptions: {
          videoGoogleStartBitrate: 1000
        }
      };
      
      producer = await producerTransport.produce(producerOptions);
      
      console.log(`✅ Producer создан: ${producer.id} (${track.kind})`);
      
      // Обработчик завершения трека
      producer.on('trackended', () => {
        console.log('🛑 Трек завершился, останавливаем трансляцию');
        stopBroadcast();
      });
      
      producer.on('transportclose', () => {
        console.log('❌ Producer transport закрыт');
      });
    }
    
    // Обработка завершения демонстрации экрана
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('🛑 Пользователь завершил демонстрацию экрана');
      stopBroadcast();
    });
    
    // Обновляем UI
    isProducing = true;
    document.getElementById('startBroadcast').disabled = true;
    document.getElementById('stopBroadcast').disabled = false;
    
    console.log('✅ Трансляция начата успешно');
    
  } catch (error) {
    console.error('❌ Ошибка при начале трансляции:', error);
    alert(`Ошибка при начале трансляции: ${error.message}`);
  }
}

// Остановка трансляции
async function stopBroadcast() {
  try {
    console.log('🛑 Останавливаем трансляцию...');
    
    // Останавливаем локальный поток
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    // Закрываем producer
    if (producer) {
      producer.close();
      producer = null;
    }
    
    // Закрываем producer transport
    if (producerTransport) {
      producerTransport.close();
      producerTransport = null;
    }
    
    // Очищаем видео элемент
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = null;
    
    // Обновляем UI
    isProducing = false;
    document.getElementById('startBroadcast').disabled = false;
    document.getElementById('stopBroadcast').disabled = true;
    
    console.log('✅ Трансляция остановлена');
    
  } catch (error) {
    console.error('❌ Ошибка при остановке трансляции:', error);
  }
}

// Начало просмотра потока
async function startViewing() {
  try {
    console.log('👀 Начинаем просмотр потока...');
    
    // Создаем receive транспорт
    consumerTransport = await createTransport('recv');
    
    // Получаем список доступных producers
    socket.emit('getProducers', async (producersList) => {
      console.log('📋 Получен список producers:', producersList);
      
      for (const producerInfo of producersList) {
        await consumeMedia(producerInfo.id);
      }
    });
    
    // Обновляем UI
    document.getElementById('startViewing').disabled = true;
    document.getElementById('stopViewing').disabled = false;
    
    console.log('✅ Просмотр начат');
    
  } catch (error) {
    console.error('❌ Ошибка при начале просмотра:', error);
    alert(`Ошибка при начале просмотра: ${error.message}`);
  }
}

// Потребление медиа от producer
async function consumeMedia(producerId) {
  try {
    console.log(`📥 Создание consumer для producer: ${producerId}`);
    
    // Создаем receive транспорт если его нет
    if (!consumerTransport) {
      consumerTransport = await createTransport('recv');
    }
    
    socket.emit('consume', {
      transportId: consumerTransport.id,
      producerId: producerId,
      rtpCapabilities: device.rtpCapabilities
    }, async (data) => {
      if (data.error) {
        console.error('❌ Ошибка создания consumer:', data.error);
        return;
      }
      
      console.log(`📥 Consumer создан: ${data.id} для producer ${producerId}`);
      
      const consumer = await consumerTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters
      });
      
      consumers.set(data.id, consumer);
      
      // Получаем медиа стрим
      const stream = new MediaStream([consumer.track]);
      
      console.log('📺 Отображение удаленного потока:', {
        kind: consumer.track.kind,
        enabled: consumer.track.enabled,
        readyState: consumer.track.readyState
      });
      
      // Отображаем видео
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = stream;
      
      // Принудительно запускаем воспроизведение
      setTimeout(() => {
        remoteVideo.play().then(() => {
          console.log('✅ Видео начало воспроизведение');
        }).catch(error => {
          console.error('❌ Ошибка воспроизведения:', error);
        });
      }, 100);
      
      // Возобновляем consumer
      socket.emit('consumerResume', { consumerId: data.id }, () => {
        console.log(`▶️ Consumer ${data.id} возобновлен`);
      });
      
      // Обработчики событий consumer
      consumer.on('transportclose', () => {
        console.log(`❌ Consumer ${data.id}: transport закрыт`);
      });
      
      consumer.on('trackended', () => {
        console.log(`❌ Consumer ${data.id}: track завершился`);
      });
    });
    
  } catch (error) {
    console.error('❌ Ошибка потребления медиа:', error);
  }
}

// Остановка просмотра
async function stopViewing() {
  try {
    console.log('🛑 Останавливаем просмотр...');
    
    // Закрываем все consumers
    for (const [consumerId, consumer] of consumers) {
      consumer.close();
    }
    consumers.clear();
    
    // Закрываем consumer transport
    if (consumerTransport) {
      consumerTransport.close();
      consumerTransport = null;
    }
    
    // Очищаем видео элемент
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = null;
    
    // Обновляем UI
    document.getElementById('startViewing').disabled = false;
    document.getElementById('stopViewing').disabled = true;
    
    console.log('✅ Просмотр остановлен');
    
  } catch (error) {
    console.error('❌ Ошибка при остановке просмотра:', error);
  }
}

// Обновление статуса подключения
function updateConnectionStatus(connected) {
  const statusElement = document.getElementById('connectionStatus');
  statusElement.textContent = connected ? '✅' : '❌';
}

// Обновление статистики
async function updateStats() {
  try {
    const response = await fetch('/api/status');
    const stats = await response.json();
    
    document.getElementById('activeSessions').textContent = stats.connections;
    document.getElementById('viewersCount').textContent = stats.consumers;
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
  }
}

// Периодическое обновление статистики
setInterval(updateStats, 5000);

// Проверка поддержки getDisplayMedia
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
  alert('⚠️ Ваш браузер не поддерживает демонстрацию экрана (getDisplayMedia)');
  document.getElementById('startBroadcast').disabled = true;
}

// Глобальные функции для кнопок (необходимо для ES modules)
window.startBroadcast = startBroadcast;
window.stopBroadcast = stopBroadcast;
window.startViewing = startViewing;
window.stopViewing = stopViewing; 