// frontend/js/gestures.js
// Client-side camera and gesture processing

const GestureController = (() => {
  'use strict';

  let videoElement = null;
  let canvasElement = null;
  let ctx = null;
  let stream = null;
  let isActive = false;
  let isProcessing = false;
  let processingInterval = null;
  let gestureEnabled = true;
  let confidenceThreshold = 0.7;
  let gestureCount = 0;
  let lastGesture = null;
  let gestureRepeatDelay = 500; // ms
  let lastGestureTime = 0;

  // Gesture callbacks
  let gestureCallbacks = {};

  function init() {
    videoElement = document.getElementById('camera-video');
    canvasElement = document.getElementById('gesture-canvas');
    if (canvasElement) {
      ctx = canvasElement.getContext('2d');
    }

    _bindUI();
    console.log('✅ Gesture Controller initialized');
  }

  function _bindUI() {
    const toggleBtn = document.getElementById('btn-toggle-cam');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleCamera);
    }

    const confSlider = document.getElementById('confidence-slider');
    if (confSlider) {
      confSlider.addEventListener('input', (e) => {
        confidenceThreshold = e.target.value / 100;
        document.getElementById('conf-value').textContent = `${e.target.value}%`;
      });
    }

    const gestureToggle = document.getElementById('gesture-enabled');
    if (gestureToggle) {
      gestureToggle.addEventListener('change', (e) => {
        gestureEnabled = e.target.checked;
        if (!gestureEnabled) {
          _updateGestureUI('none', 0);
        }
      });
    }
  }

  // ─── Camera ──────────────────────────────────────────────────────────────────

  async function toggleCamera() {
    if (isActive) {
      await stopCamera();
    } else {
      await startCamera();
    }
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        }
      });

      if (videoElement) {
        videoElement.srcObject = stream;
        videoElement.style.display = 'block';
        await videoElement.play();
      }

      if (canvasElement) {
        canvasElement.style.display = 'block';
        canvasElement.width = 640;
        canvasElement.height = 480;
      }

      const placeholder = document.getElementById('camera-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      isActive = true;

      // Update UI
      const btn = document.getElementById('btn-toggle-cam');
      const btnText = document.getElementById('cam-btn-text');
      if (btnText) btnText.textContent = '⏹ Disable Camera';

      // Update status
      const camStatus = document.getElementById('cam-status');
      const camLabel = document.getElementById('cam-label');
      if (camStatus) camStatus.className = 'status-dot green';
      if (camLabel) camLabel.textContent = 'Camera On';

      // Start processing
      startProcessing();

      console.log('📷 Camera started');
    } catch (err) {
      console.error('Camera error:', err);
      UIManager.showNotification('Camera access denied or not available', 'error');
    }
  }

  async function stopCamera() {
    stopProcessing();

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (videoElement) {
      videoElement.srcObject = null;
      videoElement.style.display = 'none';
    }

    if (canvasElement) {
      canvasElement.style.display = 'none';
      if (ctx) ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }

    const placeholder = document.getElementById('camera-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    isActive = false;

    const btnText = document.getElementById('cam-btn-text');
    if (btnText) btnText.textContent = '🎥 Enable Camera';

    const camStatus = document.getElementById('cam-status');
    const camLabel = document.getElementById('cam-label');
    if (camStatus) camStatus.className = 'status-dot';
    if (camLabel) camLabel.textContent = 'Camera Off';

    _updateGestureUI('none', 0);

    console.log('📷 Camera stopped');
  }

  // ─── Processing ───────────────────────────────────────────────────────────────

  function startProcessing() {
    if (processingInterval) return;

    // Process at ~10 FPS for gesture recognition (server-side)
    processingInterval = setInterval(() => {
      if (isActive && !isProcessing && gestureEnabled) {
        processFrame();
      }
    }, 100);
  }

  function stopProcessing() {
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }
    isProcessing = false;
  }

  async function processFrame() {
    if (!videoElement || !stream || !videoElement.readyState >= 2) return;

    isProcessing = true;

    try {
      // Capture frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 224;
      tempCanvas.height = 168;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(videoElement, 0, 0, 320, 240);
      const frameData = tempCanvas.toDataURL('image/jpeg', 0.5);

      // Send to backend for processing
      const result = await WSClient.processGestureFrame(
        frameData,
        WSClient.getSessionId() || 'default',
        WSClient.getUserId() || 'anon'
      );

      if (result) {
        _handleGestureResult(result);
      }
    } catch (e) {
      // Silently handle errors during gesture processing
    } finally {
      isProcessing = false;
    }
  }

  function _handleGestureResult(result) {
    const { gesture, action, confidence, annotated_frame } = result;

    // Show annotated frame
    if (annotated_frame && canvasElement && ctx) {
      // 🔥 Only update every 3rd frame
    if (!this._frameCount) this._frameCount = 0;
    this._frameCount++;

    if (this._frameCount % 3 === 0) {
      const img = new Image();
      img.src = annotated_frame;

      img.onload = () => {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(img, 0, 0, canvasElement.width, canvasElement.height);
    };
  }
}

    // Update gesture UI
    if (gesture && gesture !== 'none') {
      _updateGestureUI(gesture, confidence);
    }

    // Check threshold and cooldown
    const now = Date.now();
    const isSameGesture = gesture === lastGesture;
    const isOnCooldown = (now - lastGestureTime) < gestureRepeatDelay;

    if (
      confidence >= confidenceThreshold &&
      action &&
      gesture !== 'none' &&
      gesture !== 'unknown' &&
      (!isSameGesture || !isOnCooldown)
    ) {
      lastGesture = gesture;
      lastGestureTime = now;
      gestureCount++;

      document.getElementById('stat-gestures').textContent = gestureCount;

      // Execute action
      _executeGestureAction(gesture, action, confidence);

      // Broadcast to other users
      if (WSClient.isConnected()) {
        WSClient.sendGestureEvent({ gesture, action, confidence });
      }
    }
  }

  function _executeGestureAction(gesture, action, confidence) {
    if (!action?.type) return;

    // Trigger registered callbacks
    const cb = gestureCallbacks[action.type];
    if (cb) {
      cb(action, gesture, confidence);
    }

    // Dispatch event
    window.dispatchEvent(new CustomEvent('gesture-action', {
      detail: { gesture, action, confidence }
    }));
  }

  function _updateGestureUI(gesture, confidence) {
    const gestureIcons = {
      open_palm: '🖐️',
      fist: '✊',
      pinch: '🤏',
      pointing: '☝️',
      peace: '✌️',
      thumbs_up: '👍',
      three_fingers: '🤚',
      four_fingers: '✋',
      two_hand_spread: '🤲',
      two_hand_pinch: '👐',
      two_point: '☝️☝️',
      clap: '👏',
      none: '🤚'
    };

    const icon = document.getElementById('gesture-icon');
    const name = document.getElementById('gesture-name');
    const fill = document.getElementById('confidence-fill');
    const indicator = document.getElementById('gesture-indicator');

    if (icon) icon.textContent = gestureIcons[gesture] || '❓';
    if (name) name.textContent = gesture.replace(/_/g, ' ').toUpperCase();
    if (fill) fill.style.width = `${confidence * 100}%`;

    if (indicator) {
      indicator.className = `gesture-${gesture}`;
    }
  }

  // ─── Register Callbacks ───────────────────────────────────────────────────────

  function onGestureAction(actionType, callback) {
    gestureCallbacks[actionType] = callback;
  }

  function offGestureAction(actionType) {
    delete gestureCallbacks[actionType];
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    init,
    startCamera,
    stopCamera,
    toggleCamera,
    onGestureAction,
    offGestureAction,
    isActive: () => isActive,
    getGestureCount: () => gestureCount
  };
})();