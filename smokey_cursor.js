"use strict";

let canvas = document.getElementById("smoke-cursor-canvas");
if (!canvas) {
  canvas = document.createElement("canvas");
  canvas.id = "smoke-cursor-canvas";
  canvas.setAttribute("aria-hidden", "true");
  (document.getElementById("final-screen") || document.body).prepend(canvas);
}

canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

let config = {
  TEXTURE_DOWNSAMPLE: 1,
  DENSITY_DISSIPATION: 0.972,
  VELOCITY_DISSIPATION: 0.985,
  PRESSURE_DISSIPATION: 0.8,
  PRESSURE_ITERATIONS: 14,
  CURL: 31,
  SPLAT_RADIUS: 0.00082
};

let pointers = [];
let splatStack = [];

let _getWebGLContext = getWebGLContext(canvas);
let gl = _getWebGLContext.gl;
let ext = _getWebGLContext.ext;
let support_linear_float = _getWebGLContext.support_linear_float;

function getWebGLContext(canvas) {
  let params = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false
  };

  let gl = canvas.getContext("webgl2", params);

  let isWebGL2 = !!gl;

  if (!isWebGL2)
    gl =
      canvas.getContext("webgl", params) ||
      canvas.getContext("experimental-webgl", params);

  let halfFloat = gl.getExtension("OES_texture_half_float");
  let support_linear_float = gl.getExtension("OES_texture_half_float_linear");

  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    support_linear_float = gl.getExtension("OES_texture_float_linear");
  }

  gl.clearColor(0.0, 0.0, 0.0, 0.0);

  let internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;
  let internalFormatRG = isWebGL2 ? gl.RG16F : gl.RGBA;
  let formatRG = isWebGL2 ? gl.RG : gl.RGBA;
  let texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;

  return {
    gl: gl,
    ext: {
      internalFormat: internalFormat,
      internalFormatRG: internalFormatRG,
      formatRG: formatRG,
      texType: texType
    },
    support_linear_float: support_linear_float
  };
}

function pointerPrototype() {
  this.id = -1;
  this.x = 0;
  this.y = 0;
  this.dx = 0;
  this.dy = 0;
  this.down = false;
  this.moved = false;
  this.initialized = false;
  this.color = [7.6, 1.45, 0.12];
}

pointers.push(new pointerPrototype());

let GLProgram = (function () {
  function GLProgram(vertexShader, fragmentShader) {
    if (!(this instanceof GLProgram))
      throw new TypeError("Cannot call a class as a function");

    this.uniforms = {};
    this.program = gl.createProgram();

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw gl.getProgramInfoLog(this.program);

    let uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);

    for (let i = 0; i < uniformCount; i++) {
      let uniformName = gl.getActiveUniform(this.program, i).name;

      this.uniforms[uniformName] = gl.getUniformLocation(
        this.program,
        uniformName
      );
    }
  }

  GLProgram.prototype.bind = function bind() {
    gl.useProgram(this.program);
  };

  return GLProgram;
})();

function compileShader(type, source) {
  let shader = gl.createShader(type);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw gl.getShaderInfoLog(shader);

  return shader;
}

let baseVertexShader = compileShader(
  gl.VERTEX_SHADER,
  "precision highp float; precision mediump sampler2D; attribute vec2 aPosition; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform vec2 texelSize; void main () {     vUv = aPosition * 0.5 + 0.5;     vL = vUv - vec2(texelSize.x, 0.0);     vR = vUv + vec2(texelSize.x, 0.0);     vT = vUv + vec2(0.0, texelSize.y);     vB = vUv - vec2(0.0, texelSize.y);     gl_Position = vec4(aPosition, 0.0, 1.0); }"
);
let clearShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; uniform float value; void main () {     gl_FragColor = value * texture2D(uTexture, vUv); }"
);
let displayShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; void main () {     vec3 color = texture2D(uTexture, vUv).rgb;     float glow = max(max(color.r, color.g), color.b);     float alpha = smoothstep(0.01, 0.34, glow);     gl_FragColor = vec4(color, alpha); }"
);
let splatShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main () {     vec2 p = vUv - point.xy;     p.x *= aspectRatio;     vec3 splat = exp(-dot(p, p) / radius) * color;     vec3 base = texture2D(uTarget, vUv).xyz;     gl_FragColor = vec4(base + splat, 1.0); }"
);
let advectionManualFilteringShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; vec4 bilerp (in sampler2D sam, in vec2 p) {     vec4 st;     st.xy = floor(p - 0.5) + 0.5;     st.zw = st.xy + 1.0;     vec4 uv = st * texelSize.xyxy;     vec4 a = texture2D(sam, uv.xy);     vec4 b = texture2D(sam, uv.zy);     vec4 c = texture2D(sam, uv.xw);     vec4 d = texture2D(sam, uv.zw);     vec2 f = p - st.xy;     return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); } void main () {     vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;     gl_FragColor = dissipation * bilerp(uSource, coord);     gl_FragColor.a = 1.0; }"
);
let advectionShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; void main () {     vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;     gl_FragColor = dissipation * texture2D(uSource, coord); }"
);
let divergenceShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; vec2 sampleVelocity (in vec2 uv) {     vec2 multiplier = vec2(1.0, 1.0);     if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }     if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }     if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }     if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }     return multiplier * texture2D(uVelocity, uv).xy; } void main () {     float L = sampleVelocity(vL).x;     float R = sampleVelocity(vR).x;     float T = sampleVelocity(vT).y;     float B = sampleVelocity(vB).y;     float div = 0.5 * (R - L + T - B);     gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }"
);
let curlShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; void main () {     float L = texture2D(uVelocity, vL).y;     float R = texture2D(uVelocity, vR).y;     float T = texture2D(uVelocity, vT).x;     float B = texture2D(uVelocity, vB).x;     float vorticity = R - L - T + B;     gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0); }"
);
let vorticityShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt; void main () {     float L = texture2D(uCurl, vL).y;     float R = texture2D(uCurl, vR).y;     float T = texture2D(uCurl, vT).x;     float B = texture2D(uCurl, vB).x;     float C = texture2D(uCurl, vUv).x;     vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));     force *= 1.0 / length(force + 0.00001) * curl * C;     vec2 vel = texture2D(uVelocity, vUv).xy;     gl_FragColor = vec4(vel + force * dt, 0.0, 1.0); }"
);
let pressureShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     float C = texture2D(uPressure, vUv).x;     float divergence = texture2D(uDivergence, vUv).x;     float pressure = (L + R + B + T - divergence) * 0.25;     gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0); }"
);
let gradientSubtractShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     vec2 velocity = texture2D(uVelocity, vUv).xy;     velocity.xy -= vec2(R - L, T - B);     gl_FragColor = vec4(velocity, 0.0, 1.0); }"
);

let textureWidth = void 0;
let textureHeight = void 0;
let density = void 0;
let velocity = void 0;
let divergence = void 0;
let curl = void 0;
let pressure = void 0;

initFramebuffers();

let clearProgram = new GLProgram(baseVertexShader, clearShader);
let displayProgram = new GLProgram(baseVertexShader, displayShader);
let splatProgram = new GLProgram(baseVertexShader, splatShader);
let advectionProgram = new GLProgram(
  baseVertexShader,
  support_linear_float ? advectionShader : advectionManualFilteringShader
);
let divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
let curlProgram = new GLProgram(baseVertexShader, curlShader);
let vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
let pressureProgram = new GLProgram(baseVertexShader, pressureShader);
let gradienSubtractProgram = new GLProgram(
  baseVertexShader,
  gradientSubtractShader
);

function initFramebuffers() {
  textureWidth = gl.drawingBufferWidth >> config.TEXTURE_DOWNSAMPLE;
  textureHeight = gl.drawingBufferHeight >> config.TEXTURE_DOWNSAMPLE;

  let iFormat = ext.internalFormat;
  let iFormatRG = ext.internalFormatRG;
  let formatRG = ext.formatRG;
  let texType = ext.texType;

  density = createDoubleFBO(
    0,
    textureWidth,
    textureHeight,
    iFormat,
    gl.RGBA,
    texType,
    support_linear_float ? gl.LINEAR : gl.NEAREST
  );
  velocity = createDoubleFBO(
    2,
    textureWidth,
    textureHeight,
    iFormatRG,
    formatRG,
    texType,
    support_linear_float ? gl.LINEAR : gl.NEAREST
  );
  divergence = createFBO(
    4,
    textureWidth,
    textureHeight,
    iFormatRG,
    formatRG,
    texType,
    gl.NEAREST
  );
  curl = createFBO(
    5,
    textureWidth,
    textureHeight,
    iFormatRG,
    formatRG,
    texType,
    gl.NEAREST
  );
  pressure = createDoubleFBO(
    6,
    textureWidth,
    textureHeight,
    iFormatRG,
    formatRG,
    texType,
    gl.NEAREST
  );
}

function createFBO(texId, w, h, internalFormat, format, type, param) {
  gl.activeTexture(gl.TEXTURE0 + texId);

  let texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  let fbo = gl.createFramebuffer();

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return [texture, fbo, texId];
}

function createDoubleFBO(texId, w, h, internalFormat, format, type, param) {
  let fbo1 = createFBO(texId, w, h, internalFormat, format, type, param);
  let fbo2 = createFBO(texId + 1, w, h, internalFormat, format, type, param);

  return {
    get first() {
      return fbo1;
    },
    get second() {
      return fbo2;
    },
    swap: function swap() {
      let temp = fbo1;

      fbo1 = fbo2;
      fbo2 = temp;
    }
  };
}

let blit = (function () {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
    gl.STATIC_DRAW
  );
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW
  );
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  return function (destination) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
})();

let lastTime = Date.now();

update();

function update() {
  resizeCanvas();

  let dt = Math.min((Date.now() - lastTime) / 1000, 0.016);
  lastTime = Date.now();

  gl.viewport(0, 0, textureWidth, textureHeight);

  if (splatStack.length > 0) {
    for (let m = 0; m < splatStack.pop(); m++) {
      let color = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
      let x = canvas.width * Math.random();
      let y = canvas.height * Math.random();
      let dx = 1000 * (Math.random() - 0.5);
      let dy = 1000 * (Math.random() - 0.5);

      splat(x, y, dx, dy, color);
    }
  }

  advectionProgram.bind();
  gl.uniform2f(
    advectionProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, velocity.first[2]);
  gl.uniform1f(advectionProgram.uniforms.dt, dt);
  gl.uniform1f(
    advectionProgram.uniforms.dissipation,
    config.VELOCITY_DISSIPATION
  );
  blit(velocity.second[1]);
  velocity.swap();

  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, density.first[2]);
  gl.uniform1f(
    advectionProgram.uniforms.dissipation,
    config.DENSITY_DISSIPATION
  );
  blit(density.second[1]);
  density.swap();

  for (let i = 0, len = pointers.length; i < len; i++) {
    let pointer = pointers[i];

    if (pointer.moved) {
      splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
      pointer.moved = false;
    }
  }

  curlProgram.bind();
  gl.uniform2f(
    curlProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.first[2]);
  blit(curl[1]);

  vorticityProgram.bind();
  gl.uniform2f(
    vorticityProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(vorticityProgram.uniforms.uCurl, curl[2]);
  gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
  gl.uniform1f(vorticityProgram.uniforms.dt, dt);
  blit(velocity.second[1]);
  velocity.swap();

  divergenceProgram.bind();
  gl.uniform2f(
    divergenceProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.first[2]);
  blit(divergence[1]);

  clearProgram.bind();

  let pressureTexId = pressure.first[2];

  gl.activeTexture(gl.TEXTURE0 + pressureTexId);
  gl.bindTexture(gl.TEXTURE_2D, pressure.first[0]);
  gl.uniform1i(clearProgram.uniforms.uTexture, pressureTexId);
  gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE_DISSIPATION);
  blit(pressure.second[1]);
  pressure.swap();

  pressureProgram.bind();
  gl.uniform2f(
    pressureProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence[2]);
  pressureTexId = pressure.first[2];
  gl.activeTexture(gl.TEXTURE0 + pressureTexId);

  for (let _i = 0; _i < config.PRESSURE_ITERATIONS; _i++) {
    gl.bindTexture(gl.TEXTURE_2D, pressure.first[0]);
    gl.uniform1i(pressureProgram.uniforms.uPressure, pressureTexId);
    blit(pressure.second[1]);
    pressure.swap();
  }

  gradienSubtractProgram.bind();
  gl.uniform2f(
    gradienSubtractProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.first[2]);
  gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.first[2]);
  blit(velocity.second[1]);
  velocity.swap();

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  displayProgram.bind();
  gl.uniform1i(displayProgram.uniforms.uTexture, density.first[2]);
  blit(null);

  requestAnimationFrame(update);
}

function splat(x, y, dx, dy, color) {
  splatProgram.bind();
  gl.uniform1i(splatProgram.uniforms.uTarget, velocity.first[2]);
  gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
  gl.uniform2f(
    splatProgram.uniforms.point,
    x / canvas.width,
    1.0 - y / canvas.height
  );
  gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
  gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS);
  blit(velocity.second[1]);
  velocity.swap();

  gl.uniform1i(splatProgram.uniforms.uTarget, density.first[2]);
  gl.uniform3f(
    splatProgram.uniforms.color,
    color[0] * 0.3,
    color[1] * 0.3,
    color[2] * 0.3
  );
  blit(density.second[1]);
  density.swap();
}

function resizeCanvas() {
  (canvas.width !== canvas.clientWidth ||
    canvas.height !== canvas.clientHeight) &&
    ((canvas.width = canvas.clientWidth),
    (canvas.height = canvas.clientHeight),
    initFramebuffers());
}

let colorArr = [7.6, 1.45, 0.12];

function movePointer(pointer, x, y) {
  if (!pointer.initialized) {
    pointer.x = x;
    pointer.y = y;
    pointer.initialized = true;
    return;
  }

  let dx = x - pointer.x;
  let dy = y - pointer.y;
  let speed = Math.min(Math.hypot(dx, dy), 80);
  let force = 7.5 + speed * 0.05;

  pointer.down = true;
  pointer.color = colorArr;
  pointer.moved = true;
  pointer.dx = dx * force;
  pointer.dy = dy * force;
  pointer.x = x;
  pointer.y = y;
}

window.addEventListener(
  "mousemove",
  function (e) {
    movePointer(pointers[0], e.clientX, e.clientY);
  },
  { passive: true }
);

window.addEventListener(
  "touchmove",
  function (e) {
    let touches = e.touches;

    for (let i = 0, len = touches.length; i < len; i++) {
      if (i >= pointers.length) pointers.push(new pointerPrototype());
      movePointer(pointers[i], touches[i].clientX, touches[i].clientY);
    }
  },
  { passive: true }
);
