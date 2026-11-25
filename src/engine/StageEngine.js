import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) {
      obj.geometry.dispose();
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat.map && mat.map !== root.userData?.sharedLedTexture) {
          mat.map.dispose();
        }
        mat.dispose();
      }
    }
  });
}

export class StageEngine {
  constructor(container, store, audioSynth, onFixtureSelect) {
    this.container = container;
    this.store = store;
    this.audioSynth = audioSynth;
    this.onFixtureSelect = onFixtureSelect;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.stageGroup = new THREE.Group();
    this.fixturesGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();

    this.movingHeadRefs = [];
    this.parWashRefs = [];
    this.strobeRefs = [];
    this.laserRefs = [];
    this.subMeshRefs = [];
    this.stageSpotLights = [];

    this.curtainLeftMesh = null;
    this.curtainRightMesh = null;
    this.curtainAnimTarget = null;

    this.ledWallCanvas = null;
    this.ledWallCtx = null;
    this.ledWallTexture = null;

    this.smokeParticles = null;
    this.smokePositions = [];
    this.sparkParticles = null;
    this.sparkData = [];

    this.graphicHigh = true;
    this.selectedFixtureIndex = null;
    this.rafId = null;

    // Smooth camera preset transition target
    this.camTransition = null;

    this._onResize = this.onWindowResize.bind(this);
    this._onClick = this.onCanvasClick.bind(this);
  }

  init() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 550;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060a12);
    this.scene.fog = new THREE.FogExp2(0x060a12, 0.015);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 200);
    this.camera.position.set(0, 9.5, 23);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      this.container.innerHTML = `
        <div class="webgl-fallback">
          <h3>WebGL Tidak Tersedia</h3>
          <p>Peramban atau perangkat Anda tidak mendukung akselerasi WebGL 3D. Silakan aktifkan hardware acceleration atau gunakan Chrome/Firefox/Edge terbaru.</p>
        </div>
      `;
      return false;
    }

    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 55;
    this.controls.target.set(0, 3.5, 0);
    this.controls.update();

    // Base Venue Lighting
    const ambient = new THREE.AmbientLight(0x334155, 0.8);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x94a3b8, 0.5);
    dirLight.position.set(15, 28, 20);
    this.scene.add(dirLight);

    // Venue Floor & Grid
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.45, metalness: 0.2 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    this.scene.add(floorMesh);

    const gridHelper = new THREE.GridHelper(70, 70, 0x1e293b, 0x0f172a);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // Dynamic LED Backdrop Canvas Texture
    this.ledWallCanvas = document.createElement('canvas');
    this.ledWallCanvas.width = 512;
    this.ledWallCanvas.height = 256;
    this.ledWallCtx = this.ledWallCanvas.getContext('2d');
    this.ledWallTexture = new THREE.CanvasTexture(this.ledWallCanvas);

    this.stageGroup.userData.sharedLedTexture = this.ledWallTexture;
    this.scene.add(this.stageGroup, this.fixturesGroup, this.fxGroup);

    this.rebuildStage3D();
    this.initParticleSystems();

    this.renderer.domElement.addEventListener('click', this._onClick);
    window.addEventListener('resize', this._onResize);

    this.rafId = requestAnimationFrame(this.animateLoop.bind(this));
    return true;
  }

  clearAndDisposeGroup(group) {
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      disposeObject3D(obj);
    }
  }

  rebuildStage3D() {
    if (!this.stageGroup || !this.fixturesGroup) return;
    this.clearAndDisposeGroup(this.stageGroup);
    this.clearAndDisposeGroup(this.fixturesGroup);

    this.movingHeadRefs = [];
    this.parWashRefs = [];
    this.strobeRefs = [];
    this.laserRefs = [];
    this.subMeshRefs = [];
    this.stageSpotLights = [];
    this.curtainLeftMesh = null;
    this.curtainRightMesh = null;

    const cfg = this.store.stageConfig;
    const W = cfg.ukuranPanggung.lebar;
    const D = cfg.ukuranPanggung.panjang;
    const H = cfg.ukuranPanggung.tinggi;
    const roofH = H + 7.2;
    const type = cfg.tipePanggung;

    // 1. MAIN STAGE DECK
    const deckMat = new THREE.MeshStandardMaterial({
      color: type === 'indoor_ballroom' ? 0x3b0d1e : 0x151c28,
      roughness: 0.55,
      metalness: 0.25,
    });
    const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), deckMat);
    deckMesh.position.set(0, H / 2, 0);
    this.stageGroup.add(deckMesh);

    const rimMat = new THREE.MeshBasicMaterial({
      color: type === 'indoor_ballroom' ? 0xf59e0b : 0x38bdf8,
    });
    const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.08, D + 0.08), rimMat);
    rimMesh.position.set(0, H - 0.04, 0);
    this.stageGroup.add(rimMesh);

    // Optional Catwalk T-Stage Runway
    if (type === 'catwalk_t') {
      const catW = 2.6;
      const catD = 5.5;
      const catMesh = new THREE.Mesh(new THREE.BoxGeometry(catW, H, catD), deckMat);
      catMesh.position.set(0, H / 2, D / 2 + catD / 2);
      this.stageGroup.add(catMesh);

      const catRim = new THREE.Mesh(new THREE.BoxGeometry(catW + 0.08, 0.06, catD + 0.06), rimMat);
      catRim.position.set(0, H - 0.03, D / 2 + catD / 2);
      this.stageGroup.add(catRim);
    }

    // Stage Stairs Left
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    for (let s = 0; s < 3; s++) {
      const stepH = (H / 3) * (s + 1);
      const stepMeshL = new THREE.Mesh(new THREE.BoxGeometry(1.1, stepH, 0.4), stairMat);
      stepMeshL.position.set(-W / 2 - 0.55, stepH / 2, D / 2 - 1.2 + s * 0.4);
      this.stageGroup.add(stepMeshL);
    }

    // 2. ALUMINIUM BOX TRUSS RIGGING TOWERS & GRID
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.25,
    });
    const trussWireMat = new THREE.MeshBasicMaterial({ color: 0x475569, wireframe: true });

    const halfW = W / 2 - 0.35;
    const halfD = D / 2 - 0.35;
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
    ];

    for (const [cx, cz] of corners) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.42, roofH, 0.42), trussWireMat);
      tower.position.set(cx, roofH / 2, cz);
      this.stageGroup.add(tower);

      const core = new THREE.Mesh(new THREE.BoxGeometry(0.18, roofH, 0.18), trussMat);
      core.position.set(cx, roofH / 2, cz);
      this.stageGroup.add(core);
    }

    for (const bz of [halfD, 0, -halfD]) {
      const hBeam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.42, 0.42), trussWireMat);
      hBeam.position.set(0, roofH, bz);
      this.stageGroup.add(hBeam);
    }

    for (const bx of [-halfW, halfW]) {
      const sBeam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, D), trussWireMat);
      sBeam.position.set(bx, roofH, 0);
      this.stageGroup.add(sBeam);
    }

    // Audio Wing Outrigger Trusses
    const wingSpan = 2.4;
    for (const wx of [-halfW - wingSpan / 2, halfW + wingSpan / 2]) {
      const wBeam = new THREE.Mesh(new THREE.BoxGeometry(wingSpan, 0.38, 0.38), trussWireMat);
      wBeam.position.set(wx, roofH - 0.4, halfD - 0.4);
      this.stageGroup.add(wBeam);
    }

    // 3. OPTIONAL ROOF CANOPY TARP
    if (cfg.atapCanopy && type !== 'indoor_ballroom') {
      const maxDim = Math.max(W, D);
      const roofMesh = new THREE.Mesh(
        new THREE.ConeGeometry(maxDim * 0.78, 2.2, 4),
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.7,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
        })
      );
      roofMesh.position.set(0, roofH + 1.25, 0);
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.scale.set(W / maxDim, 1, D / maxDim);
      this.stageGroup.add(roofMesh);
    }

    // 4. BACKDROP LED VIDEOTRON WALL
    if (cfg.ledBackdrop) {
      const ledW = W * 0.78;
      const ledH = Math.min(5.2, roofH - H - 1.1);
      const ledMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ledW, ledH),
        new THREE.MeshBasicMaterial({ map: this.ledWallTexture, side: THREE.DoubleSide })
      );
      ledMesh.position.set(0, H + ledH / 2 + 0.3, -halfD + 0.3);
      this.stageGroup.add(ledMesh);
    }

    // 5. ANIMATED STAGE CURTAINS
    const curtainH = roofH - H - 0.25;
    const maxHalfCurtainW = (W - 0.8) / 2;
    const curtainMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const cGeo = new THREE.BoxGeometry(maxHalfCurtainW, curtainH, 0.15);
    this.curtainLeftMesh = new THREE.Mesh(cGeo, curtainMat);
    this.curtainRightMesh = new THREE.Mesh(cGeo, curtainMat);

    const curtainZ = halfD - 0.75;
    const curtainY = H + curtainH / 2;
    this.curtainLeftMesh.position.set(-maxHalfCurtainW / 2, curtainY, curtainZ);
    this.curtainRightMesh.position.set(maxHalfCurtainW / 2, curtainY, curtainZ);
    this.stageGroup.add(this.curtainLeftMesh, this.curtainRightMesh);
    this.applyCurtainTransform(W);

    // 6. MOVING HEAD BEAM FIXTURES
    const beamCount = cfg.counts.moving_head_beam || 0;
    const beamColor = new THREE.Color(cfg.dmxState.primaryColor);
    for (let i = 0; i < beamCount; i++) {
      const isFrontRow = i % 2 === 0;
      const rowCount = Math.ceil(beamCount / 2);
      const idxInRow = Math.floor(i / 2);
      const spanW = W - 1.8;
      const posX = rowCount <= 1 ? 0 : -spanW / 2 + (idxInRow / (rowCount - 1)) * spanW;
      const posZ = isFrontRow ? halfD : -halfD + 0.8;
      const posY = roofH - 0.35;

      const fixtureObj = this.createMovingHeadFixture(posX, posY, posZ, beamColor, i);
      this.fixturesGroup.add(fixtureObj.root);
      this.movingHeadRefs.push(fixtureObj);
    }

    // 7. PAR LED WASH FIXTURES
    const parCount = cfg.counts.par_led_wash || 0;
    const washColor = new THREE.Color(cfg.dmxState.washColor);
    for (let i = 0; i < parCount; i++) {
      const spanW = W - 2.0;
      const posX = parCount <= 1 ? 0 : -spanW / 2 + (i / (parCount - 1)) * spanW;
      const parObj = this.createParWashFixture(posX, roofH - 0.3, 0, washColor);
      this.fixturesGroup.add(parObj.root);
      this.parWashRefs.push(parObj);
    }

    const stagePointLight = new THREE.PointLight(washColor, 1.4, W * 1.8);
    stagePointLight.position.set(0, H + 4.0, 1.0);
    this.fixturesGroup.add(stagePointLight);
    this.stageSpotLights.push(stagePointLight);

    // 8. STROBE BLINDER FIXTURES
    const strobeCount = cfg.counts.strobe_blinder || 0;
    for (let i = 0; i < strobeCount; i++) {
      const spanW = W - 3.0;
      const posX = strobeCount <= 1 ? 0 : -spanW / 2 + (i / (strobeCount - 1)) * spanW;
      const sObj = this.createStrobeBlinderFixture(posX, roofH - 0.25, halfD + 0.25);
      this.fixturesGroup.add(sObj.root);
      this.strobeRefs.push(sObj);
    }

    // 9. STAGE LASER PROJECTORS
    const laserCount = cfg.counts.laser_rgb || 0;
    const laserColor = new THREE.Color(cfg.dmxState.laserColor);
    for (let i = 0; i < laserCount; i++) {
      const spanW = W * 0.65;
      const posX = laserCount <= 1 ? 0 : -spanW / 2 + (i / (laserCount - 1)) * spanW;
      const lObj = this.createLaserProjectorFixture(posX, H + 1.1, -halfD + 0.9, laserColor);
      this.fixturesGroup.add(lObj.root);
      this.laserRefs.push(lObj);
    }

    // 10. LINE ARRAY SPEAKERS
    const totalLineArray = cfg.counts.line_array_box || 0;
    const boxesPerSide = Math.floor(totalLineArray / 2);
    const spkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.3 });
    const grillMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });

    for (const sideX of [-halfW - 1.2, halfW + 1.2]) {
      for (let b = 0; b < boxesPerSide; b++) {
        const boxGroup = new THREE.Group();
        const boxBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.36, 0.65), spkMat);
        const boxGrill = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.31, 0.05), grillMat);
        boxGrill.position.z = 0.33;
        boxGroup.add(boxBody, boxGrill);
        boxGroup.position.set(sideX, roofH - 0.85 - b * 0.4, halfD - 0.35);
        boxGroup.rotation.x = b * 0.045;
        this.fixturesGroup.add(boxGroup);
      }
    }

    // 11. GROUND STACK SUBWOOFERS
    const subCount = cfg.counts.subwoofer_dual18 || 0;
    const coneMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
    for (let i = 0; i < subCount; i++) {
      const spanW = W - 1.2;
      const posX = subCount <= 1 ? 0 : -spanW / 2 + (i / (subCount - 1)) * spanW;
      const subGroup = new THREE.Group();
      const subCabinet = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.75, 0.85), spkMat);
      const subCone1 = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), coneMat);
      const subCone2 = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), coneMat);
      subCone1.position.set(-0.27, 0, 0.43);
      subCone2.position.set(0.27, 0, 0.43);
      subGroup.add(subCabinet, subCone1, subCone2);
      subGroup.position.set(posX, 0.38, D / 2 + 0.55);
      this.fixturesGroup.add(subGroup);
      this.subMeshRefs.push(subGroup);
    }

    // 12. COLD SPARKULAR UNITS
    const sparkCount = cfg.counts.cold_sparkular || 0;
    const sparkMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 });
    for (let i = 0; i < sparkCount; i++) {
      const spanW = W - 2.0;
      const posX = sparkCount <= 1 ? 0 : -spanW / 2 + (i / (sparkCount - 1)) * spanW;
      const unit = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.32), sparkMat);
      unit.position.set(posX, H + 0.14, D / 2 - 0.35);
      this.fixturesGroup.add(unit);
    }
  }

  createMovingHeadFixture(x, y, z, color, index) {
    const root = new THREE.Group();
    root.position.set(x, y, z);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.6 });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.35), bodyMat));

    const panGroup = new THREE.Group();
    panGroup.position.y = -0.25;
    root.add(panGroup);
    panGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.12), bodyMat));

    const tiltGroup = new THREE.Group();
    tiltGroup.position.y = -0.15;
    panGroup.add(tiltGroup);

    const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.45, 14), bodyMat);
    tiltGroup.add(headMesh);

    const lensMat = new THREE.MeshBasicMaterial({ color });
    const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14), lensMat);
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.y = -0.23;
    tiltGroup.add(lensMesh);

    const coneLen = 13.5;
    const coneGeo = new THREE.ConeGeometry(2.15, coneLen, 20, 1, true);
    coneGeo.translate(0, -coneLen / 2 - 0.23, 0);

    const coneMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    tiltGroup.add(new THREE.Mesh(coneGeo, coneMat));

    return { root, panGroup, tiltGroup, headMesh, lensMat, coneMat, index };
  }

  createParWashFixture(x, y, z, color) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.2, 0.25, 12),
        new THREE.MeshStandardMaterial({ color: 0x0f172a })
      )
    );

    const lensMat = new THREE.MeshBasicMaterial({ color });
    const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), lensMat);
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.y = -0.13;
    root.add(lensMesh);

    const washConeGeo = new THREE.ConeGeometry(3.6, 8.0, 16, 1, true);
    washConeGeo.translate(0, -4.1, 0);
    const washConeMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    root.add(new THREE.Mesh(washConeGeo, washConeMat));

    return { root, lensMat, washConeMat };
  }

  createStrobeBlinderFixture(x, y, z) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.28, 0.16), new THREE.MeshStandardMaterial({ color: 0x1e293b })));

    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    for (let b = -1.5; b <= 1.5; b += 1) {
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), bulbMat);
      bulb.position.set(b * 0.14, 0, 0.09);
      root.add(bulb);
    }

    return { root, bulbMat };
  }

  createLaserProjectorFixture(x, y, z, color) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.32), new THREE.MeshStandardMaterial({ color: 0x0f172a })));

    const fanGroup = new THREE.Group();
    root.add(fanGroup);

    const rayMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const rayCount = 9;
    for (let r = 0; r < rayCount; r++) {
      const angle = (r / (rayCount - 1) - 0.5) * 1.1;
      const rayGeo = new THREE.CylinderGeometry(0.015, 0.04, 16, 6);
      rayGeo.translate(0, 8, 0);
      const rayMesh = new THREE.Mesh(rayGeo, rayMat);
      rayMesh.rotation.x = Math.PI / 2 - 0.18;
      rayMesh.rotation.z = angle;
      fanGroup.add(rayMesh);
    }

    return { root, fanGroup, rayMat };
  }

  initParticleSystems() {
    this.clearAndDisposeGroup(this.fxGroup);

    // Smoke / Haze Cloud Particles
    const smokeCount = 160;
    const smokeGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(smokeCount * 3);
    this.smokePositions = [];

    for (let i = 0; i < smokeCount; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 18;
      sPos[i * 3 + 1] = 0.5 + Math.random() * 6.5;
      sPos[i * 3 + 2] = (Math.random() - 0.5) * 12;
      this.smokePositions.push({ vx: (Math.random() - 0.5) * 0.015, vy: 0.006 + Math.random() * 0.01 });
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));

    this.smokeParticles = new THREE.Points(
      smokeGeo,
      new THREE.PointsMaterial({
        color: 0x94a3b8,
        size: 1.8,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.fxGroup.add(this.smokeParticles);

    // Cold Sparkular Fountain Particles
    const sparkTotal = 240;
    const sparkGeo = new THREE.BufferGeometry();
    const spPos = new Float32Array(sparkTotal * 3);
    this.sparkData = [];

    for (let i = 0; i < sparkTotal; i++) {
      spPos[i * 3] = 0;
      spPos[i * 3 + 1] = -10;
      spPos[i * 3 + 2] = 0;
      this.sparkData.push({
        vy: 0.08 + Math.random() * 0.12,
        vx: (Math.random() - 0.5) * 0.03,
        vz: (Math.random() - 0.5) * 0.03,
        life: Math.random(),
      });
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));

    this.sparkParticles = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        color: 0xfbbf24,
        size: 0.24,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.fxGroup.add(this.sparkParticles);
  }

  applyCurtainTransform(W) {
    if (!this.curtainLeftMesh || !this.curtainRightMesh) return;
    const openRatio = this.store.stageConfig.tiraiBukaan / 100;
    const maxHalfW = (W - 0.8) / 2;
    const scaleX = Math.max(0.06, 1 - openRatio * 0.88);

    this.curtainLeftMesh.scale.x = scaleX;
    this.curtainRightMesh.scale.x = scaleX;
    this.curtainLeftMesh.position.x = -maxHalfW + (maxHalfW * scaleX) / 2;
    this.curtainRightMesh.position.x = maxHalfW - (maxHalfW * scaleX) / 2;
  }

  animateCurtainTo(targetPct) {
    this.curtainAnimTarget = targetPct;
  }

  setCameraPreset(preset) {
    const presets = {
      foh: { pos: new THREE.Vector3(0, 11.2, 23.8), target: new THREE.Vector3(0, 3.5, 0) },
      bird: { pos: new THREE.Vector3(10.8, 24.5, 16.2), target: new THREE.Vector3(0, 2.5, 0) },
      front: { pos: new THREE.Vector3(0, 5.8, 16.0), target: new THREE.Vector3(0, 3.0, 1.5) },
      side: { pos: new THREE.Vector3(20.6, 11.4, 9.2), target: new THREE.Vector3(0, 3.5, 0) },
    };
    const p = presets[preset];
    if (p) {
      this.camTransition = p;
    }
  }

  setAutoOrbit(enabled) {
    if (this.controls) {
      this.controls.autoRotate = enabled;
      this.controls.autoRotateSpeed = 1.6;
    }
  }

  setGraphicQuality(high) {
    this.graphicHigh = high;
    if (this.renderer) {
      this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    }
  }

  setBeamColor(hex) {
    const c = new THREE.Color(hex);
    for (const mh of this.movingHeadRefs) {
      mh.coneMat.color.copy(c);
      mh.lensMat.color.copy(c);
    }
  }

  setWashColor(hex) {
    const c = new THREE.Color(hex);
    for (const pw of this.parWashRefs) {
      pw.washConeMat.color.copy(c);
      pw.lensMat.color.copy(c);
    }
    for (const sl of this.stageSpotLights) {
      sl.color.copy(c);
    }
  }

  setLaserColor(hex) {
    const c = new THREE.Color(hex);
    for (const ls of this.laserRefs) {
      ls.rayMat.color.copy(c);
    }
  }

  clearFixtureSelection() {
    this.selectedFixtureIndex = null;
  }

  onCanvasClick(e) {
    if (!this.camera || !this.renderer || this.movingHeadRefs.length === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const clickableMeshes = this.movingHeadRefs.map((m) => m.headMesh);
    const intersects = this.raycaster.intersectObjects(clickableMeshes, true);

    if (intersects.length > 0) {
      const hitObj = intersects[0].object;
      const foundIdx = this.movingHeadRefs.findIndex(
        (m) => m.headMesh === hitObj || m.headMesh.children.includes(hitObj)
      );
      if (foundIdx !== -1) {
        this.selectedFixtureIndex = foundIdx;
        if (this.onFixtureSelect) this.onFixtureSelect(foundIdx);
      }
    }
  }

  onWindowResize() {
    if (!this.renderer || !this.camera || !this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animateLoop(timestamp) {
    this.rafId = requestAnimationFrame(this.animateLoop.bind(this));
    const t = timestamp * 0.001;
    const cfg = this.store.stageConfig;
    const dmx = cfg.dmxState;

    // 1. Audio Beat & Visualizer
    const beatEnergy = this.audioSynth ? this.audioSynth.tick(t, dmx.cueMode) : 0;

    // 2. Smooth Camera Preset Transition
    if (this.camTransition && this.controls) {
      this.camera.position.lerp(this.camTransition.pos, 0.12);
      this.controls.target.lerp(this.camTransition.target, 0.12);
      if (this.camera.position.distanceTo(this.camTransition.pos) < 0.08) {
        this.camTransition = null;
      }
    }
    if (this.controls) this.controls.update();

    // 3. Smooth Curtain Animation
    if (this.curtainAnimTarget !== null) {
      const diff = this.curtainAnimTarget - cfg.tiraiBukaan;
      if (Math.abs(diff) < 0.8) {
        cfg.tiraiBukaan = this.curtainAnimTarget;
        this.curtainAnimTarget = null;
      } else {
        cfg.tiraiBukaan += diff * 0.09;
      }
      const slider = document.getElementById('rng-curtain-open');
      const valLbl = document.getElementById('val-curtain-open');
      if (slider) slider.value = Math.round(cfg.tiraiBukaan);
      if (valLbl) valLbl.textContent = `${Math.round(cfg.tiraiBukaan)}%`;
      this.applyCurtainTransform(cfg.ukuranPanggung.lebar);
    }

    // 4. DMX Lighting Cue Calculation
    const speed = dmx.speed || 1.2;
    const dimmerNorm = dmx.cueMode === 'BLACKOUT' ? 0 : dmx.dimmer / 100;
    const activeStrobeHz = dmx.cueMode === 'STROBE_DROP' ? Math.max(12, dmx.strobeHz) : dmx.strobeHz;
    const strobeGate = activeStrobeHz > 0 ? (Math.sin(t * activeStrobeHz * Math.PI * 2) > 0 ? 1 : 0.05) : 1;
    const beatBoost = dmx.beatSyncActive ? 0.75 + beatEnergy * 0.55 : 1.0;
    const smokeNorm = dmx.smokeLevel / 100;
    const coneOpacity = dimmerNorm * strobeGate * beatBoost * (0.12 + smokeNorm * 0.34);

    if (this.scene?.fog) {
      this.scene.fog.density = 0.006 + smokeNorm * 0.022;
    }

    this.movingHeadRefs.forEach((mh, idx) => {
      let panRad = THREE.MathUtils.degToRad(dmx.panDeg);
      let tiltRad = THREE.MathUtils.degToRad(dmx.tiltDeg);

      if (dmx.cueMode === 'WAVE') {
        panRad = Math.sin(t * speed * 1.6 + idx * 0.55) * 0.65;
        tiltRad = 0.45 + Math.cos(t * speed * 1.4 + idx * 0.45) * 0.42;
      } else if (dmx.cueMode === 'BALLYHOO') {
        panRad = Math.sin(t * speed * 2.4 + idx * 0.9) * 0.95;
        tiltRad = 0.35 + Math.sin(t * speed * 3.1 + idx * 0.7) * 0.55;
      } else if (dmx.cueMode === 'CENTER') {
        const pos = mh.root.position;
        panRad = Math.atan2(-pos.x, -pos.z) * 0.45;
        tiltRad = 0.52;
      } else if (dmx.cueMode === 'STROBE_DROP') {
        panRad = Math.sin(t * speed * 4.0 + idx) * 0.8;
        tiltRad = 0.5 + Math.cos(t * speed * 5.0 + idx) * 0.45;
      }

      if (this.selectedFixtureIndex === null || this.selectedFixtureIndex === idx || dmx.cueMode !== 'MANUAL') {
        mh.panGroup.rotation.y = panRad;
        mh.tiltGroup.rotation.x = tiltRad;
      }

      mh.coneMat.opacity = coneOpacity;
      mh.coneMat.visible = dimmerNorm > 0.01;
    });

    this.parWashRefs.forEach((pw, idx) => {
      const pulse = dmx.cueMode === 'BALLYHOO' ? 0.6 + 0.4 * Math.sin(t * speed * 3 + idx) : 1;
      pw.washConeMat.opacity = dimmerNorm * strobeGate * pulse * (0.06 + smokeNorm * 0.14);
      pw.washConeMat.visible = dimmerNorm > 0.01;
    });

    for (const sb of this.strobeRefs) {
      const isFlash = (dmx.cueMode === 'STROBE_DROP' || activeStrobeHz > 0) && strobeGate > 0.5;
      sb.bulbMat.color.setHex(isFlash ? 0xffffff : dimmerNorm > 0 ? 0xfde047 : 0x1e293b);
    }

    this.laserRefs.forEach((ls, idx) => {
      ls.fanGroup.rotation.z = Math.sin(t * speed * 2.0 + idx) * 0.45;
      ls.fanGroup.rotation.x = Math.cos(t * speed * 1.5 + idx) * 0.22;
      ls.rayMat.opacity = dimmerNorm * strobeGate * (0.25 + smokeNorm * 0.55);
      ls.rayMat.visible = dimmerNorm > 0.01;
    });

    if (dmx.beatSyncActive && beatEnergy > 0.2) {
      const sScale = 1 + beatEnergy * 0.045;
      for (const sub of this.subMeshRefs) sub.scale.set(sScale, sScale, sScale);
    }

    // 5. LED Backdrop Videotron Visuals
    if (cfg.ledBackdrop && this.ledWallCtx && this.ledWallTexture) {
      const cw = this.ledWallCanvas.width;
      const ch = this.ledWallCanvas.height;
      this.ledWallCtx.fillStyle = '#060a14';
      this.ledWallCtx.fillRect(0, 0, cw, ch);

      if (dmx.cueMode !== 'BLACKOUT') {
        const grad = this.ledWallCtx.createLinearGradient(0, 0, cw, ch);
        grad.addColorStop(0, dmx.primaryColor);
        grad.addColorStop(0.5, dmx.washColor);
        grad.addColorStop(1, dmx.laserColor);

        this.ledWallCtx.strokeStyle = grad;
        this.ledWallCtx.lineWidth = 3;
        for (let r = 1; r <= 4; r++) {
          const rad = ((t * 45 * speed + r * 35) % 160) + beatEnergy * 25;
          this.ledWallCtx.beginPath();
          this.ledWallCtx.arc(cw / 2, ch / 2, rad, 0, Math.PI * 2);
          this.ledWallCtx.stroke();
        }

        const numBars = 24;
        const bWidth = cw / numBars;
        this.ledWallCtx.fillStyle = grad;
        for (let b = 0; b < numBars; b++) {
          const bh = (0.2 + 0.65 * Math.abs(Math.sin(t * 3 * speed + b * 0.4))) * ch * 0.55 * dimmerNorm;
          this.ledWallCtx.fillRect(b * bWidth + 3, ch - bh, bWidth - 6, bh);
        }
      }
      this.ledWallTexture.needsUpdate = true;
    }

    // 6. Smoke & Spark Particles
    if (this.smokeParticles) {
      const activeSmokeMachines = cfg.counts.smoke_hazer || 0;
      this.smokeParticles.material.opacity = activeSmokeMachines > 0 ? smokeNorm * 0.24 : 0;
      if (this.graphicHigh && smokeNorm > 0.02) {
        const posAttr = this.smokeParticles.geometry.attributes.position;
        for (let i = 0; i < this.smokePositions.length; i++) {
          let py = posAttr.getY(i) + this.smokePositions[i].vy;
          const px = posAttr.getX(i) + this.smokePositions[i].vx;
          if (py > 8.5) py = 0.6;
          if (Math.abs(px) > 10) this.smokePositions[i].vx *= -1;
          posAttr.setXYZ(i, px, py, posAttr.getZ(i));
        }
        posAttr.needsUpdate = true;
      }
    }

    if (this.sparkParticles) {
      const sparkCount = cfg.counts.cold_sparkular || 0;
      const isSparking = dmx.sparkularActive && sparkCount > 0;
      this.sparkParticles.visible = isSparking;

      if (isSparking) {
        const W = cfg.ukuranPanggung.lebar;
        const D = cfg.ukuranPanggung.panjang;
        const H = cfg.ukuranPanggung.tinggi;
        const spanW = W - 2.0;
        const posAttr = this.sparkParticles.geometry.attributes.position;

        for (let i = 0; i < this.sparkData.length; i++) {
          const sd = this.sparkData[i];
          sd.life += 0.032;
          if (sd.life >= 1.0) {
            sd.life = 0;
            const unitIdx = i % sparkCount;
            const unitX = sparkCount <= 1 ? 0 : -spanW / 2 + (unitIdx / (sparkCount - 1)) * spanW;
            posAttr.setXYZ(i, unitX, H + 0.25, D / 2 - 0.35);
          } else {
            const nx = posAttr.getX(i) + sd.vx;
            const ny = posAttr.getY(i) + sd.vy * (1 - sd.life * 0.55);
            const nz = posAttr.getZ(i) + sd.vz;
            posAttr.setXYZ(i, nx, ny, nz);
          }
        }
        posAttr.needsUpdate = true;
      }
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this._onResize);
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('click', this._onClick);
    }
    this.clearAndDisposeGroup(this.stageGroup);
    this.clearAndDisposeGroup(this.fixturesGroup);
    this.clearAndDisposeGroup(this.fxGroup);
    if (this.ledWallTexture) this.ledWallTexture.dispose();
    if (this.controls) this.controls.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
