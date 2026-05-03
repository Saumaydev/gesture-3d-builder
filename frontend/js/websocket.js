// frontend/js/websocket.js
// WebSocket Client for Real-time Collaboration

const WSClient = (() => {
  'use strict';

  let ws = null;
  let userId = null;
  let sessionId = null;
  let reconnectAttempts = 0;
  let maxReconnectAttempts = 5;
  let reconnectDelay = 1000;
  let pingInterval = null;
  let isConnected = false;
  let messageQueue = [];
  let messageHandlers = new Map();
  let connectionCallbacks = [];

  const SERVER_URL = `wss://gesture-3d-builder.onrender.com`;

  // ─── Connect ─────────────────────────────────────────────────────────────────

  function connect(session, uid) {
    sessionId = session;
    userId = uid;

    const url = `${SERVER_URL}/ws/${sessionId}${uid ? `?user_id=${uid}` : ''}`;
    console.log(`🔌 Connecting to ${url}...`);

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      isConnected = true;
      reconnectAttempts = 0;
      reconnectDelay = 1000;

      _updateStatus(true);
      _startPing();
      _flushQueue();

      connectionCallbacks.forEach(cb => cb(true));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        _handleMessage(data);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log(`❌ WebSocket closed: ${event.code}`);
      isConnected = false;
      _updateStatus(false);
      _stopPing();

      connectionCallbacks.forEach(cb => cb(false));

      if (reconnectAttempts < maxReconnectAttempts) {
        setTimeout(_reconnect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  function disconnect() {
    _stopPing();
    if (ws) {
      ws.close(1000, 'User disconnected');
      ws = null;
    }
    isConnected = false;
    _updateStatus(false);
  }

  function _reconnect() {
    reconnectAttempts++;
    console.log(`🔄 Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
    connect(sessionId, userId);
  }

  // ─── Send ─────────────────────────────────────────────────────────────────────

  function send(message) {
    if (!message.type) {
      console.warn('Message missing type field');
      return;
    }

    message.user_id = userId;
    message.timestamp = Date.now();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      // Queue for later
      if (messageQueue.length < 100) {
        messageQueue.push(message);
      }
    }
  }

  function _flushQueue() {
    while (messageQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(messageQueue.shift()));
    }
  }

  // ─── Ping/Pong ────────────────────────────────────────────────────────────────

  function _startPing() {
    pingInterval = setInterval(() => {
      send({ type: 'ping' });
    }, 25000);
  }

  function _stopPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  // ─── Message Handler ──────────────────────────────────────────────────────────

  function _handleMessage(data) {
    const { type } = data;

    // Call registered handlers
    const handler = messageHandlers.get(type);
    if (handler) {
      handler(data);
    }

    // Also dispatch DOM event
    window.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: data }));
  }

  function on(type, handler) {
    messageHandlers.set(type, handler);
  }

  function off(type) {
    messageHandlers.delete(type);
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  function _updateStatus(connected) {
    const dot = document.getElementById('ws-status');
    const label = document.getElementById('ws-label');
    if (dot) {
      dot.className = `status-dot ${connected ? 'green' : 'red'}`;
    }
    if (label) {
      label.textContent = connected ? 'Connected' : 'Disconnected';
    }
  }

  function onConnectionChange(cb) {
    connectionCallbacks.push(cb);
  }

  // ─── Building Events ──────────────────────────────────────────────────────────

  function sendBuildingAdd(buildingData) {
    send({
      type: 'add_building',
      building: buildingData
    });
  }

  function sendBuildingUpdate(buildingId, updates) {
    send({
      type: 'update_building',
      building: { id: buildingId, ...updates }
    });
  }

  function sendBuildingDelete(buildingId) {
    send({
      type: 'delete_building',
      building_id: buildingId
    });
  }

  function sendClearAll() {
    send({ type: 'clear_all' });
  }

  function sendGestureEvent(gestureData) {
    send({
      type: 'gesture_event',
      gesture_data: gestureData
    });
  }

  function sendCursorUpdate(position) {
    send({
      type: 'cursor_update',
      position
    });
  }

  function sendChat(message) {
    send({ type: 'chat', message });
  }

  function setUsername(username) {
    send({ type: 'set_username', username });
  }

  // ─── HTTP Helpers ─────────────────────────────────────────────────────────────

  async function apiGet(path) {
    try {
      const res = await fetch(`https://gesture-3d-builder.onrender.com${path}`);
      return await res.json();
    } catch (e) {
      console.error(`API GET ${path} failed:`, e);
      return null;
    }
  }

  async function apiPost(path, data) {
    try {
      const res = await fetch(`https://gesture-3d-builder.onrender.com${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error(`API POST ${path} failed:`, e);
      return null;
    }
  }

  async function apiDelete(path) {
    try {
      const res = await fetch(`https://gesture-3d-builder.onrender.com${path}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      console.error(`API DELETE ${path} failed:`, e);
      return null;
    }
  }

  // ─── City API ─────────────────────────────────────────────────────────────────

  async function loadCities() {
    return await apiGet('/api/cities');
  }

  async function loadCity(cityId) {
    return await apiGet(`/api/cities/${cityId}`);
  }

  async function saveCity(cityId, name, description, buildings) {
    // Create or update city
    if (cityId === 0) {
      const created = await apiPost('/api/cities', { name, description });
      if (!created?.city) return null;
      cityId = created.city.id;
    }

    // Save buildings
    const result = await apiPost(`/api/cities/${cityId}/buildings`, { buildings });
    return { cityId, ...result };
  }

  async function createSession(cityId) {
    return await apiPost(`/api/sessions?city_id=${cityId}`, {});
  }

  async function processGestureFrame(frameData, sessionId, userId) {
    try {
     const res = await fetch(`https://gesture-3d-builder.onrender.com/api/gesture/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame: frameData,
          session_id: sessionId,
          user_id: userId
        })
      });
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    connect,
    disconnect,
    send,
    on,
    off,
    onConnectionChange,
    sendBuildingAdd,
    sendBuildingUpdate,
    sendBuildingDelete,
    sendClearAll,
    sendGestureEvent,
    sendCursorUpdate,
    sendChat,
    setUsername,
    loadCities,
    loadCity,
    saveCity,
    createSession,
    processGestureFrame,
    apiGet,
    apiPost,
    apiDelete,
    getUserId: () => userId,
    getSessionId: () => sessionId,
    isConnected: () => isConnected
  };
})();
