// ══════════════════════════════════════════════════════════════════
//  Beartify – background.js  v2
//  Mode immersif : overlay plein écran (cover + paroles SpicyLyrics)
//
//  Moteur d'arrière-plan dynamique WebGL porté fidèlement depuis
//  analyse.js (SpicyLyrics – classe `qo` + classe `at` + config `nd`).
//
//  BeatSync (§2) : port fidèle de la classe `at` de analyse.js.
//    Sans Spicetify.CosmosAsync, on estime la phase de beat depuis
//    audioPlayer.currentTime + window.currentTrack.bpm.
//    Formule identique : base(BPM/120 × loudness) + pulse(exp decay).
//
//  Coexistence #spicyGlobalBg (settings.js) :
//    dynbg ON  → #spicyGlobalBg masqué,  canvas WebGL visible.
//    dynbg OFF → #spicyGlobalBg restauré, canvas masqué, overlay transparent.
//    Fermeture  → restauration systématique selon window._settingsDynamicBg.
//
//  Expose : window._openImmersive() / window._closeImmersive()
// ══════════════════════════════════════════════════════════════════

(function initImmersiveMode() {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  //  §1 — GLSL SHADERS  (portés mot pour mot depuis analyse.js)
  //        on / Km / Jm / Zm / ad / ed
  // ════════════════════════════════════════════════════════════════

  /* on — vertex commun */
  const VERT = /* glsl */`
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying   vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord  = a_texCoord;
    }
  `;

  /* Km — blur diagonal 4-tap */
  const BLUR = /* glsl */`
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2      u_resolution;
    uniform float     u_offset;
    varying vec2      v_texCoord;
    void main() {
      highp vec2 ts = 1.0 / u_resolution;
      highp vec4 c  = vec4(0.0);
      c += texture2D(u_texture, v_texCoord + vec2(-u_offset,-u_offset)*ts);
      c += texture2D(u_texture, v_texCoord + vec2( u_offset,-u_offset)*ts);
      c += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset)*ts);
      c += texture2D(u_texture, v_texCoord + vec2( u_offset, u_offset)*ts);
      gl_FragColor = c * 0.25;
    }
  `;

  /* Jm — crossfade entre deux textures album */
  const BLEND = /* glsl */`
    precision highp float;
    uniform sampler2D u_texture1;
    uniform sampler2D u_texture2;
    uniform float     u_blend;
    varying vec2      v_texCoord;
    void main() {
      vec4 c1 = texture2D(u_texture1, v_texCoord);
      vec4 c2 = texture2D(u_texture2, v_texCoord);
      gl_FragColor = mix(c1, c2, u_blend);
    }
  `;

  /* Zm — teinture des zones sombres par luma masking */
  const TINT = /* glsl */`
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec3      u_tintColor;
    uniform float     u_tintIntensity;
    varying vec2      v_texCoord;
    void main() {
      vec4  c        = texture2D(u_texture, v_texCoord);
      float luma     = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);
      c.rgb = mix(c.rgb, u_tintColor, darkMask * u_tintIntensity);
      gl_FragColor = c;
    }
  `;

  /* ad — déformation Simplex-noise 2 octaves (mouvement organique) */
  const WARP = /* glsl */`
    precision highp float;
    uniform sampler2D u_texture;
    uniform float     u_time;
    uniform float     u_intensity;
    varying vec2      v_texCoord;

    vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
    float snoise(vec2 v){
      const vec4 C=vec4(0.211324865405187,0.366025403784439,
                        -0.577350269189626,0.024390243902439);
      vec2 i =floor(v+dot(v,C.yy));
      vec2 x0=v-i+dot(i,C.xx);
      vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
      vec4 x12=x0.xyxy+C.xxzz;
      x12.xy-=i1;
      i=mod289(i);
      vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
      vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
      m=m*m;m=m*m;
      vec3 x=2.0*fract(p*C.www)-1.0;
      vec3 h=abs(x)-0.5;
      vec3 ox=floor(x+0.5);
      vec3 a0=x-ox;
      m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
      vec3 g;
      g.x =a0.x *x0.x +h.x *x0.y;
      g.yz=a0.yz*x12.xz+h.yz*x12.yw;
      return 130.0*dot(m,g);
    }

    void main(){
      vec2  uv=v_texCoord;
      float t =u_time*0.05;
      vec2  center=uv-0.5;
      float cw=1.0-smoothstep(0.0,0.7,length(center));
      float n1=snoise(uv*0.35+vec2( t,       t*0.7));
      float n2=snoise(uv*0.35+vec2(-t*0.8,   t*0.5)+vec2(50.0,50.0));
      float n3=snoise(uv*0.90+vec2( t*1.2,  -t    )+vec2(100.0,0.0));
      float n4=snoise(uv*0.90+vec2(-t,       t*1.1)+vec2(0.0,100.0));
      vec2 warp=vec2(n1*0.65+n3*0.35,n2*0.65+n4*0.35)*cw;
      vec2 warpedUV=clamp(uv+warp*u_intensity,0.0,1.0);
      gl_FragColor=texture2D(u_texture,warpedUV);
    }
  `;

  /* ed — sortie : scale + vignette + saturation + dithering */
  const OUTPUT = /* glsl */`
    precision highp float;
    uniform sampler2D u_texture;
    uniform float     u_saturation;
    uniform float     u_dithering;
    uniform float     u_time;
    uniform float     u_scale;
    uniform vec2      u_resolution;
    varying vec2      v_texCoord;

    highp float hash(highp vec3 p){
      p=fract(p*0.1031);
      p+=dot(p,p.zyx+31.32);
      return fract((p.x+p.y)*p.z);
    }

    void main(){
      vec2 uv=(v_texCoord-0.5)/u_scale+0.5;
      uv=clamp(uv,0.0,1.0);
      vec4 color=texture2D(u_texture,uv);
      vec2  center =v_texCoord-0.5;
      float vignette=1.0-dot(center,center)*0.3;
      color.rgb*=vignette;
      float gray=dot(color.rgb,vec3(0.299,0.587,0.114));
      color.rgb=mix(vec3(gray),color.rgb,u_saturation);
      highp vec2  pp=floor(v_texCoord*u_resolution);
      highp float noise=hash(vec3(pp,floor(u_time*60.0)));
      color.rgb+=(noise-0.5)*u_dithering;
      gl_FragColor=color;
    }
  `;

  // ════════════════════════════════════════════════════════════════
  //  §2 — BEATSYNC  (port fidèle de la classe `at` dans analyse.js)
  //
  //  Dans analyse.js, `at.getSpeedMultiplier(position, analysis)`
  //  utilise l'audio analysis Spotify (sections, beats, loudness).
  //  Ici, on reproduit exactement la même formule mais en estimant :
  //    • BPM      → window.currentTrack.bpm  (fallback 120)
  //    • loudness → window.currentTrack.loudness (fallback -7 dBFS)
  //    • beat pos → audioPlayer.currentTime modulo (60/BPM)
  //    • confidence simulée à 0.75 (valeur moyenne Spotify typique)
  // ════════════════════════════════════════════════════════════════

  class BeatSync {
    // Constantes identiques à celles de `at` dans analyse.js
    BASE_TEMPO          = 120;
    BEAT_PULSE_MAX      = 1.5;
    BEAT_PULSE_DECAY    = 5;
    MIN_BEAT_CONFIDENCE = 0.4;
    CONFIDENCE          = 0.75; // confidence simulée (sans données Spotify)

    _bpm      = 120;
    _beatDur  = 0.5;   // secondes par beat à 120 BPM
    _loudness = -7;    // dBFS typique d'un morceau pop

    /** Appelé à chaque changement de piste */
    setTrack(bpm, loudness) {
      this._bpm      = Math.max(40, Math.min(240, bpm      || 120));
      this._loudness = Math.max(-60, Math.min(0,  loudness ?? -7));
      this._beatDur  = 60 / this._bpm;
    }

    /**
     * Port exact de at.getLoudnessFactor(db) dans analyse.js :
     *   0.5 + max(0, (db + 40) / 40) * 0.7
     */
    getLoudnessFactor(db) {
      return 0.5 + Math.max(0, (db + 40) / 40) * 0.7;
    }

    /**
     * Port exact de at.getSpeedMultiplier() — même formule,
     * sans les sections/beats Spotify (estimés par BPM + currentTime).
     *
     *   n  = (bpm / BASE_TEMPO) * loudnessFactor     ← même que section.tempo/120 * lf
     *   +   BEAT_PULSE_MAX * exp(-DECAY * beatPos) * confidence  ← même que le beat pulse
     */
    getSpeedMultiplier(currentTime) {
      // Base : équivalent de section.tempo / BASE_TEMPO * getLoudnessFactor(section.loudness)
      let speed = (this._bpm / this.BASE_TEMPO) * this.getLoudnessFactor(this._loudness);

      // Beat pulse : équivalent de l'interpolation sur beats[i]
      if (this.CONFIDENCE > this.MIN_BEAT_CONFIDENCE) {
        const beatPos = (currentTime % this._beatDur) / this._beatDur; // 0→1 dans le beat courant
        const decay   = Math.exp(-this.BEAT_PULSE_DECAY * beatPos);
        speed += this.BEAT_PULSE_MAX * decay * this.CONFIDENCE;
      }

      // Même clamp que analyse.js : max(.1, min(n, 3))
      return Math.max(0.1, Math.min(speed, 3));
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  §3 — MOTEUR WEBGL  (port fidèle de la classe `qo` dans analyse.js)
  // ════════════════════════════════════════════════════════════════

  class ImmersiveBgRenderer {
    canvas; gl;
    halfFloatExt = null; halfFloatLinearExt = null;
    blurProgram; blendProgram; tintProgram; warpProgram; outputProgram;
    positionBuffer; texCoordBuffer; sourceTexture;
    blurFBO1; blurFBO2; currentAlbumFBO; nextAlbumFBO; warpFBO;
    animationId = null;
    lastFrameTime = 0;
    accumulatedTime = 0;
    isPlaying = false;
    isTransitioning = false;
    transitionStartTime = 0;
    hasImage = false;
    attribs; uniforms;
    _transitionDuration; _warpIntensity; _blurPasses;
    _animationSpeed; _targetAnimationSpeed;
    _saturation; _tintColor; _tintIntensity; _dithering; _scale;

    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL not supported');
      this.gl = gl;
      this.halfFloatExt       = gl.getExtension('OES_texture_half_float');
      this.halfFloatLinearExt = gl.getExtension('OES_texture_half_float_linear');

      // Defaults identiques au constructeur de qo dans analyse.js (lignes 10113-10122).
      // nd passe tintIntensity:0, donc _tintIntensity = 0 (couleurs natives de la cover).
      // nd passe animationSpeed:.1 → valeur de départ basse ; BeatSync prend le relais.
      this._warpIntensity        = opts.warpIntensity        ?? 1;
      this._blurPasses           = opts.blurPasses           ?? 8;
      this._animationSpeed       = opts.animationSpeed       ?? 1;
      this._targetAnimationSpeed = this._animationSpeed;
      this._transitionDuration   = opts.transitionDuration   ?? 1e3;
      this._saturation           = opts.saturation           ?? 1.5;
      this._tintColor            = opts.tintColor            ?? [.157, .157, .235];
      this._tintIntensity        = opts.tintIntensity        ?? .15;
      this._dithering            = opts.dithering            ?? .008;
      this._scale                = opts.scale                ?? 1;

      this.blurProgram   = this._prog(VERT, BLUR);
      this.blendProgram  = this._prog(VERT, BLEND);
      this.tintProgram   = this._prog(VERT, TINT);
      this.warpProgram   = this._prog(VERT, WARP);
      this.outputProgram = this._prog(VERT, OUTPUT);

      this.attribs = {
        position: gl.getAttribLocation(this.blurProgram, 'a_position'),
        texCoord: gl.getAttribLocation(this.blurProgram, 'a_texCoord'),
      };
      this.uniforms = {
        blur:   { resolution: gl.getUniformLocation(this.blurProgram,   'u_resolution'),
                  texture:    gl.getUniformLocation(this.blurProgram,   'u_texture'),
                  offset:     gl.getUniformLocation(this.blurProgram,   'u_offset') },
        blend:  { texture1:   gl.getUniformLocation(this.blendProgram,  'u_texture1'),
                  texture2:   gl.getUniformLocation(this.blendProgram,  'u_texture2'),
                  blend:      gl.getUniformLocation(this.blendProgram,  'u_blend') },
        tint:   { texture:       gl.getUniformLocation(this.tintProgram,  'u_texture'),
                  tintColor:     gl.getUniformLocation(this.tintProgram,  'u_tintColor'),
                  tintIntensity: gl.getUniformLocation(this.tintProgram,  'u_tintIntensity') },
        warp:   { texture:   gl.getUniformLocation(this.warpProgram,   'u_texture'),
                  time:      gl.getUniformLocation(this.warpProgram,   'u_time'),
                  intensity: gl.getUniformLocation(this.warpProgram,   'u_intensity') },
        output: { texture:    gl.getUniformLocation(this.outputProgram, 'u_texture'),
                  saturation: gl.getUniformLocation(this.outputProgram, 'u_saturation'),
                  dithering:  gl.getUniformLocation(this.outputProgram, 'u_dithering'),
                  time:       gl.getUniformLocation(this.outputProgram, 'u_time'),
                  scale:      gl.getUniformLocation(this.outputProgram, 'u_scale'),
                  resolution: gl.getUniformLocation(this.outputProgram, 'u_resolution') },
      };

      this.positionBuffer = this._buf(new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]));
      this.texCoordBuffer = this._buf(new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]));
      this.sourceTexture   = this._tex();
      this.blurFBO1        = this._fbo(128, 128, true);
      this.blurFBO2        = this._fbo(128, 128, true);
      this.currentAlbumFBO = this._fbo(128, 128, true);
      this.nextAlbumFBO    = this._fbo(128, 128, true);
      this.warpFBO         = this._fbo(1, 1, true);
      this.resize();
    }

    // ── Getters / Setters — identiques à qo dans analyse.js ─────

    get warpIntensity()     { return this._warpIntensity; }
    set warpIntensity(v)    { this._warpIntensity = Math.max(0, Math.min(1, v)); }

    get blurPasses()        { return this._blurPasses; }
    set blurPasses(v) {
      const n = Math.max(1, Math.min(40, Math.floor(v)));
      if (n !== this._blurPasses) { this._blurPasses = n; this.hasImage && this.reblurCurrentImage(); }
    }

    get animationSpeed()    { return this._targetAnimationSpeed; }
    set animationSpeed(v)   { this._targetAnimationSpeed = Math.max(.1, Math.min(5, v)); }

    get transitionDuration(){ return this._transitionDuration; }
    set transitionDuration(v){ this._transitionDuration = Math.max(0, Math.min(5e3, v)); }

    get saturation()        { return this._saturation; }
    set saturation(v)       { this._saturation = Math.max(0, Math.min(3, v)); }

    get tintColor()         { return this._tintColor; }
    set tintColor(v) {
      const n = v.map(x => Math.max(0, Math.min(1, x)));
      if (n.some((x,i) => x !== this._tintColor[i])) {
        this._tintColor = n; this.hasImage && this.reblurCurrentImage();
      }
    }

    get tintIntensity()     { return this._tintIntensity; }
    set tintIntensity(v) {
      const n = Math.max(0, Math.min(1, v));
      if (n !== this._tintIntensity) { this._tintIntensity = n; this.hasImage && this.reblurCurrentImage(); }
    }

    get dithering()         { return this._dithering; }
    set dithering(v)        { this._dithering = Math.max(0, Math.min(.1, v)); }

    get scale()             { return this._scale; }
    set scale(v)            { this._scale = Math.max(.01, Math.min(4, v)); }

    /** Identique à qo.setOptions() dans analyse.js */
    setOptions(o) {
      if (o.warpIntensity      !== undefined) this.warpIntensity      = o.warpIntensity;
      if (o.blurPasses         !== undefined) this.blurPasses         = o.blurPasses;
      if (o.animationSpeed     !== undefined) this.animationSpeed     = o.animationSpeed;
      if (o.transitionDuration !== undefined) this.transitionDuration = o.transitionDuration;
      if (o.saturation         !== undefined) this.saturation         = o.saturation;
      if (o.tintColor          !== undefined) this.tintColor          = o.tintColor;
      if (o.tintIntensity      !== undefined) this.tintIntensity      = o.tintIntensity;
      if (o.dithering          !== undefined) this.dithering          = o.dithering;
      if (o.scale              !== undefined) this.scale              = o.scale;
    }

    // ── Image loading ─────────────────────────────────────────────

    loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => {
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
          this.processNewImage();
          resolve();
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
      });
    }

    loadImageElement(el) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, el);
      this.processNewImage();
    }

    /** Identique à qo.loadGradient() dans analyse.js (fallback si cover inaccessible) */
    loadGradient(colors, angle = 135) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const rad = angle * Math.PI / 180;
      const grd = ctx.createLinearGradient(
        256 - Math.cos(rad)*512, 256 - Math.sin(rad)*512,
        256 + Math.cos(rad)*512, 256 + Math.sin(rad)*512
      );
      colors.forEach((col, i) => grd.addColorStop(i / (colors.length - 1), col));
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 512);
      this.loadImageElement(c);
    }

    // ── Cycle de vie ─────────────────────────────────────────────

    start() {
      if (this.isPlaying) return;
      this.isPlaying     = true;
      this.lastFrameTime = performance.now();
      requestAnimationFrame(this.renderLoop);
    }

    stop() {
      this.isPlaying = false;
      if (this.animationId !== null) { cancelAnimationFrame(this.animationId); this.animationId = null; }
    }

    dispose() {
      this.stop();
      const gl = this.gl;
      [this.blurProgram, this.blendProgram, this.tintProgram,
       this.warpProgram, this.outputProgram].forEach(p => gl.deleteProgram(p));
      [this.positionBuffer, this.texCoordBuffer].forEach(b => gl.deleteBuffer(b));
      gl.deleteTexture(this.sourceTexture);
      [this.blurFBO1, this.blurFBO2, this.currentAlbumFBO,
       this.nextAlbumFBO, this.warpFBO].forEach(f => this._delFBO(f));
    }

    resize() {
      const w = this.canvas.width, h = this.canvas.height;
      if (this.warpFBO) this._delFBO(this.warpFBO);
      this.warpFBO = this._fbo(w, h, true);
    }

    // ── Pipeline de rendu — port exact de qo.render() / qo.renderLoop ─

    /** Arrow class field — identique à qo.renderLoop dans analyse.js (ligne 10407) */
    renderLoop = (timestamp) => {
      if (!this.isPlaying) return;
      const dt = (timestamp - this.lastFrameTime) / 1e3;
      this.lastFrameTime = timestamp;
      // Lissage exponentiel — identique à analyse.js ligne 10412
      this._animationSpeed += (this._targetAnimationSpeed - this._animationSpeed) * .05;
      this.accumulatedTime += dt * this._animationSpeed;
      this.render(this.accumulatedTime, timestamp);
      this.animationId = requestAnimationFrame(this.renderLoop);
    };

    /**
     * Port exact de qo.render() dans analyse.js (lignes 10418-10484).
     * Deux chemins identiques : transition (blend+warp+output) ou normal (warp+output).
     */
    render(t, now = performance.now()) {
      const gl = this.gl;
      const W  = this.canvas.width;
      const H  = this.canvas.height;

      // Facteur de transition — identique à analyse.js
      let s = 1;
      if (this.isTransitioning) {
        s = Math.min(1, (now - this.transitionStartTime) / this._transitionDuration);
        if (s >= 1) this.isTransitioning = false;
      }

      if (this.isTransitioning && s < 1) {
        // ── Chemin transition : blend → blurFBO1, puis warp + output ─
        gl.useProgram(this.blendProgram);
        this._attr();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
        gl.viewport(0, 0, 128, 128);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.currentAlbumFBO.texture);
        gl.uniform1i(this.uniforms.blend.texture1, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
        gl.uniform1i(this.uniforms.blend.texture2, 1);
        gl.uniform1f(this.uniforms.blend.blend, s);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(this.warpProgram);
        this._attr();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
        gl.viewport(0, 0, W, H);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.blurFBO1.texture);
        gl.uniform1i(this.uniforms.warp.texture,   0);
        gl.uniform1f(this.uniforms.warp.time,      t);
        gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(this.outputProgram);
        this._attr();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);
        gl.uniform1i(this.uniforms.output.texture,    0);
        gl.uniform1f(this.uniforms.output.saturation, this._saturation);
        gl.uniform1f(this.uniforms.output.dithering,  this._dithering);
        gl.uniform1f(this.uniforms.output.time,       t);
        gl.uniform1f(this.uniforms.output.scale,      this._scale);
        gl.uniform2f(this.uniforms.output.resolution, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

      } else {
        // ── Chemin normal : warp(nextAlbumFBO) + output ──────────
        gl.useProgram(this.warpProgram);
        this._attr();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
        gl.viewport(0, 0, W, H);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
        gl.uniform1i(this.uniforms.warp.texture,   0);
        gl.uniform1f(this.uniforms.warp.time,      t);
        gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(this.outputProgram);
        this._attr();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);
        gl.uniform1i(this.uniforms.output.texture,    0);
        gl.uniform1f(this.uniforms.output.saturation, this._saturation);
        gl.uniform1f(this.uniforms.output.dithering,  this._dithering);
        gl.uniform1f(this.uniforms.output.time,       t);
        gl.uniform1f(this.uniforms.output.scale,      this._scale);
        gl.uniform2f(this.uniforms.output.resolution, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    processNewImage() {
      [this.currentAlbumFBO, this.nextAlbumFBO] = [this.nextAlbumFBO, this.currentAlbumFBO];
      this.blurSourceInto(this.nextAlbumFBO);
      this.hasImage            = true;
      this.isTransitioning     = true;
      this.transitionStartTime = performance.now();
    }

    reblurCurrentImage() { this.blurSourceInto(this.nextAlbumFBO); }

    /** Identique à qo.blurSourceInto() dans analyse.js (lignes 10331-10360) */
    blurSourceInto(targetFBO) {
      const gl = this.gl;
      // Tint pass → blurFBO1
      gl.useProgram(this.tintProgram);
      this._attr();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
      gl.viewport(0, 0, 128, 128);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.uniform1i (this.uniforms.tint.texture,       0);
      gl.uniform3fv(this.uniforms.tint.tintColor,     this._tintColor);
      gl.uniform1f (this.uniforms.tint.tintIntensity, this._tintIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // Multi-pass blur ping-pong
      gl.useProgram(this.blurProgram);
      this._attr();
      gl.uniform2f(this.uniforms.blur.resolution, 128, 128);
      gl.uniform1i(this.uniforms.blur.texture, 0);
      let src = this.blurFBO1, dst = this.blurFBO2;
      for (let i = 0; i < this._blurPasses; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
        gl.viewport(0, 0, 128, 128);
        gl.bindTexture(gl.TEXTURE_2D, src.texture);
        gl.uniform1f(this.uniforms.blur.offset, i + .5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        [src, dst] = [dst, src];
      }
      // Copie finale dans targetFBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
      gl.viewport(0, 0, 128, 128);
      gl.bindTexture(gl.TEXTURE_2D, src.texture);
      gl.uniform1f(this.uniforms.blur.offset, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // ── Helpers WebGL ─────────────────────────────────────────────

    /** Identique à qo.setupAttributes() dans analyse.js */
    _attr() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.attribs.position);
      gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
      gl.enableVertexAttribArray(this.attribs.texCoord);
      gl.vertexAttribPointer(this.attribs.texCoord, 2, gl.FLOAT, false, 0, 0);
    }

    _shader(type, src) {
      const gl = this.gl, sh = gl.createShader(type);
      if (!sh) throw new Error('Failed to create shader');
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const e = gl.getShaderInfoLog(sh); gl.deleteShader(sh);
        throw new Error(`Shader compile error: ${e}`);
      }
      return sh;
    }

    _prog(vert, frag) {
      const gl = this.gl;
      const v  = this._shader(gl.VERTEX_SHADER,   vert);
      const f  = this._shader(gl.FRAGMENT_SHADER, frag);
      const p  = gl.createProgram();
      if (!p) throw new Error('Failed to create program');
      gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const e = gl.getProgramInfoLog(p); gl.deleteProgram(p);
        throw new Error(`Program link error: ${e}`);
      }
      gl.deleteShader(v); gl.deleteShader(f);
      return p;
    }

    _buf(data) {
      const gl = this.gl, b = gl.createBuffer();
      if (!b) throw new Error('Failed to create buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }

    _tex() {
      const gl = this.gl, t = gl.createTexture();
      if (!t) throw new Error('Failed to create texture');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }

    _fbo(w, h, halfFloat = false) {
      const gl   = this.gl;
      const tex  = this._tex();
      const type = halfFloat && this.halfFloatExt && this.halfFloatLinearExt
        ? this.halfFloatExt.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
      const fb = gl.createFramebuffer();
      if (!fb) throw new Error('Failed to create framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { framebuffer: fb, texture: tex };
    }

    _delFBO({ framebuffer, texture }) {
      this.gl.deleteFramebuffer(framebuffer);
      this.gl.deleteTexture(texture);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  §4 — CONFIG ND  (identique à nd dans analyse.js, ligne 10647)
  //
  //  tintIntensity: 0 → couleurs de la cover sans altération de teinte.
  //  animationSpeed: .1 → valeur de départ basse ; le BeatSync la
  //    pousse immédiatement vers la valeur réelle (1–2.5 selon BPM).
  // ════════════════════════════════════════════════════════════════

  const ND = {
    warpIntensity:      1,
    blurPasses:         8,
    animationSpeed:     .1,   // nd.animationSpeed dans analyse.js
    saturation:         1.5,
    dithering:          .008,
    transitionDuration: 1e3,
    tintIntensity:      0,    // nd.tintIntensity → pas d'altération de teinte
    scale:              1,
  };

  // ════════════════════════════════════════════════════════════════
  //  §5 — CONSTRUCTION DE L'OVERLAY
  // ════════════════════════════════════════════════════════════════

  const overlay = document.createElement('div');
  overlay.id        = 'immersiveOverlay';
  overlay.className = 'imv-overlay';
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Mode immersif');

  overlay.innerHTML = `

    <!-- Canvas WebGL : arrière-plan dynamique (z-index:-1 dans le contexte isolé) -->
    <canvas id="immBgCanvas" class="imv-bg-canvas" aria-hidden="true"></canvas>

    <!-- ✕ Fermer — haut centre -->
    <button class="imv-close" id="immClose" title="Quitter le mode immersif (Échap)">
      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12
                 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>

    <!-- ══ Colonne gauche ══ -->
    <div class="imv-left">
      <div class="imv-cover-wrap">
        <img class="imv-cover-img" id="immCoverImg"
             src="pictures/default-cover.png" alt="Pochette">

        <div class="imv-cover-controls">

          <!-- Rangée haute : actions + toggle fond dynamique -->
          <div class="imv-ctrl-top">
            <button class="imv-icon-btn" id="immBtnQueue" title="File d'attente">
              <img src="pictures/icon-queue.png" alt="" class="imv-icon-img">
            </button>

            <button class="imv-icon-btn" id="immBtnResize"
                    title="Agrandir / Réduire la cover">
              <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                <path d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z"/>
              </svg>
            </button>

            <button class="imv-icon-btn" id="immBtnNativeFs"
                    title="Plein écran navigateur">
              <img src="pictures/icon-fullscreen.png" alt="" class="imv-icon-img">
            </button>

            <!-- ★ Toggle fond dynamique WebGL -->
            <button class="imv-icon-btn imv-dynbg-btn imv-dynbg-btn--active"
                    id="immBtnDynBg"
                    title="Désactiver le fond dynamique">
              <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10
                         10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4
                         0h-2V8h2v8z"/>
              </svg>
            </button>

            <button class="imv-icon-btn" id="immBtnClose"
                    title="Fermer le mode immersif">
              <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12
                         5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>

          <!-- Rangée basse : transport + progression -->
          <div class="imv-ctrl-bottom">
            <div class="imv-transport">
              <button class="imv-ctrl-btn" id="immBtnShuffle" title="Aléatoire">
                <img src="pictures/icon-shuffle.png" alt="" class="imv-ctrl-icon">
              </button>
              <button class="imv-ctrl-btn" id="immBtnPrev" title="Précédent">
                <img src="pictures/icon-prev.png"    alt="" class="imv-ctrl-icon">
              </button>
              <button class="imv-play-btn" id="immBtnPlay" title="Lecture / Pause">
                <img src="pictures/icon-play.png"  alt="" id="immPlayIcon"  class="imv-play-icon">
                <img src="pictures/icon-pause.png" alt="" id="immPauseIcon" class="imv-play-icon" style="display:none">
              </button>
              <button class="imv-ctrl-btn" id="immBtnNext" title="Suivant">
                <img src="pictures/icon-next.png"   alt="" class="imv-ctrl-icon">
              </button>
              <button class="imv-ctrl-btn" id="immBtnRepeat" title="Répéter">
                <img src="pictures/icon-repeat.png" alt="" class="imv-ctrl-icon">
              </button>
            </div>
            <div class="imv-progress-row">
              <span class="imv-time" id="immCurTime">0:00</span>
              <div class="imv-prog-track" id="immProgTrack">
                <div class="imv-prog-fill" id="immProgFill"></div>
              </div>
              <span class="imv-time" id="immTotTime">0:00</span>
            </div>
          </div>

        </div><!-- /imv-cover-controls -->
      </div><!-- /imv-cover-wrap -->

      <div class="imv-track-meta">
        <div class="imv-meta-title"  id="immMetaTitle">—</div>
        <div class="imv-meta-artist" id="immMetaArtist">—</div>
      </div>
    </div><!-- /imv-left -->

    <!-- ══ Colonne droite : slot paroles ══ -->
    <div class="imv-lyrics-slot" id="immLyricsSlot"></div>

  `;

  document.body.appendChild(overlay);

  // ════════════════════════════════════════════════════════════════
  //  §6 — ÉTAT INTERNE
  // ════════════════════════════════════════════════════════════════

  const $ = id => document.getElementById(id);

  let _isOpen       = false;
  let _rafId        = null;
  let _lyricParent  = null;
  let _stretched    = false;
  let _dynBgEnabled = true;
  let _bgRenderer   = null;
  let _beatSync     = new BeatSync();
  let _resizeObs    = null;

  // Sauvegarde du style de #spicyGlobalBg avant masquage
  let _spicySaved   = null; // { display, opacity }

  // ════════════════════════════════════════════════════════════════
  //  §7 — GESTION #spicyGlobalBg
  //
  //  dynbg ON  : masquer (notre canvas le remplace entièrement).
  //  dynbg OFF : restaurer (visible à travers l'overlay transparent).
  //  Fermeture : toujours restaurer selon window._settingsDynamicBg.
  // ════════════════════════════════════════════════════════════════

  function _hideSpicyBg() {
    const el = document.getElementById('spicyGlobalBg');
    if (!el) return;
    if (!_spicySaved) _spicySaved = { display: el.style.display, opacity: el.style.opacity };
    el.style.display = 'none';
    el.style.opacity = '0';
  }

  function _restoreSpicyBg() {
    const el = document.getElementById('spicyGlobalBg');
    if (!el) return;
    // Respecter la décision prise par settings.js (window._settingsDynamicBg)
    if (window._settingsDynamicBg === false) {
      el.style.display = 'none';
      el.style.opacity = '0';
    } else if (_spicySaved) {
      el.style.display = _spicySaved.display;
      el.style.opacity = _spicySaved.opacity;
    } else {
      el.style.display = '';
      el.style.opacity = '1';
    }
    _spicySaved = null;
  }

  // ════════════════════════════════════════════════════════════════
  //  §8 — MOTEUR WebGL : INIT / DESTROY / TOGGLE
  // ════════════════════════════════════════════════════════════════

  function _resizeCanvas(canvas) {
    // Force un reflow synchrone AVANT de lire offsetWidth/Height.
    // Sans ça, si _resizeCanvas est appelé juste après display:flex,
    // le navigateur peut retourner 0×0 (layout pas encore recalculé).
    // eslint-disable-next-line no-unused-expressions
    void overlay.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w   = Math.max(1, Math.round(overlay.offsetWidth  * dpr));
    const h   = Math.max(1, Math.round(overlay.offsetHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  /**
   * Port de _e() dans analyse.js :
   *   await u.loadImage(n)  ← image chargée+blurrée AVANT le premier frame
   *   u.start()             ← rendu démarre sans frame noir initial
   *
   * Cette séquence est critique : dans l'original, le renderer ne démarre
   * jamais sur un FBO vide (noir). Il faut impérativement attendre que
   * processNewImage() ait rempli nextAlbumFBO avant le premier render().
   */
  async function _initRenderer() {
    const canvas = $('immBgCanvas');
    if (!canvas) return;

    _destroyRenderer();
    _resizeCanvas(canvas);

    // Cache le fond du thème — le canvas WebGL le remplace
    _hideSpicyBg();
    overlay.style.background = 'transparent';

    try {
      _bgRenderer = new ImmersiveBgRenderer(canvas, ND);
    } catch (e) {
      console.warn('[ImmersiveBg] WebGL init failed:', e);
      _bgRenderer = null;
      _restoreSpicyBg();
      overlay.style.background = '';
      canvas.style.opacity = '0';
      return;
    }

    _resizeObs = new ResizeObserver(() => {
      if (!_bgRenderer) return;
      _resizeCanvas(canvas);
      _bgRenderer.resize();
    });
    _resizeObs.observe(overlay);

    // ★ Attendre que l'image soit chargée ET blurrée dans nextAlbumFBO
    //   avant de rendre le canvas visible et de démarrer la boucle RAF.
    //   Identique à `await u.loadImage(n); u.start()` dans _e() d'analyse.js.
    canvas.style.opacity = '0'; // invisible pendant le chargement
    await _loadCoverIntoRenderer();

    // Révéler le canvas et démarrer — aucun frame noir possible
    canvas.style.opacity = '1';
    _bgRenderer.start();
  }

  function _destroyRenderer() {
    _resizeObs?.disconnect();
    _resizeObs = null;
    if (_bgRenderer) { _bgRenderer.dispose(); _bgRenderer = null; }
  }

  /**
   * Charge la cover dans le renderer et retourne une Promise qui se résout
   * quand l'image est prête dans le FBO (processNewImage() appelé).
   *
   * Chaîne de chargement (fidèle à l'ordre de robustesse de _e()) :
   *   1. loadImage(url) avec crossOrigin:'anonymous' (Spotify CDN, localhost…)
   *   2. Si CORS échoue → _sampleCoverColors() → loadGradient() avec
   *      les vraies couleurs de l'album extraites via canvas 2D sans CORS.
   *   3. Si même le 2D canvas est bloqué → gradient générique sombre.
   *
   * La Promise retournée permet à _initRenderer() d'attendre la fin
   * avant d'appeler start() — identique à `await u.loadImage(n)` dans _e().
   */
  function _loadCoverIntoRenderer() {
    if (!_bgRenderer) return Promise.resolve();
    const src = window.currentTrack?.imageUrl || 'pictures/default-cover.png';

    return _bgRenderer.loadImage(src).catch(() => {
      // CORS refusé : extraire les couleurs dominantes sans CORS puis gradient
      return new Promise(resolve => {
        _sampleCoverColors(src, cols => {
          if (_bgRenderer) _bgRenderer.loadGradient(cols);
          resolve();
        });
      });
    });
  }

  /**
   * Charge l'image SANS crossOrigin, la dessine dans un micro-canvas 2D
   * et extrait 3 couleurs dominantes pour un gradient de fallback.
   * Compatible avec toutes les sources (locale, data:, streaming CDN).
   */
  function _sampleCoverColors(src, cb) {
    const img = new Image();
    // PAS de crossOrigin → permet le chargement depuis n'importe quelle source
    // (le canvas 2D résultant sera "tainted" mais on ne l'exporte pas)
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 8;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) { cb(['#1a0a2e', '#2e0a1a', '#0a1a2e']); return; }
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        // Echantillonner 3 zones : coin haut-gauche, centre, coin bas-droit
        const pick = (i) => `rgb(${d[i]},${d[i+1]},${d[i+2]})`;
        cb([pick(0), pick((8*4 + 4)*4), pick((8*7 + 7)*4)]);
      } catch {
        // Canvas tainted (CORS strict) → fallback générique coloré
        cb(['#1a0a2e', '#2e1a0a', '#0a1a2e']);
      }
    };
    img.onerror = () => cb(['#1a0a2e', '#2e1a0a', '#0a1a2e']);
    img.src = src;
  }

  /**
   * Toggle appelé par #immBtnDynBg.
   *
   * ON  → cache #spicyGlobalBg, overlay transparent, canvas visible, WebGL démarre.
   * OFF → arrête le renderer, restaure #spicyGlobalBg (thème visible à travers
   *        l'overlay transparent), canvas invisible.
   */
  function _toggleDynBg() {
    _dynBgEnabled = !_dynBgEnabled;

    const btn    = $('immBtnDynBg');
    const canvas = $('immBgCanvas');

    if (btn) {
      btn.classList.toggle('imv-dynbg-btn--active',   _dynBgEnabled);
      btn.classList.toggle('imv-dynbg-btn--inactive', !_dynBgEnabled);
      btn.title = _dynBgEnabled ? 'Désactiver le fond dynamique' : 'Activer le fond dynamique';
    }

    if (_dynBgEnabled) {
      _initRenderer(); // async — canvas reste invisible jusqu'à l'image chargée
    } else {
      _destroyRenderer();
      if (canvas) canvas.style.opacity = '0';
      // Restaurer le thème — visible à travers l'overlay (background:transparent)
      _restoreSpicyBg();
      overlay.style.background = 'transparent';
    }

    try { sessionStorage.setItem('imv_dynbg', _dynBgEnabled ? '1' : '0'); } catch {}
  }

  // ════════════════════════════════════════════════════════════════
  //  §9 — BEAT SYNC (équivalent de playback:progress dans analyse.js)
  //
  //  analyse.js : playback:progress → rd(trackId) → audio analysis Spotify
  //               → td.getSpeedMultiplier(pos, analysis) → vl(speed)
  //  Ici        : timeupdate → _beatSync.getSpeedMultiplier(currentTime)
  //               → _bgRenderer.setOptions({ animationSpeed })
  // ════════════════════════════════════════════════════════════════

  function _onTimeUpdate() {
    if (!_bgRenderer || !_dynBgEnabled) return;
    const ap = $('audioPlayer');
    if (!ap) return;

    if (ap.paused) {
      // Identique à sd(true) → vl(0.1) dans analyse.js
      _bgRenderer.setOptions({ animationSpeed: .1 });
      return;
    }

    // Identique à playback:progress dans analyse.js :
    //   Si analyse dispo → td.getSpeedMultiplier() → vl(speed)
    //   Si pas d'analyse → fl() → vl(1)
    //
    // En Beartify : si window.currentTrack.bpm est renseigné → BeatSync
    //               sinon → fl() fallback = 1.0 (comme analyse.js sans données)
    const bpm = window.currentTrack?.bpm;
    if (bpm) {
      _bgRenderer.setOptions({ animationSpeed: _beatSync.getSpeedMultiplier(ap.currentTime) });
    } else {
      // fl() dans analyse.js : vl(1) quand pas d'analyse disponible
      _bgRenderer.setOptions({ animationSpeed: 1 });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  §10 — SYNC PISTE / LECTURE
  // ════════════════════════════════════════════════════════════════

  function _fmt(s) {
    s = Math.floor(s || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function _syncTrackInfo() {
    const track = window.currentTrack;
    const img   = $('immCoverImg');
    if (img) img.src = track?.imageUrl || 'pictures/default-cover.png';
    ($('immMetaTitle'))  && ($('immMetaTitle').textContent  = track?.title  || '—');
    ($('immMetaArtist')) && ($('immMetaArtist').textContent = track?.artist || '—');

    // Mettre à jour le BeatSync avec les données de la nouvelle piste.
    // Équivalent de rd(newTrackId) dans analyse.js (fetch audio analysis).
    // La propriété bpm et loudness sont lues depuis window.currentTrack si disponibles.
    // Si absentes → BeatSync sera ignoré et fl() = vl(1) sera utilisé (_onTimeUpdate).
    _beatSync.setTrack(track?.bpm, track?.loudness);

    // Recharger l'image dans le renderer (crossfade automatique via processNewImage)
    if (_bgRenderer && _dynBgEnabled) _loadCoverIntoRenderer();
  }

  function _syncPlayState() {
    const ap  = $('audioPlayer');
    const pi  = $('immPlayIcon');
    const pai = $('immPauseIcon');
    if (!pi || !pai) return;
    const playing = ap && !ap.paused;
    pi.style.display  = playing ? 'none' : '';
    pai.style.display = playing ? ''     : 'none';
    // Équivalent de sd(isPaused) dans analyse.js
    if (_bgRenderer) _bgRenderer.setOptions({ animationSpeed: playing ? 1 : .1 });
  }

  // ════════════════════════════════════════════════════════════════
  //  §11 — BOUCLE RAF (barre de progression)
  // ════════════════════════════════════════════════════════════════

  function _startRaf() {
    _stopRaf();
    const ap = $('audioPlayer'), fill = $('immProgFill'), cur = $('immCurTime'), tot = $('immTotTime');
    function tick() {
      if (ap) {
        const pct = ap.duration ? (ap.currentTime / ap.duration) * 100 : 0;
        if (fill) fill.style.width = pct + '%';
        if (cur)  cur.textContent  = _fmt(ap.currentTime);
        if (tot)  tot.textContent  = _fmt(ap.duration);
      }
      _rafId = requestAnimationFrame(tick);
    }
    _rafId = requestAnimationFrame(tick);
  }

  function _stopRaf() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  // ════════════════════════════════════════════════════════════════
  //  §12 — LISTENERS AUDIO
  // ════════════════════════════════════════════════════════════════

  function _bindAudio() {
    const ap = $('audioPlayer');
    if (!ap) return;
    ap.addEventListener('play',       _syncPlayState);
    ap.addEventListener('pause',      _syncPlayState);
    ap.addEventListener('loadstart',  _syncTrackInfo);
    // timeupdate → BeatSync (équivalent de playback:progress dans analyse.js)
    ap.addEventListener('timeupdate', _onTimeUpdate);
  }

  function _unbindAudio() {
    const ap = $('audioPlayer');
    if (!ap) return;
    ap.removeEventListener('play',       _syncPlayState);
    ap.removeEventListener('pause',      _syncPlayState);
    ap.removeEventListener('loadstart',  _syncTrackInfo);
    ap.removeEventListener('timeupdate', _onTimeUpdate);
  }

  // ════════════════════════════════════════════════════════════════
  //  §13 — GESTION DES PAROLES
  // ════════════════════════════════════════════════════════════════

  function _takeLyrics() {
    const ld = $('lyricsDisplay'), slot = $('immLyricsSlot');
    if (!ld || !slot) return;
    _lyricParent = ld.parentNode;
    slot.appendChild(ld);
  }

  function _restoreLyrics() {
    const ld = $('lyricsDisplay');
    if (!ld || !_lyricParent) return;
    _lyricParent.appendChild(ld);
    _lyricParent = null;
  }

  function _forceLyricsScroll() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = $('lyricsDisplay');
      if (!c) return;
      let t = c.querySelector('.line.Active:not(.musical-line)');
      if (!t) { const s = c.querySelectorAll('.line.Sung:not(.musical-line)'); if (s.length) t = s[s.length - 1]; }
      if (t && c.clientHeight > 0)
        c.scrollTo({ top: Math.max(0, t.offsetTop - c.clientHeight/2 + t.clientHeight/2), behavior: 'instant' });
    }));
  }

  // ════════════════════════════════════════════════════════════════
  //  §14 — OUVERTURE / FERMETURE
  // ════════════════════════════════════════════════════════════════

  function open() {
    if (_isOpen) return;
    _isOpen = true;

    // Restaurer la préférence de session
    try { const s = sessionStorage.getItem('imv_dynbg'); if (s !== null) _dynBgEnabled = s === '1'; } catch {}

    const btn = $('immBtnDynBg');
    if (btn) {
      btn.classList.toggle('imv-dynbg-btn--active',   _dynBgEnabled);
      btn.classList.toggle('imv-dynbg-btn--inactive', !_dynBgEnabled);
      btn.title = _dynBgEnabled ? 'Désactiver le fond dynamique' : 'Activer le fond dynamique';
    }

    _syncTrackInfo();
    _takeLyrics();

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('imv-open');

    if (_dynBgEnabled) {
      // Async : canvas reste opacity:0 jusqu'à l'image chargée, alors start().
      // Pas de frame noir — identique à `await u.loadImage(n); u.start()` dans _e().
      _initRenderer();
    } else {
      // dynbg désactivé : overlay transparent, thème visible en dessous
      overlay.style.background = 'transparent';
      const canvas = $('immBgCanvas');
      if (canvas) canvas.style.opacity = '0';
    }

    _bindAudio();
    _startRaf();
    _syncPlayState();
    _forceLyricsScroll();
  }

  function close() {
    if (!_isOpen) return;
    _isOpen = false;

    _stopRaf();
    _unbindAudio();
    _restoreLyrics();
    _destroyRenderer();
    _restoreSpicyBg();
    overlay.style.background = '';

    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('imv-open');
  }

  // ════════════════════════════════════════════════════════════════
  //  §15 — BOUTONS
  // ════════════════════════════════════════════════════════════════

  $('immBtnPlay')?.addEventListener('click',    () => $('playPauseBtn')?.click());
  $('immBtnPrev')?.addEventListener('click',    () => $('prevBtn')?.click());
  $('immBtnNext')?.addEventListener('click',    () => $('nextBtn')?.click());
  $('immBtnShuffle')?.addEventListener('click', () => $('shuffleBtn')?.click());
  $('immBtnRepeat')?.addEventListener('click',  () => $('repeatBtn')?.click());
  $('immBtnQueue')?.addEventListener('click', () => { close(); $('queueBtn')?.click(); });

  $('immBtnNativeFs')?.addEventListener('click', () => {
    !document.fullscreenElement
      ? document.documentElement.requestFullscreen?.()
      : document.exitFullscreen?.();
  });

  $('immBtnResize')?.addEventListener('click', () => {
    _stretched = !_stretched;
    const left = overlay.querySelector('.imv-left');
    if (left) left.style.width = _stretched ? 'min(52vw, 580px)' : '';
  });

  $('immBtnDynBg')?.addEventListener('click', _toggleDynBg);   // ★

  $('immProgTrack')?.addEventListener('click', e => {
    const ap = $('audioPlayer');
    if (!ap?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    ap.currentTime = ((e.clientX - r.left) / r.width) * ap.duration;
  });

  $('immClose')?.addEventListener('click',    close);
  $('immBtnClose')?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isOpen) close(); });

  // ════════════════════════════════════════════════════════════════
  //  §16 — EXPOSITION
  // ════════════════════════════════════════════════════════════════

  window._openImmersive  = open;
  window._closeImmersive = close;

})();