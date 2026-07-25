// ============================================================
// GL — the sliver of a 3D engine this game actually needs
// ============================================================
// The desert background used THREE.js r128 (603KB, ~55% of the app payload)
// for: a perspective camera, four meshes and two point clouds, all painted by
// hand-written GLSL. Nothing else in the library was reachable — even the two
// lights were dead code, because every material was ShaderMaterial or the
// unlit MeshBasicMaterial. This module provides that sliver directly.
//
// Conventions match what the shaders were already written against: column-major
// mat4 in the same memory layout three used, a right-handed view space looking
// down -Z, and no colour management (three r128 defaulted to LinearEncoding, so
// hex colours reached the shader unconverted — keep it that way).

const GL = (() => {

  // ---- mat4 (column-major, same layout THREE.Matrix4 uploads) -------------
  const m4 = {
    identity: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),

    perspective(fovDeg, aspect, near, far) {
      const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
      const nf = 1 / (near - far);
      return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
      ]);
    },

    multiply(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                         a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },

    translation(x, y, z) {
      const m = m4.identity();
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    },

    rotationX(rad) {
      const c = Math.cos(rad), s = Math.sin(rad);
      const m = m4.identity();
      m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
      return m;
    },

    // Camera basis for an eye looking at `target`. Returns the *view* matrix
    // (inverse of the camera's world transform) for the given eye position,
    // reusing a fixed orientation — the original called lookAt once at startup
    // and then only slid the camera, so the rotation must not track the eye.
    viewFromBasis(basis, eye) {
      const [xa, ya, za] = basis;
      return new Float32Array([
        xa[0], ya[0], za[0], 0,
        xa[1], ya[1], za[1], 0,
        xa[2], ya[2], za[2], 0,
        -(xa[0] * eye[0] + xa[1] * eye[1] + xa[2] * eye[2]),
        -(ya[0] * eye[0] + ya[1] * eye[1] + ya[2] * eye[2]),
        -(za[0] * eye[0] + za[1] * eye[1] + za[2] * eye[2]),
        1
      ]);
    },

    // Orthonormal basis of a camera at `eye` looking at `target`, matching
    // THREE.Matrix4.lookAt (z points from target back toward the eye).
    lookAtBasis(eye, target, up) {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const norm = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
      const za = norm(sub(eye, target));
      const xa = norm(cross(up, za));
      const ya = cross(za, xa);
      return [xa, ya, za];
    }
  };

  // ---- shader plumbing ----------------------------------------------------
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile failed: ' + log);
    }
    return sh;
  }

  // `vert`/`frag` are authored in GLSL ES 1.00 without a precision qualifier,
  // the way three's shader chunks were — it is prepended here instead.
  function program(gl, vert, frag) {
    const p = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, 'precision highp float;\n' + vert);
    const fs = compile(gl, gl.FRAGMENT_SHADER, 'precision highp float;\n' + frag);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error('program link failed: ' + log);
    }
    // The shader objects are owned by the program once linked.
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      uniforms[name] = gl.getUniformLocation(p, name);
    }
    const attribs = {};
    const a = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < a; i++) {
      const name = gl.getActiveAttrib(p, i).name;
      attribs[name] = gl.getAttribLocation(p, name);
    }
    return { handle: p, uniforms, attribs };
  }

  // ---- geometry -----------------------------------------------------------
  // Vertex/index layouts identical to the THREE.js generators they replace, so
  // the existing shaders and the displacement loop keep working unchanged.

  // THREE.SphereGeometry(radius, widthSegments, heightSegments)
  function sphere(radius, widthSegments, heightSegments) {
    const positions = [];
    const indices = [];
    for (let iy = 0; iy <= heightSegments; iy++) {
      const v = iy / heightSegments;
      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        positions.push(
          -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI),
          radius * Math.cos(v * Math.PI),
          radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI)
        );
      }
    }
    const rowLen = widthSegments + 1;
    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = iy * rowLen + ix + 1;
        const b = iy * rowLen + ix;
        const c = (iy + 1) * rowLen + ix;
        const d = (iy + 1) * rowLen + ix + 1;
        if (iy !== 0) indices.push(a, b, d);
        if (iy !== heightSegments - 1) indices.push(b, c, d);
      }
    }
    return { position: new Float32Array(positions), index: new Uint16Array(indices) };
  }

  // THREE.PlaneGeometry(width, height, widthSegments, heightSegments)
  function plane(width, height, widthSegments, heightSegments) {
    const halfW = width / 2, halfH = height / 2;
    const segW = width / widthSegments, segH = height / heightSegments;
    const positions = [], uvs = [], indices = [];
    for (let iy = 0; iy <= heightSegments; iy++) {
      const y = iy * segH - halfH;
      for (let ix = 0; ix <= widthSegments; ix++) {
        const x = ix * segW - halfW;
        positions.push(x, -y, 0);
        uvs.push(ix / widthSegments, 1 - iy / heightSegments);
      }
    }
    const rowLen = widthSegments + 1;
    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = ix + rowLen * iy;
        const b = ix + rowLen * (iy + 1);
        const c = (ix + 1) + rowLen * (iy + 1);
        const d = (ix + 1) + rowLen * iy;
        indices.push(a, b, d, b, c, d);
      }
    }
    return {
      position: new Float32Array(positions),
      uv: new Float32Array(uvs),
      index: new Uint16Array(indices)
    };
  }

  // 0xRRGGBB → [r, g, b] in 0..1, with no colour-space conversion (matching
  // THREE.Color in r128, whose output the original palette was tuned against).
  function color(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  }

  return { m4, program, sphere, plane, color };
})();

if (typeof module !== 'undefined') module.exports = { GL };
