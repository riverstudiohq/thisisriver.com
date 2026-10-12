/**
 * RiVER particle system — hero/contact particle forms with dispersion streams,
 * mini spheres for the about panels, and the Saturn waveform.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var FORM_SPEED = 0.18;

  /* Particle gradient — Sky → Azure → Cobalt → Royal */
  var STOPS = [
    [0, [168, 220, 255]],
    [0.45, [61, 139, 255]],
    [0.75, [47, 91, 255]],
    [1, [30, 64, 216]]
  ];
  var PLAYED_STOPS = [
    [0, [237, 237, 242]],
    [0.5, [168, 220, 255]],
    [1, [61, 139, 255]]
  ];
  var LUT_SIZE = 64;

  function buildLut(stops) {
    var lut = [];
    for (var i = 0; i < LUT_SIZE; i++) {
      var t = i / (LUT_SIZE - 1);
      var s = 0;
      while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
      var a = stops[s];
      var b = stops[s + 1];
      var k = (t - a[0]) / (b[0] - a[0]);
      lut.push(
        'rgb(' +
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * k) + ',' +
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * k) + ',' +
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * k) + ')'
      );
    }
    return lut;
  }

  var LUT = buildLut(STOPS);
  var PLAYED_LUT = buildLut(PLAYED_STOPS);

  function color(lut, t) {
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return lut[(t * (LUT_SIZE - 1)) | 0];
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    return (rand() + rand() + rand() - 1.5) / 1.5;
  }

  function sizeCanvas(canvas) {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * DPR));
    var h = Math.max(1, Math.round(rect.height * DPR));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: rect.width, h: rect.height };
  }

  /* Pointer: normalized for parallax, client coords for local disturbance */
  var pointer = { x: 0, y: 0, sx: 0, sy: 0, cx: -9999, cy: -9999, active: false };
  window.addEventListener(
    'pointermove',
    function (e) {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      pointer.cx = e.clientX;
      pointer.cy = e.clientY;
      pointer.active = true;
    },
    { passive: true }
  );
  document.addEventListener('pointerleave', function () { pointer.active = false; });
  window.addEventListener('blur', function () { pointer.active = false; });

  /* Divergence-free flow field (curl of a layered stream function) */
  var flowOut = { x: 0, y: 0 };
  function flow(x, y, t) {
    var a = 1.7 * x + 0.4 * t;
    var b = 1.3 * y - 0.3 * t;
    var c = 1.55 * x + 2.9 * y + 0.7 * t;
    var d = 3.3 * x - 2.1 * y - 0.9 * t;
    var dsdx = 1.7 * Math.cos(a) * Math.cos(b) + 0.775 * Math.cos(c) + 0.66 * Math.cos(d);
    var dsdy = -1.3 * Math.sin(a) * Math.sin(b) + 1.45 * Math.cos(c) - 0.42 * Math.cos(d);
    flowOut.x = dsdy;
    flowOut.y = -dsdx;
    return flowOut;
  }

  /* ---------- Particle form: morphing, twisting blob ---------- */

  function Form(opts) {
    var rand = rng(opts.seed);
    var n = opts.count;
    var golden = Math.PI * (3 - Math.sqrt(5));
    var p = opts.squareness;
    this.pts = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var y = 1 - (2 * (i + 0.5)) / n;
      var r = Math.sqrt(1 - y * y);
      var phi = i * golden + (rand() - 0.5) * 0.02;
      var x = Math.cos(phi) * r;
      var z = Math.sin(phi) * r;
      var k = Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p), 1 / p);
      this.pts[i * 3] = x / k;
      this.pts[i * 3 + 1] = y / k;
      this.pts[i * 3 + 2] = z / k;
    }
    this.dispX = new Float32Array(n);
    this.dispY = new Float32Array(n);
    var shed = opts.shed || 0;
    this.shedAmt = new Float32Array(n);
    this.shedPhase = new Float32Array(n);
    this.shedRate = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      this.shedAmt[j] = rand() < shed ? 2 + rand() * 3.5 : 0;
      this.shedPhase[j] = rand() * Math.PI * 2;
      this.shedRate[j] = 0.12 + rand() * 0.2;
    }
    this.n = n;
    this.o = opts;
    this.phase = rand() * Math.PI * 2;
  }

  Form.prototype.draw = function (ctx, cx, cy, R, t, unit, alphaMul, dt, ptr) {
    var o = this.o;
    var pts = this.pts;
    var ph = this.phase;
    var rotY = ph + t * o.spin + pointer.sx * o.parallax;
    var rotX = o.tilt + Math.sin(t * 0.21 + ph) * 0.1 + pointer.sy * o.parallax * 0.5;
    var cY = Math.cos(rotY), sY = Math.sin(rotY);
    var cX = Math.cos(rotX), sX = Math.sin(rotX);
    var F = 3.4;
    var amp = o.morph;
    var sq = o.squash || 1;
    var twist = o.twist || 0;
    var breathe = 1 + 0.025 * Math.sin(t * 0.8 + ph);
    var Rb = R * breathe;
    var fluid = o.fluid == null ? 0.08 : o.fluid;
    var aspect = o.aspect || 1;
    var dash = o.dash || 1;
    var ease = Math.min(1, (dt || 0.016) * 2.8);
    var pr = ptr ? ptr.r : 0;
    var pr2 = pr * pr;

    for (var i = 0; i < this.n; i++) {
      var x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];

      var w1 = Math.sin(x * 2.1 + t * 0.9 + ph) * Math.cos(y * 1.7 - t * 0.7);
      var w2 = Math.sin(z * 2.9 + y * 1.3 + t * 1.15 + ph * 1.7);
      var w3 = Math.sin((x - z) * 3.7 - t * 1.6) * Math.cos(y * 2.3 + t * 0.8);
      var w4 = Math.sin(y * 4.6 - t * 2.1 + Math.sin(x * 1.5 + t * 0.6) * 1.5);
      var d = 1 + amp * (w1 + 0.6 * w2 + 0.4 * w3 + 0.35 * w4);

      var ang = twist * Math.sin(y * 1.6 + t * 0.5);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var tx = x * ca - z * sa;
      var tz = x * sa + z * ca;

      x = tx * d;
      y = y * d * sq;
      z = tz * d;

      /* Liquid domain warp: the surface slides over itself */
      var wx = Math.sin(y * 2.6 + z * 1.4 + t * 1.25 + ph);
      var wy = Math.sin(z * 2.3 - x * 1.6 + t * 1.05);
      var wz = Math.sin(x * 2.8 + y * 1.2 - t * 1.4 + ph);
      x += wx * fluid;
      y += wy * fluid;
      z += wz * fluid;

      var x1 = x * cY + z * sY;
      var z1 = -x * sY + z * cY;
      var y2 = y * cX - z1 * sX;
      var z2 = y * sX + z1 * cX;

      var persp = F / (F - z2);
      var ux = x1 * persp * aspect;
      var uy = y2 * persp;

      var targetX = 0, targetY = 0;
      if (ptr) {
        var ddx = ux - ptr.x, ddy = uy - ptr.y;
        var dd2 = ddx * ddx + ddy * ddy;
        if (dd2 < pr2 && dd2 > 1e-6) {
          var dd = Math.sqrt(dd2);
          var f = 1 - dd / pr;
          f = f * f * ptr.s;
          var nx = ddx / dd, ny = ddy / dd;
          targetX = (nx - ny * 0.9) * f;
          targetY = (ny + nx * 0.9) * f;
        }
      }
      this.dispX[i] += (targetX - this.dispX[i]) * ease;
      this.dispY[i] += (targetY - this.dispY[i]) * ease;

      /* Some points periodically break away from the form, ride the flow, then return */
      var esc = 0;
      var amt = this.shedAmt[i];
      if (amt) {
        esc = Math.sin(t * this.shedRate[i] + this.shedPhase[i]);
        esc = esc > -0.6 ? (esc + 0.6) / 1.6 : 0;
        esc = esc * esc * amt;
        if (esc) {
          var fl = flow(ux * 0.9 + this.shedPhase[i], uy * 0.9, t * 0.25);
          var rl = Math.sqrt(ux * ux + uy * uy) || 1;
          ux += (ux / rl * 0.6 + fl.x * 0.5) * esc;
          uy += (uy / rl * 0.6 + fl.y * 0.5) * esc;
        }
      }

      var px = cx + (ux + this.dispX[i]) * Rb;
      var py = cy + (uy + this.dispY[i]) * Rb;
      var depth = (z2 + 1.25) / 2.5;
      if (depth < 0) depth = 0;
      else if (depth > 1) depth = 1;

      var size = (0.6 + 1.1 * depth) * unit;
      ctx.globalAlpha = (0.22 + 0.78 * depth) * alphaMul * (1 - Math.min(0.75, esc * 0.6));
      ctx.fillStyle = color(LUT, (y2 + 0.85) / 2.1 - depth * 0.12);
      ctx.fillRect(px - (size * dash) / 2, py - size / 2, size * dash, size);
    }
  };

  /* ---------- Stream: particles carried off the form by a flow field ---------- */

  function Stream(opts) {
    var rand = rng(opts.seed);
    var n = opts.count;
    this.o = opts;
    this.n = n;
    this.rand = rand;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    this.t = 0;
    for (var i = 0; i < n; i++) {
      this.spawn(i);
      this.age[i] = rand();
    }
    /* Pre-warm so the stream is already flowing on first paint */
    for (var s = 0; s < 90; s++) this.step(1 / 20, null);
  }

  Stream.prototype.spawn = function (i) {
    var o = this.o;
    var r = this.rand;
    var a = o.angle + gauss(r) * (o.fan || 0);
    this.dirX[i] = Math.cos(a) * (0.7 + r() * 0.6);
    this.dirY[i] = Math.sin(a) * (0.7 + r() * 0.6);
    this.px[i] = o.ox + gauss(r) * o.spawn;
    this.py[i] = o.oy + gauss(r) * o.spawn;
    this.vx[i] = this.dirX[i] * o.speed * 0.4;
    this.vy[i] = this.dirY[i] * o.speed * 0.4;
    this.age[i] = 0;
    this.life[i] = o.life * (0.55 + r() * 0.9);
    this.seed[i] = r();
  };

  Stream.prototype.step = function (dt, ptr) {
    var o = this.o;
    this.t += dt;
    var t = this.t * o.flowSpeed;
    var k = Math.min(1, dt * 1.6);
    var freq = o.freq;
    for (var i = 0; i < this.n; i++) {
      this.age[i] += dt / this.life[i];
      if (this.age[i] >= 1) {
        this.spawn(i);
        continue;
      }
      var x = this.px[i], y = this.py[i];
      var fl = flow(x * freq + this.seed[i] * 0.35, y * freq, t);
      var fx = fl.x, fy = fl.y;
      fl = flow(x * freq * 2.3 + 5.1, y * freq * 2.3 - 2.7, t * 1.4);
      fx += fl.x * 0.45;
      fy += fl.y * 0.45;
      var grow = 0.35 + this.age[i];
      var tx = this.dirX[i] * o.speed + fx * o.turb * grow;
      var ty = this.dirY[i] * o.speed + fy * o.turb * grow;

      if (ptr) {
        var ddx = x - ptr.x, ddy = y - ptr.y;
        var dd2 = ddx * ddx + ddy * ddy;
        if (dd2 < ptr.r * ptr.r && dd2 > 1e-6) {
          var dd = Math.sqrt(dd2);
          var f = (1 - dd / ptr.r) * ptr.s * 3;
          tx += (ddx / dd) * f - (ddy / dd) * f * 0.6;
          ty += (ddy / dd) * f + (ddx / dd) * f * 0.6;
        }
      }

      this.vx[i] += (tx - this.vx[i]) * k;
      this.vy[i] += (ty - this.vy[i]) * k;
      this.px[i] = x + this.vx[i] * dt;
      this.py[i] = y + this.vy[i] * dt;
    }
  };

  Stream.prototype.draw = function (ctx, cx, cy, R, unit, alphaMul) {
    var o = this.o;
    for (var i = 0; i < this.n; i++) {
      var age = this.age[i];
      var fadeIn = age < 0.08 ? age / 0.08 : 1;
      var a = Math.pow(1 - age, 1.2) * fadeIn * o.alpha * (alphaMul == null ? 1 : alphaMul);
      if (a <= 0.01) continue;
      var s = this.seed[i];
      var size = (1.5 - age * 0.7) * unit * (0.7 + s * 0.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = color(LUT, o.hue + s * o.hueRange + age * 0.15);
      ctx.fillRect(cx + this.px[i] * R - size / 2, cy + this.py[i] * R - size / 2, size, size);
    }
  };

  /* ---------- Scenes ---------- */

  var scenes = [];

  function Scene(canvas, build, layout) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layers = build();
    this.layout = layout;
    this.visible = true;
    this.size = sizeCanvas(canvas);
    scenes.push(this);
  }

  Scene.prototype.resize = function () {
    this.size = sizeCanvas(this.canvas);
  };

  Scene.prototype.render = function (t, dt) {
    var ctx = this.ctx;
    var L = this.layout(this.size.w, this.size.h);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (dt) {
      /* Fade the previous frame instead of clearing it, leaving short motion trails */
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.34;
      ctx.fillRect(0, 0, this.size.w, this.size.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      ctx.clearRect(0, 0, this.size.w, this.size.h);
    }
    var unit = Math.max(1.3, 1.9 * L.scale);

    var ptr = null;
    if (pointer.active && !reduceMotion) {
      var rect = this.canvas.getBoundingClientRect();
      var lx = pointer.cx - rect.left;
      var ly = pointer.cy - rect.top;
      if (lx > -40 && ly > -40 && lx < rect.width + 40 && ly < rect.height + 40) {
        ptr = { x: (lx - L.cx) / L.R, y: (ly - L.cy) / L.R, r: 0.7, s: 0.36 };
      }
    }

    for (var i = 0; i < this.layers.streams.length; i++) {
      var st = this.layers.streams[i];
      if (dt) st.step(dt, ptr);
      st.draw(ctx, L.cx, L.cy, L.R, unit, L.alpha);
    }
    this.layers.form.draw(ctx, L.cx, L.cy, L.R, t, unit, L.alpha || 1, dt, ptr);
    ctx.globalAlpha = 1;
  };

  var heroCanvas = document.getElementById('heroParticles');
  var heroArt = document.querySelector('.hero-art');
  var heroWord = document.querySelector('.hero-title');
  if (heroCanvas && heroArt) {
    var hero = heroCanvas.parentElement;
    var heroScale = 0;
    new Scene(
      heroCanvas,
      function () {
        return {
          form: new Form({ seed: 11, count: 2800, squareness: 2.4, morph: 0.12, fluid: 0.22, twist: 0.3, spin: 0.1, tilt: -0.32, parallax: 0.3, squash: 0.74, aspect: 1.6, dash: 2.2, shed: 0.9 }),
          streams: [
            /* Dispersion — off the lower right of the ellipse */
            new Stream({ seed: 21, count: 1300, ox: 0.95, oy: 0.3, spawn: 0.16, angle: 0.65, fan: 0.55, speed: 0.32, turb: 0.3, freq: 1.1, flowSpeed: 0.6, life: 6.5, alpha: 0.95, hue: 0.35, hueRange: 0.5 }),
            /* Drift — upper left, sparse and slow */
            new Stream({ seed: 31, count: 480, ox: -0.85, oy: -0.75, spawn: 0.18, angle: -2.6, fan: 0.6, speed: 0.17, turb: 0.24, freq: 1.4, flowSpeed: 0.45, life: 8, alpha: 0.6, hue: 0.05, hueRange: 0.4 }),
            /* Field — loose particles wandering across the whole hero */
            new Stream({ seed: 41, count: 2600, ox: 0, oy: 0, spawn: 5, angle: 0, fan: 3.1, speed: 0.04, turb: 0.3, freq: 0.8, flowSpeed: 0.4, life: 14, alpha: 0.45, hue: 0.1, hueRange: 0.8 })
          ]
        };
      },
      function (w, h) {
        var heroRect = hero.getBoundingClientRect();
        var scale = Math.max(0.5, Math.min(1, w / 1440));
        if (scale !== heroScale) {
          heroScale = scale;
          hero.style.setProperty('--hero-scale', scale);
        }
        var ox = w / 2;
        var oy = h * 0.4778;
        if (heroWord) {
          var tr = heroWord.getBoundingClientRect();
          ox = tr.left + tr.width / 2 - heroRect.left;
          oy = tr.top + tr.height / 2 - heroRect.top + 20 * scale;
          var cyPx = Math.round(oy) + 'px';
          if (hero.style.getPropertyValue('--hero-cy') !== cyPx) hero.style.setProperty('--hero-cy', cyPx);
        }
        return {
          cx: ox - 33 * scale,
          cy: oy + 46 * scale,
          R: 300 * scale,
          scale: scale,
          alpha: 0.55
        };
      }
    );
  }

  var contactCanvas = document.getElementById('contactParticles');
  if (contactCanvas) {
    new Scene(
      contactCanvas,
      function () {
        return {
          form: new Form({ seed: 47, count: 2000, squareness: 2.6, morph: 0.16, fluid: 0.1, twist: 0.4, spin: -0.1, tilt: -0.42, parallax: 0.3, squash: 0.88 }),
          streams: [
            /* Dissolve — sweeping down-left under the headline */
            new Stream({ seed: 53, count: 1400, ox: -0.72, oy: 0.38, spawn: 0.16, angle: 2.53, fan: 0.55, speed: 0.36, turb: 0.32, freq: 0.9, flowSpeed: 0.55, life: 8.5, alpha: 0.85, hue: 0.3, hueRange: 0.55 })
          ]
        };
      },
      function (w, h) {
        var scale = Math.max(0.5, Math.min(1, w / 1440));
        var narrow = w < 720;
        return {
          cx: narrow ? w * 0.82 : w * 0.844,
          cy: narrow ? h * 0.66 : 347 * Math.max(scale, 0.8),
          R: 205 * scale,
          scale: scale
        };
      }
    );
  }

  var caseCanvas = document.getElementById('caseParticles');
  if (caseCanvas) {
    var caseSeed = parseInt(caseCanvas.getAttribute('data-seed'), 10) || 5;
    new Scene(
      caseCanvas,
      function () {
        return {
          form: new Form({ seed: caseSeed, count: 1800, squareness: 2.8, morph: 0.15, fluid: 0.1, twist: 0.45, spin: 0.1, tilt: -0.35, parallax: 0.3, squash: 0.95 }),
          streams: [
            new Stream({ seed: caseSeed + 7, count: 1000, ox: 0.72, oy: 0.4, spawn: 0.16, angle: 0.75, fan: 0.55, speed: 0.4, turb: 0.34, freq: 1, flowSpeed: 0.5, life: 8.5, alpha: 0.8, hue: 0.3, hueRange: 0.55 })
          ]
        };
      },
      function (w, h) {
        var scale = Math.max(0.45, Math.min(1, w / 1440));
        var narrow = w < 900;
        return {
          cx: narrow ? w * 0.86 : w * 0.8,
          cy: narrow ? h * 0.2 : h * 0.44,
          R: narrow ? 90 : 165 * scale,
          scale: scale,
          alpha: narrow ? 0.55 : 1
        };
      }
    );
  }

  /* ---------- Mini spheres (about panels) ---------- */

  var minis = [];
  document.querySelectorAll('.mini-particle').forEach(function (canvas) {
    var seed = parseInt(canvas.getAttribute('data-seed'), 10) || 1;
    var rand = rng(seed * 97);
    var isSphere = canvas.getAttribute('data-shape') === 'sphere';
    minis.push({
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      visible: true,
      form: new Form({
        seed: seed * 13,
        count: 240,
        squareness: isSphere ? 2 : 2.2 + rand() * 1.6,
        morph: isSphere ? 0.03 : 0.08 + rand() * 0.08,
        spin: (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.25),
        tilt: -0.2 - rand() * 0.4,
        parallax: 0,
        squash: 0.85 + rand() * 0.25
      })
    });
  });

  function renderMini(m, t, dt) {
    var size = 64;
    if (m.canvas.width !== size * DPR) {
      m.canvas.width = size * DPR;
      m.canvas.height = size * DPR;
    }
    var ctx = m.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, size, size);
    m.form.draw(ctx, 32, 32, 22, t, 1.15, 1, dt, null);
    ctx.globalAlpha = 1;
  }

  /* ---------- Saturn waveform ---------- */

  var wave = null;
  var waveCanvas = document.getElementById('saturnWave');
  var saturn = document.getElementById('saturnVisual');
  var playhead = document.getElementById('saturnPlayhead');
  var timeLabel = document.getElementById('saturnTime');

  if (waveCanvas && saturn) {
    var COLS = 190;
    var env = new Float32Array(COLS);
    var wr = rng(7);
    var bumps = [
      [0.06, 0.12, 0.03], [0.17, 0.22, 0.03], [0.26, 0.2, 0.025], [0.35, 0.62, 0.04],
      [0.45, 0.95, 0.04], [0.56, 0.6, 0.04], [0.66, 0.78, 0.035], [0.75, 0.95, 0.04],
      [0.83, 0.55, 0.035], [0.91, 0.28, 0.03], [0.97, 0.12, 0.02]
    ];
    for (var c = 0; c < COLS; c++) {
      var u = c / (COLS - 1);
      var v = 0.04;
      for (var b = 0; b < bumps.length; b++) {
        var dxu = (u - bumps[b][0]) / bumps[b][2];
        v += bumps[b][1] * Math.exp(-dxu * dxu);
      }
      v *= 0.85 + wr() * 0.3;
      env[c] = Math.min(1, v);
    }
    wave = { canvas: waveCanvas, ctx: waveCanvas.getContext('2d'), env: env, cols: COLS, size: sizeCanvas(waveCanvas), visible: true, energy: 0.6 };
  }

  function audioState() {
    var A = window.RiverSiteAudio && window.RiverSiteAudio.audio;
    if (!A) return { frac: 0, playing: false, cur: 0, dur: 0, audio: null };
    var dur = isFinite(A.duration) ? A.duration : 0;
    return { frac: dur ? A.currentTime / dur : 0, playing: !A.paused, cur: A.currentTime, dur: dur, audio: A };
  }

  function fmt(s) {
    if (!isFinite(s) || s <= 0) return '00:00';
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  var lastLabel = '';
  function renderWave(t, dt) {
    var w = wave;
    var st = audioState();
    var target = st.playing ? 1 : 0.6;
    w.energy += (target - w.energy) * Math.min(1, (dt || 0.016) * 3);

    var W = w.size.w, H = w.size.h;
    var ctx = w.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var colGap = W / w.cols;
    var rowGap = 4;
    var maxHalf = Math.floor((H / 2) / rowGap);
    var mid = H / 2;
    var headX = st.frac * W;
    var dot = Math.max(1.2, Math.min(1.9, colGap * 0.32));

    for (var i = 0; i < w.cols; i++) {
      var x = i * colGap + colGap / 2;
      var e = w.env[i];
      var mod = 0.8 + 0.16 * Math.sin(t * 1.6 + i * 0.21) + 0.08 * Math.sin(t * 3.7 + i * 0.83);
      if (st.playing) mod += 0.14 * Math.sin(t * 8.5 + i * 0.47) * e;
      var amp = e * mod * w.energy / 0.85;
      var half = Math.max(0, Math.round(amp * maxHalf));
      var played = x < headX;
      var near = Math.abs(x - headX) < colGap * 6 && st.dur > 0;

      for (var k = -half; k <= half; k++) {
        var edge = half ? Math.abs(k) / (half + 1) : 0;
        var a = 1 - edge * edge * 0.7;
        if (near) a = Math.min(1, a + 0.2);
        ctx.globalAlpha = a * (played ? 0.95 : 0.85);
        ctx.fillStyle = played
          ? color(PLAYED_LUT, edge * 0.9 + 0.05)
          : color(LUT, 0.2 + edge * 0.8);
        ctx.fillRect(x - dot / 2, mid + k * rowGap - dot / 2, dot, dot);
      }
    }
    ctx.globalAlpha = 1;

    if (playhead) {
      var canvasLeft = waveCanvas.offsetLeft;
      playhead.style.left = canvasLeft + headX + 'px';
    }
    var label = fmt(st.cur) + ' / ' + (st.dur ? fmt(st.dur) : '--:--');
    if (label !== lastLabel && timeLabel) {
      timeLabel.textContent = label;
      lastLabel = label;
      saturn.setAttribute('aria-valuenow', String(Math.round(st.frac * 100)));
      saturn.setAttribute('aria-valuetext', label);
    }
  }

  if (saturn) {
    var seekTo = function (frac) {
      var st = audioState();
      if (!st.audio || !st.dur) return;
      st.audio.currentTime = Math.max(0, Math.min(0.999, frac)) * st.dur;
      if (window.RiverSiteAudio.persist) window.RiverSiteAudio.persist();
      if (reduceMotion && wave) renderWave(0, 0);
    };
    saturn.addEventListener('pointerdown', function (e) {
      var r = waveCanvas.getBoundingClientRect();
      seekTo((e.clientX - r.left) / r.width);
    });
    saturn.addEventListener('keydown', function (e) {
      var st = audioState();
      if (!st.dur) return;
      if (e.key === 'ArrowRight') { seekTo(st.frac + 0.05); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { seekTo(st.frac - 0.05); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') {
        if (window.RiverSiteAudio) window.RiverSiteAudio.togglePlay();
        e.preventDefault();
      }
    });
  }

  /* ---------- Visibility, resize, loop ---------- */

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var target = en.target;
        scenes.forEach(function (s) { if (s.canvas === target) s.visible = en.isIntersecting; });
        minis.forEach(function (m) { if (m.canvas === target) m.visible = en.isIntersecting; });
        if (wave && wave.canvas === target) wave.visible = en.isIntersecting;
      });
    }, { rootMargin: '120px' });
    scenes.forEach(function (s) { io.observe(s.canvas); });
    minis.forEach(function (m) { io.observe(m.canvas); });
    if (wave) io.observe(wave.canvas);
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      scenes.forEach(function (s) { s.resize(); });
      if (wave) wave.size = sizeCanvas(wave.canvas);
      if (reduceMotion) renderAll(4, 0);
    }, 120);
  });

  function renderAll(t, dt) {
    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;
    scenes.forEach(function (s) { if (s.visible) s.render(t * FORM_SPEED, dt * FORM_SPEED); });
    minis.forEach(function (m) { if (m.visible) renderMini(m, t, dt); });
    if (wave && wave.visible) renderWave(t, dt);
  }

  if (reduceMotion) {
    renderAll(4, 0);
    var A = window.RiverSiteAudio && window.RiverSiteAudio.audio;
    if (A && wave) {
      A.addEventListener('timeupdate', function () { renderWave(4, 0); });
      A.addEventListener('loadedmetadata', function () { renderWave(4, 0); });
    }
  } else {
    var start = performance.now();
    var last = start;
    var frame = function (now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      renderAll((now - start) / 1000, dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- Card cover scaling + reveal ---------- */

  var covers = document.querySelectorAll('.card-cover');
  function scaleCover(el) {
    el.style.setProperty('--cover-scale', el.clientWidth / 421.33);
  }
  covers.forEach(scaleCover);
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function (entries) {
      entries.forEach(function (en) { scaleCover(en.target); });
    });
    covers.forEach(function (el) { ro.observe(el); });
  } else {
    window.addEventListener('resize', function () { covers.forEach(scaleCover); });
  }

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-visible');
          rio.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { rio.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }
})();
