// frontend/js/main.js
// Application Entry Point & Coordinator

(async () => {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentCityId = 1;
  let currentSessionId = null;
  let currentUserId = null;
  let undoStack = [];
  let redoStack = [];
  const MAX_HISTORY = 50;

  // ─── Loading Screen ──────────────────────────────────────────────────────────

  function updateLoader(percent, text) {
    const bar = document.getElementById('loader-bar');
    const textEl = document.getElementById('loader-text');
    if (bar) bar.style.width = `${percent}%`;
    if (textEl) textEl.textContent = text;
  }

  async function hideLoadingScreen() {
    const screen = document.getElementById('loading-screen');
    if (screen) {
      screen.style.opacity = '0';
      screen.style.transition = 'opacity 0.5s ease';
      setTimeout(() => screen.remove(), 500);
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  updateLoader(10, 'Initializing UI...');
  UIManager.init();
  UIManager.initKeyboardShortcuts();

  updateLoader(30, 'Building 3D scene...');
  SceneManager.init();

  updateLoader(50, 'Connecting to server...');

  // Check URL params
  const urlParams = new URLSearchParams(window.location.search);
  const sessionFromUrl = urlParams.get('session');
  if (sessionFromUrl) {
    currentSessionId = sessionFromUrl;
  } else {
    currentSessionId = `session_${Date.now()}`;
  }

  // Generate user ID
  currentUserId = `user_${Math.random().toString(36).substr(2, 6)}`;

  // Connect WebSocket
  WSClient.connect(currentSessionId, currentUserId);
  UIManager.updateSessionDisplay(currentSessionId);
  UIManager.updateShareModal(currentSessionId);

  updateLoader(70, 'Loading city data...');

  // Load cities list
  const citiesData = await WSClient.loadCities();
  if (citiesData?.cities) {
    UIManager.renderCitiesList(citiesData.cities, currentCityId);
  }

  // Load default city
  try {
    const cityData = await WSClient.loadCity(currentCityId);
    if (cityData?.buildings) {
      cityData.buildings.forEach(b => SceneManager.addBuilding(b));
      UIManager.showNotification(`Loaded ${cityData.buildings.length} buildings`, 'success');
    }
  } catch (e) {
    console.log('No city data to load');
  }

  updateLoader(90, 'Starting gesture system...');
  GestureController.init();

  updateLoader(100, 'Ready!');
  await new Promise(r => setTimeout(r, 500));
  hideLoadingScreen();

  console.log('🚀 Application started');
  UIManager.showNotification('Welcome to Gesture 3D Builder!', 'success', 4000);

  // ─── Building Management ─────────────────────────────────────────────────────

  function _generateId() {
    return `b_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  function placeBuilding(position) {
    const id = _generateId();
    const type = UIManager.getSelectedType();
    const color = UIManager.getSelectedColor();
    const floors = UIManager.getSelectedFloors();

    const buildingData = {
      id,
      type,
      color,
      floors,
      position: {
        x: Math.round(position.x / 3) * 3,
        y: 0,
        z: Math.round(position.z / 3) * 3
      },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { y: 0 }
    };

    // Check for overlap
    const nearby = _getBuildingsNear(buildingData.position, 2);
    if (nearby.length > 0) {
      UIManager.showNotification('Too close to existing building!', 'warning', 1500);
      return;
    }

    SceneManager.addBuilding(buildingData);
    _pushHistory({ action: 'add', data: buildingData });

    // Broadcast
    if (WSClient.isConnected()) {
      WSClient.sendBuildingAdd(buildingData);
    }

    UIManager.showNotification(`${type} placed!`, 'success', 1000);
    return id;
  }

  function deleteBuilding(id) {
    const buildings = SceneManager.getAllBuildingsData();
    const building = buildings.find(b => b.id === id);

    if (building) {
      _pushHistory({ action: 'delete', data: building });
    }

    SceneManager.removeBuilding(id);

    if (WSClient.isConnected()) {
      WSClient.sendBuildingDelete(id);
    }

    UIManager.showNotification('Building deleted', 'info', 1000);
  }

  function _getBuildingsNear(position, radius) {
    const buildings = SceneManager.getAllBuildingsData();
    return buildings.filter(b => {
      const dx = b.position.x - position.x;
      const dz = b.position.z - position.z;
      return Math.sqrt(dx * dx + dz * dz) < radius;
    });
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  function _pushHistory(entry) {
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) {
      UIManager.showNotification('Nothing to undo', 'info', 1000);
      return;
    }

    if (entry.action === 'add') {
      SceneManager.removeBuilding(entry.data.id);
      WSClient.sendBuildingDelete(entry.data.id);
    } else if (entry.action === 'delete') {
      SceneManager.addBuilding(entry.data);
      WSClient.sendBuildingAdd(entry.data);
    }

    redoStack.push(entry);
    UIManager.showNotification('Undo', 'info', 800);
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) {
      UIManager.showNotification('Nothing to redo', 'info', 1000);
      return;
    }

    if (entry.action === 'add') {
      SceneManager.addBuilding(entry.data);
      WSClient.sendBuildingAdd(entry.data);
    } else if (entry.action === 'delete') {
      SceneManager.removeBuilding(entry.data.id);
      WSClient.sendBuildingDelete(entry.data.id);
    }

    undoStack.push(entry);
    UIManager.showNotification('Redo', 'info', 800);
  }

  // ─── Save / Load ─────────────────────────────────────────────────────────────

  async function saveCity() {
    const name = document.getElementById('save-city-name')?.value || 'My City';
    const desc = document.getElementById('save-city-desc')?.value || '';
    const cityId = parseInt(document.getElementById('save-city-id')?.value) || 0;

    const buildings = SceneManager.getAllBuildingsData();
    UIManager.showNotification('Saving...', 'info', 1000);

    const result = await WSClient.saveCity(
      cityId || currentCityId,
      name, desc, buildings
    );

    if (result?.success) {
      if (result.cityId) currentCityId = result.cityId;
      UIManager.showNotification(`Saved ${buildings.length} buildings!`, 'success');

      // Refresh cities list
      const citiesData = await WSClient.loadCities();
      if (citiesData?.cities) {
        UIManager.renderCitiesList(citiesData.cities, currentCityId);
      }
    } else {
      UIManager.showNotification('Save failed', 'error');
    }
  }

  async function loadCity(cityId) {
    UIManager.showNotification('Loading...', 'info', 1000);

    const data = await WSClient.loadCity(cityId);
    if (data?.buildings) {
      SceneManager.clearAllBuildings();
      data.buildings.forEach(b => SceneManager.addBuilding(b));
      currentCityId = cityId;
      undoStack = [];
      redoStack = [];
      UIManager.showNotification(`Loaded ${data.buildings.length} buildings`, 'success');

      // Refresh cities list
      const citiesData = await WSClient.loadCities();
      if (citiesData?.cities) {
        UIManager.renderCitiesList(citiesData.cities, currentCityId);
      }
    } else {
      UIManager.showNotification('Load failed', 'error');
    }
  }

  function exportJSON() {
    const buildings = SceneManager.getAllBuildingsData();
    const data = {
      version: '2.0',
      exported_at: new Date().toISOString(),
      city_id: currentCityId,
      building_count: buildings.length,
      buildings
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesture-city-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UIManager.showNotification('Exported!', 'success');
  }

  async function createCollabSession() {
    const result = await WSClient.createSession(currentCityId);
    if (result?.session_id) {
      currentSessionId = result.session_id;
      UIManager.updateSessionDisplay(currentSessionId);
      UIManager.updateShareModal(currentSessionId);

      // Reconnect WS with new session
      WSClient.disconnect();
      WSClient.connect(currentSessionId, currentUserId);

      UIManager.showNotification(`Session created: ${currentSessionId}`, 'success');
    }
  }

  // ─── Gesture Actions ──────────────────────────────────────────────────────────

  GestureController.onGestureAction('place_building', (action) => {
    placeBuilding(action.position);
  });

  GestureController.onGestureAction('delete', (action) => {
    // Find nearest building to gesture position
    const buildings = SceneManager.getAllBuildingsData();
    let nearest = null;
    let minDist = 5; // Only delete within 5 units

    buildings.forEach(b => {
      const dx = b.position.x - action.position.x;
      const dz = b.position.z - action.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) {
        minDist = dist;
        nearest = b.id;
      }
    });

    if (nearest) deleteBuilding(nearest);
  });

  GestureController.onGestureAction('change_type', () => {
    UIManager.nextBuildingType();
  });

  GestureController.onGestureAction('save_scene', async () => {
    const buildings = SceneManager.getAllBuildingsData();
    await WSClient.saveCity(currentCityId, 'Auto Save', '', buildings);
    UIManager.showNotification('Auto-saved!', 'success', 2000);
  });

  GestureController.onGestureAction('undo', () => undo());

  GestureController.onGestureAction('scale', (action) => {
    const id = SceneManager.getSelectedBuildingId();
    if (id) {
      const s = action.scale_factor;
      SceneManager.updateBuilding(id, { scale: { x: s, y: s, z: s } });
      WSClient.sendBuildingUpdate(id, { scale: { x: s, y: s, z: s } });
    }
  });

  GestureController.onGestureAction('rotate', (action) => {
    const id = SceneManager.getSelectedBuildingId();
    if (id) {
      const rad = action.angle * (Math.PI / 180);
      SceneManager.updateBuilding(id, { rotation: { y: rad } });
      WSClient.sendBuildingUpdate(id, { rotation: { y: rad } });
    }
  });

  GestureController.onGestureAction('select', (action) => {
    // Highlight nearest building
  });

  GestureController.onGestureAction('clear_selection', () => {
    SceneManager.deselectBuilding();
  });

  // ─── DOM Events ───────────────────────────────────────────────────────────────

  window.addEventListener('canvas-place', (e) => {
    placeBuilding(e.detail.position);
  });

  window.addEventListener('canvas-delete', (e) => {
    deleteBuilding(e.detail.id);
  });

  window.addEventListener('history-undo', undo);
  window.addEventListener('history-redo', redo);

  window.addEventListener('clear-all', () => {
    SceneManager.clearAllBuildings();
    WSClient.sendClearAll();
    undoStack = [];
    redoStack = [];
    UIManager.showNotification('Scene cleared', 'info');
  });

  window.addEventListener('save-confirmed', saveCity);

  window.addEventListener('load-cities-requested', async () => {
    const data = await WSClient.loadCities();
    if (data?.cities) UIManager.renderLoadModal(data.cities);
  });

  window.addEventListener('load-city', (e) => {
    loadCity(e.detail.cityId);
  });

  window.addEventListener('export-json', exportJSON);
  window.addEventListener('create-session', createCollabSession);

  window.addEventListener('property-changed', () => {
    const id = SceneManager.getSelectedBuildingId();
    if (!id) return;
    const props = UIManager.getPropertyValues();
    SceneManager.updateBuilding(id, {
      position: { x: props.x, y: props.y, z: props.z },
      scale: { x: props.scale, y: props.scale, z: props.scale },
      rotation: { y: props.rotation * Math.PI / 180 }
    });
    WSClient.sendBuildingUpdate(id, {
      position: { x: props.x, y: props.y, z: props.z }
    });
  });

  window.addEventListener('duplicate-selected', () => {
    const id = SceneManager.getSelectedBuildingId();
    if (!id) return;
    const buildings = SceneManager.getAllBuildingsData();
    const original = buildings.find(b => b.id === id);
    if (original) {
      placeBuilding({
        x: original.position.x + 4,
        y: 0,
        z: original.position.z + 4
      });
    }
  });

  window.addEventListener('new-city-requested', async () => {
    const name = prompt('City name:');
    if (!name) return;
    const result = await WSClient.apiPost('/api/cities', { name, description: '' });
    if (result?.city) {
      UIManager.showNotification(`City "${name}" created`, 'success');
      const citiesData = await WSClient.loadCities();
      if (citiesData?.cities) UIManager.renderCitiesList(citiesData.cities, currentCityId);
    }
  });

  // ─── WebSocket Events ─────────────────────────────────────────────────────────

  window.addEventListener('ws:session_init', (e) => {
    const data = e.detail;
    if (data.user_id) currentUserId = data.user_id;
    UIManager.showNotification(`Connected as ${currentUserId}`, 'success', 2000);
  });

  window.addEventListener('ws:user_joined', (e) => {
    const data = e.detail;
    UIManager.addChatMessage('', `${data.metadata?.username || data.user_id} joined`, false, true);
    UIManager.updateUserCount(data.session_users?.length || 1);
    UIManager.showNotification(`${data.metadata?.username || 'User'} joined`, 'info', 2000);
  });

  window.addEventListener('ws:user_left', (e) => {
    const data = e.detail;
    UIManager.addChatMessage('', `User ${data.user_id} left`, false, true);
    UIManager.updateUserCount(data.session_users?.length || 1);
    UIManager.removeUserCursor(data.user_id);
  });

  window.addEventListener('ws:building_update', (e) => {
    const data = e.detail;
    if (data.sender_id === currentUserId) return; // Ignore own updates

    if (data.action === 'add') {
      SceneManager.addBuilding(data.building);
    } else if (data.action === 'update') {
      SceneManager.updateBuilding(data.building.id, data.building);
    } else if (data.action === 'delete') {
      SceneManager.removeBuilding(data.building_id);
    } else if (data.action === 'clear_all') {
      SceneManager.clearAllBuildings();
    }
  });

  window.addEventListener('ws:gesture_update', (e) => {
    const data = e.detail;
    if (data.user_id === currentUserId) return;

    // Show other user's gesture cursor
    if (data.position) {
      UIManager.updateUserCursor(
        data.user_id,
        data.position,
        '#ff6b6b',
        data.user_id
      );
    }
  });

  window.addEventListener('ws:cursor_update', (e) => {
    const data = e.detail;
    if (data.user_id === currentUserId) return;
    UIManager.updateUserCursor(data.user_id, data.position, '#ff6b6b');
  });

  window.addEventListener('ws:chat', (e) => {
    const data = e.detail;
    if (data.user_id === currentUserId) return;
    UIManager.addChatMessage(data.username || data.user_id, data.message, false);
  });

  window.addEventListener('ws:scene_saved', (e) => {
    UIManager.showNotification('Scene saved by another user', 'info');
  });

  window.addEventListener('ws:heartbeat', () => {
    // Connection alive
  });

  // ─── Periodic cursor broadcast ────────────────────────────────────────────────

  let lastMouseX = 0, lastMouseZ = 0;
  document.addEventListener('mousemove', (e) => {
    const pos = SceneManager.getGroundPosition(e.clientX, e.clientY);
    if (pos && WSClient.isConnected()) {
      if (Math.abs(pos.x - lastMouseX) > 1 || Math.abs(pos.z - lastMouseZ) > 1) {
        lastMouseX = pos.x;
        lastMouseZ = pos.z;
        WSClient.sendCursorUpdate(pos);
      }
    }
  });

  // ─── Final ────────────────────────────────────────────────────────────────────

  // Update user count periodically
  setInterval(async () => {
    const data = await WSClient.apiGet(`/api/sessions/${currentSessionId}/users`);
    if (data?.user_count !== undefined) {
      UIManager.updateUserCount(data.user_count);
    }
  }, 10000);

  console.log('✅ Main application initialized');

})();