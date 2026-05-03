// frontend/js/scene.js
// Three.js 3D Scene Manager

const SceneManager = (() => {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────
  let scene, camera, renderer, controls;
  let gridHelper, ambientLight, directionalLight, pointLight;
  let raycaster, mouse;
  let buildings = new Map(); // id -> { mesh, data }
  let selectedBuilding = null;
  let ghostMesh = null;
  let frameCount = 0, lastFPSTime = Date.now();
  let shadowsEnabled = true;
  let wireframeMode = false;
  let interactionMode = 'place'; // place | select | delete

  // Building types config
  const BUILDING_TYPES = {
    skyscraper: {
      createGeometry: (floors) => {
        const h = floors * 0.4;
        const g = new THREE.BoxGeometry(2, h, 2);
        // Add slight taper
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const factor = 1 - (y / h + 0.5) * 0.2;
          pos.setX(i, pos.getX(i) * Math.max(0.6, factor));
          pos.setZ(i, pos.getZ(i) * Math.max(0.6, factor));
        }
        pos.needsUpdate = true;
        return g;
      },
      yOffset: (floors) => floors * 0.2,
      defaultFloors: 20
    },
    office: {
      createGeometry: (floors) => new THREE.BoxGeometry(3, floors * 0.35, 3),
      yOffset: (floors) => floors * 0.175,
      defaultFloors: 10
    },
    residential: {
      createGeometry: (floors) => {
        const g = new THREE.CylinderGeometry(0, 1.8, 0.8, 4);
        return new THREE.BoxGeometry(2.5, floors * 0.3, 2.5);
      },
      yOffset: (floors) => floors * 0.15,
      defaultFloors: 5
    },
    tower: {
      createGeometry: (floors) => {
        const h = floors * 0.5;
        return new THREE.CylinderGeometry(0.6, 0.8, h, 8);
      },
      yOffset: (floors) => floors * 0.25,
      defaultFloors: 30
    },
    dome: {
      createGeometry: (floors) => {
        const r = 2 + floors * 0.05;
        return new THREE.SphereGeometry(r, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      },
      yOffset: () => 0,
      defaultFloors: 5
    },
    pyramid: {
      createGeometry: (floors) => {
        const h = floors * 0.4;
        return new THREE.ConeGeometry(2.5, h, 4);
      },
      yOffset: (floors) => floors * 0.2,
      defaultFloors: 10
    },
    warehouse: {
      createGeometry: (floors) => {
        const h = floors * 0.25;
        return new THREE.BoxGeometry(5, h, 8);
      },
      yOffset: (floors) => floors * 0.125,
      defaultFloors: 3
    },
    stadium: {
      createGeometry: () => {
        return new THREE.TorusGeometry(3, 1.2, 8, 24, Math.PI * 2);
      },
      yOffset: () => 1.2,
      defaultFloors: 4
    }
  };

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    const canvas = document.getElementById('three-canvas');
    const container = document.getElementById('viewport-container');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    scene.fog = new THREE.FogExp2(0x0a0e1a, 0.008);

    // Camera
    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(30, 30, 30);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 5;
    controls.maxDistance = 200;

    // Lights
    ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(50, 80, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 300;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.bias = -0.001;
    scene.add(directionalLight);

    // Hemisphere light for sky/ground
    const hemiLight = new THREE.HemisphereLight(0x4466aa, 0x223311, 0.4);
    scene.add(hemiLight);

    // Point light (moving)
    pointLight = new THREE.PointLight(0x4a90e2, 2, 50);
    pointLight.position.set(0, 20, 0);
    scene.add(pointLight);

    // Ground
    _createGround();

    // Grid
    _createGrid();

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Stars
    _createStarField();

    // Event listeners
    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      deselectBuilding();
    });

    // Start render loop
    animate();

    console.log('✅ Scene initialized');
  }

  function _createGround() {
    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40);
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0x0f1520,
      transparent: true,
      opacity: 0.95
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);

    // Ground border
    const borderGeo = new THREE.EdgesGeometry(groundGeo);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x1e3a5f, opacity: 0.3, transparent: true });
    const border = new THREE.LineSegments(borderGeo, borderMat);
    border.rotation.x = -Math.PI / 2;
    scene.add(border);
  }

  function _createGrid() {
    gridHelper = new THREE.GridHelper(100, 50, 0x1e3a5f, 0x0f2040);
    gridHelper.position.y = 0.01;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.6;
    scene.add(gridHelper);
  }

  function _createStarField() {
    const starGeo = new THREE.BufferGeometry();
    const stars = [];
    for (let i = 0; i < 2000; i++) {
      stars.push(
        (Math.random() - 0.5) * 500,
        Math.random() * 200 + 20,
        (Math.random() - 0.5) * 500
      );
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 0.3,
      transparent: true,
      opacity: 0.6
    });
    scene.add(new THREE.Points(starGeo, starMat));
  }

  // ─── Animation Loop ──────────────────────────────────────────────────────────

  function animate() {
    requestAnimationFrame(animate);

    // Update controls
    controls.update();

    // Animate point light
    const t = Date.now() * 0.001;
    pointLight.position.x = Math.sin(t * 0.5) * 30;
    pointLight.position.z = Math.cos(t * 0.5) * 30;
    pointLight.intensity = 1.5 + Math.sin(t * 2) * 0.3;

    // Animate buildings (slight breathing)
    buildings.forEach(({ mesh, data }) => {
      if (mesh === selectedBuilding) {
        mesh.children[0] && (mesh.children[0].material.emissiveIntensity =
          0.3 + Math.sin(t * 4) * 0.2);
      }
    });

    // Update ghost mesh
    if (ghostMesh) {
      ghostMesh.rotation.y += 0.02;
    }

    // FPS counter
    frameCount++;
    const now = Date.now();
    if (now - lastFPSTime >= 1000) {
      document.getElementById('stat-fps').textContent = frameCount;
      frameCount = 0;
      lastFPSTime = now;
    }

    renderer.render(scene, camera);

    // Update mini map
    updateMiniMap();
  }

  // ─── Building Creation ───────────────────────────────────────────────────────

  function addBuilding(buildingData) {
    const {
      id, type = 'skyscraper', color = '#4a90e2',
      position = { x: 0, y: 0, z: 0 },
      scale = { x: 1, y: 1, z: 1 },
      rotation = { y: 0 },
      floors = 10
    } = buildingData;

    const config = BUILDING_TYPES[type] || BUILDING_TYPES.skyscraper;

    // Create geometry
    const geometry = config.createGeometry(floors);

    // Create material with window texture
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color).multiplyScalar(0.1),
      shininess: 80,
      transparent: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `building_${id}`;
    mesh.userData = { buildingId: id, type, color, floors };

    // Position
    const yOffset = config.yOffset(floors);
    mesh.position.set(
      position.x,
      yOffset,
      position.z
    );
    mesh.scale.set(scale.x, scale.y, scale.z);
    mesh.rotation.y = rotation.y || 0;

    // Add windows effect
    _addWindowLights(mesh, color, floors, type);

    // Add selection outline group
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(position.x, 0, position.z);
    mesh.position.set(0, yOffset, 0);

    scene.add(group);

    buildings.set(id, {
      mesh: group,
      data: buildingData,
      type,
      color
    });

    // Entrance animation
    group.scale.set(0, 0, 0);
    const targetScale = { x: scale.x, y: scale.y, z: scale.z };
    _animateScale(group, targetScale, 300);

    updateStats();
    return group;
  }

  function _addWindowLights(mesh, color, floors, type) {
    if (['dome', 'pyramid', 'stadium'].includes(type)) return;

    const windowColor = new THREE.Color(color).lerp(new THREE.Color(0xffff88), 0.7);
    const windowLight = new THREE.PointLight(windowColor, 0.3, 5);
    windowLight.position.set(0, 0, 1.5);
    mesh.add(windowLight);
  }

  function _animateScale(obj, target, duration) {
    const start = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
    const startTime = Date.now();

    function step() {
      const t = Math.min((Date.now() - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease out cubic

      obj.scale.set(
        start.x + (target.x - start.x) * ease,
        start.y + (target.y - start.y) * ease,
        start.z + (target.z - start.z) * ease
      );

      if (t < 1) requestAnimationFrame(step);
    }
    step();
  }

  function updateBuilding(id, updates) {
    const entry = buildings.get(id);
    if (!entry) return;

    const { mesh, data } = entry;

    if (updates.position) {
      mesh.position.set(
        updates.position.x,
        0,
        updates.position.z
      );
    }

    if (updates.scale) {
      const s = updates.scale;
      mesh.scale.set(s.x || 1, s.y || 1, s.z || 1);
    }

    if (updates.rotation) {
      mesh.rotation.y = updates.rotation.y || 0;
    }

    if (updates.color) {
      const buildingMesh = mesh.children[0];
      if (buildingMesh) {
        buildingMesh.material.color.set(updates.color);
        buildingMesh.material.emissive.set(
          new THREE.Color(updates.color).multiplyScalar(0.1)
        );
      }
      entry.color = updates.color;
    }

    Object.assign(entry.data, updates);
    updateStats();
  }

  function removeBuilding(id) {
    const entry = buildings.get(id);
    if (!entry) return;

    // Remove animation
    const { mesh } = entry;
    _animateScale(mesh, { x: 0, y: 0, z: 0 }, 200);

    setTimeout(() => {
      scene.remove(mesh);
      mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }, 210);

    if (selectedBuilding && selectedBuilding.userData?.buildingId === id) {
      deselectBuilding();
    }

    buildings.delete(id);
    updateStats();
  }

  function clearAllBuildings() {
    buildings.forEach((entry, id) => {
      scene.remove(entry.mesh);
      entry.mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    });
    buildings.clear();
    selectedBuilding = null;
    updateStats();
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  function selectBuilding(id) {
    deselectBuilding();

    const entry = buildings.get(id);
    if (!entry) return;

    selectedBuilding = entry.mesh;
    const buildingMesh = entry.mesh.children[0];

    if (buildingMesh) {
      buildingMesh.material.emissive.set(0x4a90e2);
      buildingMesh.material.emissiveIntensity = 0.3;

      // Selection outline
      const outlineGeo = buildingMesh.geometry.clone();
      const outlineMat = new THREE.MeshBasicMaterial({
        color: 0x4a90e2,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.5
      });
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      outline.scale.multiplyScalar(1.05);
      outline.name = 'selection_outline';
      buildingMesh.add(outline);
    }

    // Show property panel
    const panel = document.getElementById('selected-panel');
    if (panel) {
      panel.style.display = 'block';
      const pos = entry.mesh.position;
      document.getElementById('prop-x').value = pos.x.toFixed(1);
      document.getElementById('prop-y').value = pos.y.toFixed(1);
      document.getElementById('prop-z').value = pos.z.toFixed(1);
      document.getElementById('prop-scale').value = entry.mesh.scale.x.toFixed(1);
      document.getElementById('prop-rot').value = Math.round(THREE.MathUtils.radToDeg(entry.mesh.rotation.y));
      document.getElementById('prop-floors').value = entry.data.floors || 10;
    }
  }

  function deselectBuilding() {
    if (!selectedBuilding) return;

    const buildingMesh = selectedBuilding.children[0];
    if (buildingMesh) {
      buildingMesh.material.emissiveIntensity = 0.05;
      const outline = buildingMesh.getObjectByName('selection_outline');
      if (outline) buildingMesh.remove(outline);
    }

    selectedBuilding = null;

    const panel = document.getElementById('selected-panel');
    if (panel) panel.style.display = 'none';
  }

  function getSelectedBuildingId() {
    if (!selectedBuilding) return null;
    return selectedBuilding.userData?.buildingId || 
           Array.from(buildings.entries())
             .find(([, v]) => v.mesh === selectedBuilding)?.[0];
  }

  // ─── Ghost / Preview Mesh ─────────────────────────────────────────────────────

  function showGhostMesh(type, color, floors, position) {
    if (!ghostMesh) {
      const config = BUILDING_TYPES[type] || BUILDING_TYPES.skyscraper;
      const geo = config.createGeometry(floors);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.35,
        wireframe: false
      });
      ghostMesh = new THREE.Mesh(geo, mat);
      ghostMesh.name = 'ghost';
      scene.add(ghostMesh);
    }

    const config = BUILDING_TYPES[type] || BUILDING_TYPES.skyscraper;
    ghostMesh.position.set(
      position.x,
      config.yOffset(floors),
      position.z
    );
    ghostMesh.visible = true;
  }

  function hideGhostMesh() {
    if (ghostMesh) {
      ghostMesh.visible = false;
    }
  }

  // ─── Raycasting ──────────────────────────────────────────────────────────────

  function getGroundPosition(screenX, screenY) {
    const container = document.getElementById('viewport-container');
    const rect = container.getBoundingClientRect();

    mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const ground = scene.getObjectByName('ground');
    if (ground) {
      const hits = raycaster.intersectObject(ground);
      if (hits.length > 0) {
        const p = hits[0].point;
        // Snap to grid
        return {
          x: Math.round(p.x / 3) * 3,
          y: 0,
          z: Math.round(p.z / 3) * 3
        };
      }
    }
    return null;
  }

  function getBuildingAtScreen(screenX, screenY) {
    const container = document.getElementById('viewport-container');
    const rect = container.getBoundingClientRect();

    mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = [];
    buildings.forEach(({ mesh }) => {
      mesh.traverse(child => {
        if (child.isMesh && child.name !== 'selection_outline') {
          meshes.push(child);
        }
      });
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      let obj = hits[0].object;
      // Walk up to find building group
      while (obj.parent && !obj.parent.name?.startsWith('building_')) {
        obj = obj.parent;
      }
      // Find building ID
      for (const [id, { mesh }] of buildings.entries()) {
        if (mesh.children.includes(obj) || mesh === obj) {
          return id;
        }
      }
    }
    return null;
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  function onMouseMove(e) {
    const pos = getGroundPosition(e.clientX, e.clientY);
    if (pos) {
      // Show cursor preview
      const preview = document.getElementById('cursor-preview');
      if (preview) {
        preview.style.display = 'block';
        const rect = renderer.domElement.getBoundingClientRect();
        preview.style.left = `${e.clientX - rect.left}px`;
        preview.style.top = `${e.clientY - rect.top}px`;
      }
    }
  }

  function onCanvasClick(e) {
    if (e.button !== 0) return;

    if (interactionMode === 'place') {
      const pos = getGroundPosition(e.clientX, e.clientY);
      if (pos) {
        // Trigger place from main.js
        window.dispatchEvent(new CustomEvent('canvas-place', { detail: { position: pos } }));
      }
    } else if (interactionMode === 'select') {
      const buildingId = getBuildingAtScreen(e.clientX, e.clientY);
      if (buildingId) {
        selectBuilding(buildingId);
        window.dispatchEvent(new CustomEvent('building-selected', { detail: { id: buildingId } }));
      } else {
        deselectBuilding();
      }
    } else if (interactionMode === 'delete') {
      const buildingId = getBuildingAtScreen(e.clientX, e.clientY);
      if (buildingId) {
        window.dispatchEvent(new CustomEvent('canvas-delete', { detail: { id: buildingId } }));
      }
    }
  }

  function onResize() {
    const container = document.getElementById('viewport-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  // ─── Camera Controls ─────────────────────────────────────────────────────────

  function resetCamera() {
    camera.position.set(30, 30, 30);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function setTopView() {
    camera.position.set(0, 80, 0.01);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function setIsoView() {
    camera.position.set(40, 40, 40);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function zoomIn() {
    const dir = new THREE.Vector3().subVectors(
      controls.target, camera.position
    ).normalize();
    camera.position.addScaledVector(dir, 5);
    controls.update();
  }

  function zoomOut() {
    const dir = new THREE.Vector3().subVectors(
      camera.position, controls.target
    ).normalize();
    camera.position.addScaledVector(dir, 5);
    controls.update();
  }

  // ─── Mini Map ─────────────────────────────────────────────────────────────────

  function updateMiniMap() {
    const canvas = document.getElementById('mini-map');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(10, 14, 26, 0.9)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.5)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * (w / 10), 0);
      ctx.lineTo(i * (w / 10), h);
      ctx.moveTo(0, i * (h / 10));
      ctx.lineTo(w, i * (h / 10));
      ctx.stroke();
    }

    // Buildings
    const mapScale = w / 100;
    buildings.forEach(({ mesh, data, color }) => {
      const px = (mesh.position.x + 50) * mapScale;
      const py = (mesh.position.z + 50) * mapScale;
      const size = Math.max(3, 6 * mesh.scale.x);

      ctx.fillStyle = color || '#4a90e2';
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    });

    // Camera position
    const camX = (camera.position.x + 50) * mapScale;
    const camZ = (camera.position.z + 50) * mapScale;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(Math.max(5, Math.min(w - 5, camX)),
            Math.max(5, Math.min(h - 5, camZ)), 3, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
  }

  // ─── Scene Data Export ───────────────────────────────────────────────────────

  function getAllBuildingsData() {
    const result = [];
    buildings.forEach((entry, id) => {
      result.push({
        id,
        type: entry.data.type || 'skyscraper',
        color: entry.color || '#4a90e2',
        floors: entry.data.floors || 10,
        position: {
          x: entry.mesh.position.x,
          y: 0,
          z: entry.mesh.position.z
        },
        scale: {
          x: entry.mesh.scale.x,
          y: entry.mesh.scale.y,
          z: entry.mesh.scale.z
        },
        rotation: {
          y: entry.mesh.rotation.y
        }
      });
    });
    return result;
  }

  // ─── Toggle Effects ───────────────────────────────────────────────────────────

  function toggleGrid(visible) {
    if (gridHelper) gridHelper.visible = visible;
  }

  function toggleShadows(enabled) {
    shadowsEnabled = enabled;
    renderer.shadowMap.enabled = enabled;
    buildings.forEach(({ mesh }) => {
      mesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = enabled;
          child.receiveShadow = enabled;
        }
      });
    });
  }

  function toggleWireframe(enabled) {
    wireframeMode = enabled;
    buildings.forEach(({ mesh }) => {
      mesh.traverse(child => {
        if (child.isMesh && child.name !== 'selection_outline') {
          child.material.wireframe = enabled;
        }
      });
    });
  }

  function setInteractionMode(mode) {
    interactionMode = mode;
    controls.enabled = (mode !== 'place');
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  function updateStats() {
    const el = document.getElementById('stat-buildings');
    if (el) el.textContent = buildings.size;
  }

  function takeScreenshot() {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesture-3d-${Date.now()}.png`;
    a.click();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    init,
    addBuilding,
    updateBuilding,
    removeBuilding,
    clearAllBuildings,
    selectBuilding,
    deselectBuilding,
    getSelectedBuildingId,
    showGhostMesh,
    hideGhostMesh,
    getGroundPosition,
    getBuildingAtScreen,
    getAllBuildingsData,
    resetCamera,
    setTopView,
    setIsoView,
    zoomIn,
    zoomOut,
    toggleGrid,
    toggleShadows,
    toggleWireframe,
    setInteractionMode,
    takeScreenshot,
    getScene: () => scene,
    getCamera: () => camera,
    getBuildingCount: () => buildings.size
  };
})();