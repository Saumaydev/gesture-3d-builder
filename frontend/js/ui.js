// frontend/js/ui.js
// UI Manager - Handles panels, modals, notifications

const UIManager = (() => {
  'use strict';

  let notificationTimer = null;

  function init() {
    _bindModals();
    _bindColorSwatches();
    _bindBuildingCards();
    _bindFloorSlider();
    _bindViewportTools();
    _bindToggleSwitches();
    _bindPropertyPanel();
    _bindChat();
    _bindActions();
    console.log('✅ UI Manager initialized');
  }

  // ─── Notifications ────────────────────────────────────────────────────────────

  function showNotification(text, type = 'info', duration = 3000) {
    const el = document.getElementById('notification');
    const icon = document.getElementById('notification-icon');
    const textEl = document.getElementById('notification-text');

    if (!el) return;

    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };

    icon.textContent = icons[type] || 'ℹ️';
    textEl.textContent = text;
    el.className = `notification ${type}`;
    el.classList.remove('hidden');

    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, duration);
  }

  // ─── Modals ───────────────────────────────────────────────────────────────────

  function _bindModals() {
    // Close buttons
    document.querySelectorAll('.modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        if (modalId) closeModal(modalId);
      });
    });

    // Overlay click to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  // ─── Color Swatches ───────────────────────────────────────────────────────────

  let selectedColor = '#4a90e2';

  function _bindColorSwatches() {
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        selectedColor = swatch.dataset.color;
        window.dispatchEvent(new CustomEvent('color-changed', { detail: { color: selectedColor } }));
      });
    });

    const customColor = document.getElementById('custom-color');
    if (customColor) {
      customColor.addEventListener('input', (e) => {
        selectedColor = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        window.dispatchEvent(new CustomEvent('color-changed', { detail: { color: selectedColor } }));
      });
    }
  }

  function getSelectedColor() { return selectedColor; }

  // ─── Building Cards ───────────────────────────────────────────────────────────

  let selectedBuildingType = 'skyscraper';

  function _bindBuildingCards() {
    document.querySelectorAll('.building-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.building-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedBuildingType = card.dataset.type;
        window.dispatchEvent(new CustomEvent('type-changed', {
          detail: { type: selectedBuildingType }
        }));
      });
    });
  }

  function getSelectedType() { return selectedBuildingType; }

  function nextBuildingType() {
    const types = ['skyscraper', 'office', 'residential', 'tower', 'dome', 'pyramid', 'warehouse', 'stadium'];
    const idx = types.indexOf(selectedBuildingType);
    selectedBuildingType = types[(idx + 1) % types.length];

    document.querySelectorAll('.building-card').forEach(card => {
      card.classList.toggle('active', card.dataset.type === selectedBuildingType);
    });

    window.dispatchEvent(new CustomEvent('type-changed', { detail: { type: selectedBuildingType } }));
    showNotification(`Building type: ${selectedBuildingType}`, 'info', 1500);
  }

  // ─── Floor Slider ─────────────────────────────────────────────────────────────

  let selectedFloors = 10;

  function _bindFloorSlider() {
    const slider = document.getElementById('floor-slider');
    const display = document.getElementById('floor-count-display');

    if (slider) {
      slider.addEventListener('input', () => {
        selectedFloors = parseInt(slider.value);
        if (display) display.textContent = selectedFloors;
        window.dispatchEvent(new CustomEvent('floors-changed', { detail: { floors: selectedFloors } }));
      });
    }
  }

  function getSelectedFloors() { return selectedFloors; }

  // ─── Viewport Tools ───────────────────────────────────────────────────────────

  function _bindViewportTools() {
    // Mode buttons
    const modes = ['place', 'select', 'delete'];
    ['btn-place-mode', 'btn-select-mode', 'btn-delete-mode'].forEach((btnId, i) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.vp-btn[id$="-mode"]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          SceneManager.setInteractionMode(modes[i]);
          window.dispatchEvent(new CustomEvent('mode-changed', { detail: { mode: modes[i] } }));
          showNotification(`Mode: ${modes[i]}`, 'info', 1000);
        });
      }
    });

    // Camera controls
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => SceneManager.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => SceneManager.zoomOut());
    document.getElementById('btn-reset-cam')?.addEventListener('click', () => SceneManager.resetCamera());
    document.getElementById('btn-top-view')?.addEventListener('click', () => SceneManager.setTopView());
    document.getElementById('btn-iso-view')?.addEventListener('click', () => SceneManager.setIsoView());

    // Undo/Redo/Clear
    document.getElementById('btn-undo')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('history-undo'));
    });
    document.getElementById('btn-redo')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('history-redo'));
    });
    document.getElementById('btn-clear')?.addEventListener('click', () => {
      if (confirm('Clear all buildings?')) {
        window.dispatchEvent(new CustomEvent('clear-all'));
      }
    });

    // Fullscreen
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  }

  // ─── Toggle Switches ──────────────────────────────────────────────────────────

  function _bindToggleSwitches() {
    document.getElementById('toggle-grid')?.addEventListener('change', (e) => {
      SceneManager.toggleGrid(e.target.checked);
    });

    document.getElementById('toggle-shadows')?.addEventListener('change', (e) => {
      SceneManager.toggleShadows(e.target.checked);
    });

    document.getElementById('toggle-wireframe')?.addEventListener('change', (e) => {
      SceneManager.toggleWireframe(e.target.checked);
    });
  }

  // ─── Property Panel ───────────────────────────────────────────────────────────

  function _bindPropertyPanel() {
    ['prop-x', 'prop-y', 'prop-z', 'prop-scale', 'prop-rot', 'prop-floors'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        window.dispatchEvent(new CustomEvent('property-changed'));
      });
    });

    document.getElementById('btn-delete-selected')?.addEventListener('click', () => {
      const id = SceneManager.getSelectedBuildingId();
      if (id) {
        window.dispatchEvent(new CustomEvent('canvas-delete', { detail: { id } }));
      }
    });

    document.getElementById('btn-duplicate-selected')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('duplicate-selected'));
    });
  }

  function getPropertyValues() {
    return {
      x: parseFloat(document.getElementById('prop-x')?.value) || 0,
      y: parseFloat(document.getElementById('prop-y')?.value) || 0,
      z: parseFloat(document.getElementById('prop-z')?.value) || 0,
      scale: parseFloat(document.getElementById('prop-scale')?.value) || 1,
      rotation: parseFloat(document.getElementById('prop-rot')?.value) || 0,
      floors: parseInt(document.getElementById('prop-floors')?.value) || 10
    };
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────────

  function _bindChat() {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('btn-send-chat');

    const sendChat = () => {
      const msg = input?.value?.trim();
      if (msg && WSClient.isConnected()) {
        WSClient.sendChat(msg);
        addChatMessage(WSClient.getUserId() || 'You', msg, true);
        if (input) input.value = '';
      }
    };

    btn?.addEventListener('click', sendChat);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });
  }

  function addChatMessage(username, message, isOwn = false, isSystem = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `chat-message ${isOwn ? 'own' : ''} ${isSystem ? 'system' : ''}`;

    if (isSystem) {
      div.innerHTML = `<span class="chat-text">${message}</span>`;
    } else {
      div.innerHTML = `<span class="chat-user">${username}:</span> <span class="chat-text">${message}</span>`;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Limit messages
    while (container.children.length > 50) {
      container.removeChild(container.firstChild);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────────

  function _bindActions() {
    document.getElementById('btn-save')?.addEventListener('click', () => openModal('modal-save'));
    document.getElementById('btn-load')?.addEventListener('click', () => {
      openModal('modal-load');
      window.dispatchEvent(new CustomEvent('load-cities-requested'));
    });
    document.getElementById('btn-export')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('export-json'));
    });
    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      SceneManager.takeScreenshot();
      showNotification('Screenshot saved!', 'success');
    });
    document.getElementById('btn-share')?.addEventListener('click', () => {
      openModal('modal-share');
    });
    document.getElementById('btn-new-city')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('new-city-requested'));
    });

    // Save confirm
    document.getElementById('btn-confirm-save')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('save-confirmed'));
      closeModal('modal-save');
    });

    // Copy URL
    document.getElementById('btn-copy-url')?.addEventListener('click', () => {
      const input = document.getElementById('share-url-input');
      if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
          showNotification('URL copied!', 'success');
        });
      }
    });

    // Create session
    document.getElementById('btn-create-session')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('create-session'));
    });
  }

  // ─── Users Panel ─────────────────────────────────────────────────────────────

  function updateUserCount(count) {
    const el = document.getElementById('user-count-display');
    if (el) el.textContent = `👥 ${count} online`;
    const stat = document.getElementById('stat-users');
    if (stat) stat.textContent = count;
  }

  function updateSessionDisplay(sessionId) {
    const el = document.getElementById('session-display');
    if (el) el.textContent = `Session: ${sessionId || '--'}`;
  }

  function updateShareModal(sessionId) {
    const url = `${window.location.origin}?session=${sessionId}`;
    const input = document.getElementById('share-url-input');
    const display = document.getElementById('share-session-id');
    if (input) input.value = url;
    if (display) display.textContent = sessionId;
  }

  // ─── Cities List ─────────────────────────────────────────────────────────────

  function renderCitiesList(cities, activeCityId) {
    const container = document.getElementById('cities-list');
    if (!container) return;

    container.innerHTML = '';
    cities.forEach(city => {
      const div = document.createElement('div');
      div.className = `city-item ${city.id === activeCityId ? 'active' : ''}`;
      div.innerHTML = `
        <div>
          <div class="city-item-name">${city.name}</div>
          <div class="city-item-meta">ID: ${city.id}</div>
        </div>
        <span>▶</span>
      `;
      div.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('load-city', { detail: { cityId: city.id } }));
      });
      container.appendChild(div);
    });
  }

  function renderLoadModal(cities) {
    const container = document.getElementById('load-cities-list');
    if (!container) return;

    container.innerHTML = '';
    if (cities.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted); text-align:center; padding: 20px">No cities found</p>';
      return;
    }

    cities.forEach(city => {
      const div = document.createElement('div');
      div.className = 'load-city-item';
      div.innerHTML = `
        <h4>🏙️ ${city.name}</h4>
        <p>${city.description || 'No description'} — ID: ${city.id}</p>
      `;
      div.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('load-city', { detail: { cityId: city.id } }));
        closeModal('modal-load');
      });
      container.appendChild(div);
    });
  }

  // ─── Multi-user Cursors ───────────────────────────────────────────────────────

  let userCursors = new Map();

  function updateUserCursor(userId, position, color = '#4a90e2', username = '') {
    const container = document.getElementById('multi-cursors-container');
    if (!container) return;

    let cursor = userCursors.get(userId);
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'user-cursor';
      cursor.innerHTML = `
        <div class="user-cursor-dot" style="background:${color}"></div>
        <div class="user-cursor-label" style="background:${color}">${username || userId}</div>
      `;
      container.appendChild(cursor);
      userCursors.set(userId, cursor);
    }

    // Convert 3D position to screen (simplified)
    const vp = document.getElementById('viewport-container');
    if (vp) {
      const vpRect = vp.getBoundingClientRect();
      const screenX = vpRect.width / 2 + position.x * 8;
      const screenY = vpRect.height / 2 + position.z * 8;
      cursor.style.left = `${Math.max(0, Math.min(vpRect.width, screenX))}px`;
      cursor.style.top = `${Math.max(0, Math.min(vpRect.height, screenY))}px`;
    }
  }

  function removeUserCursor(userId) {
    const cursor = userCursors.get(userId);
    if (cursor) {
      cursor.remove();
      userCursors.delete(userId);
    }
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'z') {
        window.dispatchEvent(new CustomEvent('history-undo'));
      } else if (e.ctrlKey && e.key === 'y') {
        window.dispatchEvent(new CustomEvent('history-redo'));
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        openModal('modal-save');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = SceneManager.getSelectedBuildingId();
        if (id) {
          window.dispatchEvent(new CustomEvent('canvas-delete', { detail: { id } }));
        }
      } else if (e.key === 'Escape') {
        SceneManager.deselectBuilding();
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      } else if (e.key === '1') {
        document.getElementById('btn-place-mode')?.click();
      } else if (e.key === '2') {
        document.getElementById('btn-select-mode')?.click();
      } else if (e.key === '3') {
        document.getElementById('btn-delete-mode')?.click();
      } else if (e.key === 'r') {
        SceneManager.resetCamera();
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    init,
    showNotification,
    openModal,
    closeModal,
    getSelectedColor,
    getSelectedType,
    getSelectedFloors,
    nextBuildingType,
    getPropertyValues,
    addChatMessage,
    updateUserCount,
    updateSessionDisplay,
    updateShareModal,
    renderCitiesList,
    renderLoadModal,
    updateUserCursor,
    removeUserCursor,
    initKeyboardShortcuts
  };
})();