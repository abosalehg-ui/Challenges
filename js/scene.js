// ============================================================
// DESERT SCENE — animated background, drawn on raw WebGL (see js/gl.js)
// ============================================================
// The GLSL below is the same shader source the THREE.js version used; only the
// engine underneath changed. Two things the old version did are deliberately
// gone: the AmbientLight/DirectionalLight pair (no material in this scene was
// ever lit, so they contributed nothing), and computeVertexNormals on the
// ground (the ground shader reads uv and position.z only).
const Scene = (() => {
  const CAMERA = { fov: 60, near: 0.1, far: 1000, eye: [0, 8, 25], target: [0, 3, 0] };
  const STAR_COUNT = 600;
  const SAND_COUNT = 200;
  // Sand drifts across the dune field and wraps. Units per second — the old
  // code added a fixed step per *frame*, so the effect ran ~2.4x faster on a
  // 144Hz screen and never travelled far enough to reach its own wrap point.
  const SAND_DRIFT = 1.6;
  const SAND_SPAN = 100;
  // Frame budget while the player is not on the game screen. The scene is
  // decorative there, and a full-rate shaded sky sphere plus 3200-quad ground
  // is a real battery and thermal cost on mid-range phones.
  const IDLE_FPS = 24;

  const THEMES = {
    night: {
      sky: [0x0a0520, 0x2d1b4e, 0xc4954a],
      ground: [0xc4954a, 0x8b6914],
      clear: 0x1a0a2e,
      moon: { radius: 6, color: 0xfff8dc, glow: 0.15 },
      stars: true
    },
    day: {
      sky: [0x87CEEB, 0xFFE4B5, 0xF4E8C1],
      ground: [0xF4E8C1, 0xDEB887],
      clear: 0x87CEEB,
      moon: { radius: 8, color: 0xFFD700, glow: 0.25 },
      stars: false
    }
  };

  // ---- shaders (verbatim from the THREE.js materials they replace) --------
  // `modelMatrix` / `modelViewMatrix` / `projectionMatrix` / `position` / `uv`
  // used to be injected by three; they are ordinary uniforms and attributes
  // here, declared explicitly but otherwise untouched.
  const COMMON_VERT_DECL = `
    attribute vec3 position;
    uniform mat4 modelMatrix;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
  `;

  const SKY_VERT = COMMON_VERT_DECL + `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const SKY_FRAG = `
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
  `;

  const STAR_VERT = COMMON_VERT_DECL + `
    attribute float size;
    uniform float time;
    varying float vAlpha;
    void main() {
      vAlpha = 0.5 + 0.5 * sin(time * 2.0 + position.x * 0.1);
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (200.0 / -mvPos.z);
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  const STAR_FRAG = `
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float alpha = (1.0 - d * 2.0) * vAlpha;
      gl_FragColor = vec4(1.0, 0.95, 0.8, alpha);
    }
  `;

  const GROUND_VERT = COMMON_VERT_DECL + `
    attribute vec2 uv;
    varying vec2 vUv;
    varying float vElevation;
    void main() {
      vUv = uv;
      vElevation = position.z;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const GROUND_FRAG = `
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
  `;

  // Stand-in for THREE.MeshBasicMaterial (unlit, flat colour + opacity).
  const BASIC_VERT = COMMON_VERT_DECL + `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const BASIC_FRAG = `
    uniform vec3 color;
    uniform float opacity;
    void main() { gl_FragColor = vec4(color, opacity); }
  `;

  // Stand-in for THREE.PointsMaterial with sizeAttenuation, whose built-in
  // shader scaled point size by (viewportHeight * 0.5 / -z).
  const SAND_VERT = COMMON_VERT_DECL + `
    uniform float size;
    uniform float scale;
    void main() {
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (scale / -mvPos.z);
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  const SAND_FRAG = `
    uniform vec3 color;
    uniform float opacity;
    void main() { gl_FragColor = vec4(color, opacity); }
  `;

  let gl = null, canvas = null;
  let programs = null;
  let meshes = {};
  let projection, viewBasis, cameraEye;
  let currentTheme = 'night';
  let initialized = false;
  let rafId = 0;
  let startTime = 0;
  let reducedMotion = false;
  let userReducedMotion = false;
  let active = false;         // true while the game screen is showing
  let hidden = false;         // document.hidden
  let lastDraw = 0;
  let sandBase = null, sandPos = null;

  const motionOff = () => reducedMotion || userReducedMotion;

  // ---- buffers ------------------------------------------------------------
  function makeBuffer(data, target) {
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, target === gl.ELEMENT_ARRAY_BUFFER ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
    return buf;
  }

  function disposeMeshes() {
    Object.values(meshes).forEach(m => {
      if (!m) return;
      Object.values(m.buffers || {}).forEach(b => gl.deleteBuffer(b));
    });
    meshes = {};
  }

  // ---- scene construction -------------------------------------------------
  function buildScene() {
    const theme = THEMES[currentTheme];
    disposeMeshes();

    // Sky — inverted sphere, so the front faces are culled instead of the back
    const skyGeo = GL.sphere(200, 32, 32);
    meshes.sky = {
      buffers: {
        position: makeBuffer(skyGeo.position, gl.ARRAY_BUFFER),
        index: makeBuffer(skyGeo.index, gl.ELEMENT_ARRAY_BUFFER)
      },
      count: skyGeo.index.length,
      model: GL.m4.identity(),
      colors: theme.sky.map(GL.color)
    };

    // Stars — night only, exactly as before
    if (theme.stars) {
      const pos = new Float32Array(STAR_COUNT * 3);
      const sizes = new Float32Array(STAR_COUNT);
      for (let i = 0; i < STAR_COUNT; i++) {
        const t = Math.random() * Math.PI * 0.7;
        const p = Math.random() * Math.PI * 2;
        const r = 150 + Math.random() * 40;
        pos[i * 3] = r * Math.sin(t) * Math.cos(p);
        pos[i * 3 + 1] = r * Math.cos(t) + 20;
        pos[i * 3 + 2] = r * Math.sin(t) * Math.sin(p);
        sizes[i] = 0.5 + Math.random() * 2;
      }
      meshes.stars = {
        buffers: {
          position: makeBuffer(pos, gl.ARRAY_BUFFER),
          size: makeBuffer(sizes, gl.ARRAY_BUFFER)
        },
        count: STAR_COUNT,
        model: GL.m4.identity()
      };
    }

    // Moon + its glow shell
    const moonGeo = GL.sphere(theme.moon.radius, 32, 32);
    const glowGeo = GL.sphere(theme.moon.radius + 2, 32, 32);
    const moonModel = GL.m4.translation(-40, 60, -100);
    meshes.moon = {
      buffers: {
        position: makeBuffer(moonGeo.position, gl.ARRAY_BUFFER),
        index: makeBuffer(moonGeo.index, gl.ELEMENT_ARRAY_BUFFER)
      },
      count: moonGeo.index.length,
      model: moonModel,
      color: GL.color(theme.moon.color),
      opacity: 1
    };
    meshes.moonGlow = {
      buffers: {
        position: makeBuffer(glowGeo.position, gl.ARRAY_BUFFER),
        index: makeBuffer(glowGeo.index, gl.ELEMENT_ARRAY_BUFFER)
      },
      count: glowGeo.index.length,
      model: moonModel,
      color: GL.color(theme.moon.color),
      opacity: theme.moon.glow
    };

    // Ground — displaced dune field, rotated flat and dropped below the camera
    const groundGeo = GL.plane(400, 200, 80, 40);
    const p = groundGeo.position;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const z = p[i + 1];
      p[i + 2] =
        Math.sin(x * 0.03) * 3 +
        Math.sin(z * 0.05) * 2 +
        Math.sin(x * 0.08 + z * 0.06) * 1.5 +
        Math.random() * 0.3;
    }
    meshes.ground = {
      buffers: {
        position: makeBuffer(groundGeo.position, gl.ARRAY_BUFFER),
        uv: makeBuffer(groundGeo.uv, gl.ARRAY_BUFFER),
        index: makeBuffer(groundGeo.index, gl.ELEMENT_ARRAY_BUFFER)
      },
      count: groundGeo.index.length,
      model: GL.m4.multiply(GL.m4.translation(0, -2, 0), GL.m4.rotationX(-Math.PI / 2)),
      colors: theme.ground.map(GL.color)
    };

    // Blown sand. `sandBase` is the resting layout; every frame recomputes the
    // live position from elapsed time, so motion is frame-rate independent.
    sandBase = new Float32Array(SAND_COUNT * 3);
    sandPos = new Float32Array(SAND_COUNT * 3);
    for (let i = 0; i < SAND_COUNT; i++) {
      sandBase[i * 3] = (Math.random() - 0.5) * SAND_SPAN;
      sandBase[i * 3 + 1] = Math.random() * 20 + 1;
      sandBase[i * 3 + 2] = (Math.random() - 0.5) * 60 - 10;
    }
    sandPos.set(sandBase);
    meshes.sand = {
      buffers: { position: makeBuffer(sandPos, gl.ARRAY_BUFFER) },
      count: SAND_COUNT,
      model: GL.m4.identity(),
      color: GL.color(0xdeb887),
      opacity: 0.4,
      size: 0.3
    };

    const c = GL.color(theme.clear);
    gl.clearColor(c[0], c[1], c[2], 1);
  }

  function updateSand(t) {
    for (let i = 0; i < SAND_COUNT; i++) {
      const j = i * 3;
      // Wrap into the field width so grains re-enter on the far side.
      let x = sandBase[j] + t * SAND_DRIFT;
      x = ((x + SAND_SPAN / 2) % SAND_SPAN + SAND_SPAN) % SAND_SPAN - SAND_SPAN / 2;
      sandPos[j] = x;
      sandPos[j + 1] = sandBase[j + 1] + Math.sin(t * 0.5 + i) * 0.4;
      sandPos[j + 2] = sandBase[j + 2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes.sand.buffers.position);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sandPos);
  }

  // ---- draw ---------------------------------------------------------------
  function bindAttrib(prog, name, buffer, size) {
    const loc = prog.attribs[name];
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  function setCommon(prog, model, view) {
    gl.uniformMatrix4fv(prog.uniforms.projectionMatrix, false, projection);
    gl.uniformMatrix4fv(prog.uniforms.modelMatrix, false, model);
    gl.uniformMatrix4fv(prog.uniforms.modelViewMatrix, false, GL.m4.multiply(view, model));
  }

  function render(t) {
    if (!gl || !meshes.sky) return;
    const view = GL.m4.viewFromBasis(viewBasis, cameraEye);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- opaque pass: depth write on ---
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Sky: THREE.BackSide meant "cull the front faces"
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    let prog = programs.sky;
    gl.useProgram(prog.handle);
    setCommon(prog, meshes.sky.model, view);
    gl.uniform3fv(prog.uniforms.topColor, meshes.sky.colors[0]);
    gl.uniform3fv(prog.uniforms.midColor, meshes.sky.colors[1]);
    gl.uniform3fv(prog.uniforms.bottomColor, meshes.sky.colors[2]);
    bindAttrib(prog, 'position', meshes.sky.buffers.position, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.sky.buffers.index);
    gl.drawElements(gl.TRIANGLES, meshes.sky.count, gl.UNSIGNED_SHORT, 0);

    gl.cullFace(gl.BACK);

    // Ground
    prog = programs.ground;
    gl.useProgram(prog.handle);
    setCommon(prog, meshes.ground.model, view);
    gl.uniform3fv(prog.uniforms.color1, meshes.ground.colors[0]);
    gl.uniform3fv(prog.uniforms.color2, meshes.ground.colors[1]);
    gl.uniform1f(prog.uniforms.time, t);
    bindAttrib(prog, 'position', meshes.ground.buffers.position, 3);
    bindAttrib(prog, 'uv', meshes.ground.buffers.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.ground.buffers.index);
    gl.drawElements(gl.TRIANGLES, meshes.ground.count, gl.UNSIGNED_SHORT, 0);

    // Moon
    prog = programs.basic;
    gl.useProgram(prog.handle);
    setCommon(prog, meshes.moon.model, view);
    gl.uniform3fv(prog.uniforms.color, meshes.moon.color);
    gl.uniform1f(prog.uniforms.opacity, 1);
    bindAttrib(prog, 'position', meshes.moon.buffers.position, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.moon.buffers.index);
    gl.drawElements(gl.TRIANGLES, meshes.moon.count, gl.UNSIGNED_SHORT, 0);

    // --- transparent pass: blended, farthest first, no depth write ---
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (meshes.stars) {
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      prog = programs.star;
      gl.useProgram(prog.handle);
      setCommon(prog, meshes.stars.model, view);
      gl.uniform1f(prog.uniforms.time, t);
      bindAttrib(prog, 'position', meshes.stars.buffers.position, 3);
      bindAttrib(prog, 'size', meshes.stars.buffers.size, 1);
      gl.drawArrays(gl.POINTS, 0, meshes.stars.count);
      gl.enable(gl.CULL_FACE);
    }

    // The glow shell kept depth writes on in the original material
    gl.depthMask(true);
    prog = programs.basic;
    gl.useProgram(prog.handle);
    setCommon(prog, meshes.moonGlow.model, view);
    gl.uniform3fv(prog.uniforms.color, meshes.moonGlow.color);
    gl.uniform1f(prog.uniforms.opacity, meshes.moonGlow.opacity);
    bindAttrib(prog, 'position', meshes.moonGlow.buffers.position, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.moonGlow.buffers.index);
    gl.drawElements(gl.TRIANGLES, meshes.moonGlow.count, gl.UNSIGNED_SHORT, 0);

    // Sand
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    prog = programs.sand;
    gl.useProgram(prog.handle);
    setCommon(prog, meshes.sand.model, view);
    gl.uniform3fv(prog.uniforms.color, meshes.sand.color);
    gl.uniform1f(prog.uniforms.opacity, meshes.sand.opacity);
    gl.uniform1f(prog.uniforms.size, meshes.sand.size);
    gl.uniform1f(prog.uniforms.scale, canvas.clientHeight * 0.5);
    bindAttrib(prog, 'position', meshes.sand.buffers.position, 3);
    gl.drawArrays(gl.POINTS, 0, meshes.sand.count);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  // ---- loop ---------------------------------------------------------------
  function elapsed() { return (performance.now() - startTime) / 1000; }

  function renderStill() {
    cameraEye = CAMERA.eye.slice();
    render(0);
  }

  function frame(now) {
    rafId = 0;
    if (motionOff() || hidden) return;

    // Off the game screen the background is decoration; drawing it 60 times a
    // second is a battery cost with no gameplay benefit.
    const budget = active ? 0 : 1000 / IDLE_FPS;
    if (now - lastDraw < budget) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;

    const t = elapsed();
    cameraEye = [
      Math.sin(t * 0.1) * 2,
      8 + Math.sin(t * 0.15) * 0.5,
      CAMERA.eye[2]
    ];
    // The sand buffer only needs re-uploading when someone is looking at it
    // closely; idle frames keep the last layout.
    if (active) updateSand(t);
    render(t);
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId || motionOff() || hidden || !initialized) return;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function resize() {
    if (!gl || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    projection = GL.m4.perspective(CAMERA.fov, w / h, CAMERA.near, CAMERA.far);
    if (motionOff()) renderStill();
  }

  // ---- public -------------------------------------------------------------
  function init() {
    if (initialized) return;
    canvas = document.getElementById('three-canvas');
    if (!canvas) return;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: true }) ||
           canvas.getContext('webgl', { alpha: false, antialias: true });
    } catch (e) { gl = null; }
    // No WebGL (old device, blocked context) is survivable: the CSS background
    // colour shows through and the game plays exactly the same.
    if (!gl) return;

    try {
      programs = {
        sky: GL.program(gl, SKY_VERT, SKY_FRAG),
        star: GL.program(gl, STAR_VERT, STAR_FRAG),
        ground: GL.program(gl, GROUND_VERT, GROUND_FRAG),
        basic: GL.program(gl, BASIC_VERT, BASIC_FRAG),
        sand: GL.program(gl, SAND_VERT, SAND_FRAG)
      };
    } catch (e) {
      console.warn('Background scene unavailable:', e.message);
      gl = null;
      return;
    }

    const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rm) {
      reducedMotion = rm.matches;
      const onChange = (e) => { reducedMotion = e.matches; applyMotion(); };
      if (rm.addEventListener) rm.addEventListener('change', onChange);
      else if (rm.addListener) rm.addListener(onChange);
    }

    viewBasis = GL.m4.lookAtBasis(CAMERA.eye, CAMERA.target, [0, 1, 0]);
    cameraEye = CAMERA.eye.slice();
    startTime = performance.now();

    buildScene();
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      if (hidden) stopLoop(); else startLoop();
    });

    initialized = true;
    if (motionOff()) renderStill(); else startLoop();
  }

  function applyMotion() {
    if (!initialized) return;
    if (motionOff()) { stopLoop(); renderStill(); }
    else startLoop();
  }

  // Called by the settings screen so the in-app toggle works even when the OS
  // preference is unset.
  function setReducedMotion(on) {
    userReducedMotion = !!on;
    applyMotion();
  }

  // Called on every screen change; only the game screen gets the full frame rate.
  function setActive(on) {
    active = !!on;
  }

  function setTheme(theme) {
    if (!THEMES[theme] || theme === currentTheme) { currentTheme = theme; return; }
    currentTheme = theme;
    if (!initialized || !gl) return;
    buildScene();
    if (motionOff()) renderStill();
  }

  return { init, setTheme, setReducedMotion, setActive };
})();
