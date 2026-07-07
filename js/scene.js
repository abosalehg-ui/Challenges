// ============================================================
// THREE.JS DESERT SCENE — animated night background
// ============================================================
const Scene = (() => {
  let scene, camera, renderer, stars = [], dunes = [];
  let clock;
  let initialized = false;
  let themeColors = {
    night: { sky: [0x0a0520, 0x2d1b4e, 0xc4954a], ground: [0xc4954a, 0x8b6914], clear: 0x1a0a2e },
    day: { sky: [0x87CEEB, 0xFFE4B5, 0xF4E8C1], ground: [0xF4E8C1, 0xDEB887], clear: 0x87CEEB }
  };
  let currentTheme = 'night';
  let skyMesh, groundMesh;
  let reducedMotion = false;
  let animating = false;

  function init() {
    if (initialized || typeof THREE === 'undefined') return;
    const rmQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rmQuery) {
      reducedMotion = rmQuery.matches;
      const onChange = (e) => {
        reducedMotion = e.matches;
        if (reducedMotion) _renderFrame();
        else _startLoop();
      };
      if (rmQuery.addEventListener) rmQuery.addEventListener('change', onChange);
      else if (rmQuery.addListener) rmQuery.addListener(onChange);
    }
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 8, 25);
    camera.lookAt(0, 3, 0);

    renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('three-canvas'),
      antialias: true,
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(themeColors[currentTheme].clear);

    _buildSky();
    _buildStars();
    _buildMoon();
    _buildGround();
    _buildLights();
    _buildSandParticles();

    window.addEventListener('resize', _onResize);
    initialized = true;
    if (reducedMotion) _renderFrame();
    else _startLoop();
  }

  function _buildSky() {
    const skyGeo = new THREE.SphereGeometry(200, 32, 32);
    const colors = themeColors[currentTheme].sky;
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(colors[0]) },
        midColor: { value: new THREE.Color(colors[1]) },
        bottomColor: { value: new THREE.Color(colors[2]) }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 col;
          if (h > 0.0) col = mix(midColor, topColor, pow(h, 0.6));
          else col = mix(midColor, bottomColor, pow(-h, 0.4));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide
    });
    skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
  }

  function _buildStars() {
    if (currentTheme === 'day') return;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    const starSizes = [];
    for (let i = 0; i < 600; i++) {
      const theta = Math.random() * Math.PI * 0.7;
      const phi = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 40;
      starPositions.push(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.cos(theta) + 20,
        r * Math.sin(theta) * Math.sin(phi)
      );
      starSizes.push(0.5 + Math.random() * 2);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

    const starMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        attribute float size;
        uniform float time;
        varying float vAlpha;
        void main() {
          vAlpha = 0.5 + 0.5 * sin(time * 2.0 + position.x * 0.1);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = (1.0 - d * 2.0) * vAlpha;
          gl_FragColor = vec4(1.0, 0.95, 0.8, alpha);
        }
      `,
      transparent: true,
      depthWrite: false
    });
    const starField = new THREE.Points(starGeometry, starMat);
    starField.userData.isStar = true;
    scene.add(starField);
    stars.push(starField);
  }

  function _buildMoon() {
    const radius = currentTheme === 'day' ? 8 : 6;
    const moonColor = currentTheme === 'day' ? 0xFFD700 : 0xfff8dc;
    const moonGeo = new THREE.SphereGeometry(radius, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({ color: moonColor });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(-40, 60, -100);
    moon.userData.isMoon = true;
    scene.add(moon);

    const glowGeo = new THREE.SphereGeometry(radius + 2, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: moonColor,
      transparent: true,
      opacity: currentTheme === 'day' ? 0.25 : 0.15
    });
    const moonGlow = new THREE.Mesh(glowGeo, glowMat);
    moonGlow.position.copy(moon.position);
    moonGlow.userData.isMoon = true;
    scene.add(moonGlow);
  }

  function _buildGround() {
    const groundGeo = new THREE.PlaneGeometry(400, 200, 80, 40);
    const positions = groundGeo.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 1];
      positions[i + 2] =
        Math.sin(x * 0.03) * 3 +
        Math.sin(z * 0.05) * 2 +
        Math.sin(x * 0.08 + z * 0.06) * 1.5 +
        Math.random() * 0.3;
    }
    groundGeo.computeVertexNormals();

    const colors = themeColors[currentTheme].ground;
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        color1: { value: new THREE.Color(colors[0]) },
        color2: { value: new THREE.Color(colors[1]) },
        time: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vElevation;
        void main() {
          vUv = uv;
          vElevation = position.z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float time;
        varying vec2 vUv;
        varying float vElevation;
        void main() {
          float mixVal = vElevation * 0.15 + 0.5;
          mixVal += sin(vUv.x * 30.0 + time * 0.3) * 0.05;
          vec3 col = mix(color2, color1, clamp(mixVal, 0.0, 1.0));
          col += vec3(0.05, 0.03, 0.0) * (1.0 - vUv.y);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -2;
    scene.add(groundMesh);
    dunes.push(groundMesh);
  }

  function _buildLights() {
    scene.add(new THREE.AmbientLight(0x4a3a6a, 0.4));
    const dirLight = new THREE.DirectionalLight(0xfff0c0, 0.6);
    dirLight.position.set(-20, 30, -50);
    scene.add(dirLight);
  }

  function _buildSandParticles() {
    const sandGeo = new THREE.BufferGeometry();
    const sandPos = [];
    for (let i = 0; i < 200; i++) {
      sandPos.push(
        (Math.random() - 0.5) * 100,
        Math.random() * 20 + 1,
        (Math.random() - 0.5) * 60 - 10
      );
    }
    sandGeo.setAttribute('position', new THREE.Float32BufferAttribute(sandPos, 3));
    const sandMat = new THREE.PointsMaterial({
      color: 0xdeb887,
      size: 0.3,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });
    const sandParticles = new THREE.Points(sandGeo, sandMat);
    sandParticles.userData.isSand = true;
    scene.add(sandParticles);
    dunes.push(sandParticles);
  }

  function _onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (reducedMotion) _renderFrame();
  }

  function _renderFrame() {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function _startLoop() {
    if (animating) return;
    animating = true;
    _animate();
  }

  function _animate() {
    if (reducedMotion) {
      animating = false;
      _renderFrame();
      return;
    }
    requestAnimationFrame(_animate);
    if (!renderer || !scene || !camera || !clock) return;
    const t = clock.getElapsedTime();

    stars.forEach(s => {
      if (s.material.uniforms) s.material.uniforms.time.value = t;
    });

    dunes.forEach(d => {
      if (d.material.uniforms && d.material.uniforms.time) {
        d.material.uniforms.time.value = t;
      }
    });

    camera.position.x = Math.sin(t * 0.1) * 2;
    camera.position.y = 8 + Math.sin(t * 0.15) * 0.5;

    if (dunes[1]) {
      const pos = dunes[1].geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] += Math.sin(t + i) * 0.02;
        pos[i + 1] += Math.cos(t * 0.5 + i) * 0.005;
        if (pos[i] > 50) pos[i] = -50;
      }
      dunes[1].geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  function setTheme(theme) {
    if (!themeColors[theme] || theme === currentTheme || !initialized) {
      currentTheme = theme;
      return;
    }
    currentTheme = theme;

    while (scene.children.length > 0) scene.remove(scene.children[0]);
    stars = []; dunes = [];

    renderer.setClearColor(themeColors[currentTheme].clear);
    _buildSky();
    _buildStars();
    _buildMoon();
    _buildGround();
    _buildLights();
    _buildSandParticles();
    if (reducedMotion) _renderFrame();
  }

  return { init, setTheme };
})();
