/* =====================================================================
 * main.js — ตัวควบคุมแอนิเมชันทั้งหมดของหน้าอธิบาย Server-Driven UI
 *
 * แต่ละส่วนแยกเป็นฟังก์ชัน init...() อิสระจากกัน
 *   initChrome()      แถบนำทาง + progress + ปุ่มปิดแอนิเมชัน
 *   initReveal()      เอฟเฟกต์ค่อย ๆ โผล่ตอนเลื่อนถึง
 *   initRace()        02 · แข่งกันปล่อยของ
 *   initFlow()        03 · แผนภาพการไหลของข้อมูล (SVG + packet)
 *   initMapping()     04 · JSON → registry → UI ทีละบรรทัด
 *   initPlayground()  05 · แก้ JSON แล้วเรนเดอร์สด
 *   initOta()         06 · เปลี่ยน UI โดยไม่อัปเดตแอป
 * ===================================================================== */

(function () {
  'use strict';

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* หน่วงเวลาแบบยกเลิกได้ — ใช้กับแอนิเมชันที่ผู้ใช้กดรีเซ็ตกลางคันได้ */
  function sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      var id = setTimeout(resolve, motionOff() ? Math.min(ms, 60) : ms);
      if (signal) {
        signal.onAbort(function () { clearTimeout(id); reject(new Error('aborted')); });
      }
    });
  }
  function makeSignal() {
    var listeners = [], aborted = false;
    return {
      get aborted() { return aborted; },
      onAbort: function (fn) { aborted ? fn() : listeners.push(fn); },
      abort: function () { aborted = true; listeners.splice(0).forEach(function (fn) { fn(); }); }
    };
  }
  function motionOff() { return document.body.classList.contains('no-motion'); }

  /* ---------------------------------------------------------- CHROME */
  function initChrome() {
    var progress = $('#scrollProgress');
    var links = $$('.nav__links a');
    var sections = links.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);

    function onScroll() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';

      var pos = window.scrollY + window.innerHeight * 0.35;
      var current = -1;
      sections.forEach(function (sec, i) { if (sec.offsetTop <= pos) current = i; });
      links.forEach(function (a, i) { a.classList.toggle('is-active', i === current); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    /* ปุ่มเปิด/ปิดแอนิเมชัน — เผื่อคนที่อ่านเนื้อหาอย่างเดียว หรือเวียนหัวกับ motion */
    var toggle = $('#motionToggle');
    var label = $('.motion-toggle__label', toggle);
    var icon = $('.motion-toggle__icon', toggle);
    var prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var saved = null;
    try { saved = localStorage.getItem('sdui-motion'); } catch (e) { /* โหมด private */ }
    var enabled = saved !== null ? saved === 'on' : !prefersReduce;

    function apply() {
      document.body.classList.toggle('no-motion', !enabled);
      toggle.setAttribute('aria-pressed', String(!enabled));
      label.textContent = 'แอนิเมชัน: ' + (enabled ? 'เปิด' : 'ปิด');
      /* มือถือซ่อนข้อความไว้ ไอคอนจึงต้องบอกสถานะเองได้ */
      icon.textContent = enabled ? '🎬' : '⏸';
      toggle.setAttribute('title', enabled ? 'ปิดแอนิเมชัน' : 'เปิดแอนิเมชัน');
    }
    toggle.addEventListener('click', function () {
      enabled = !enabled;
      try { localStorage.setItem('sdui-motion', enabled ? 'on' : 'off'); } catch (e) {}
      apply();
    });
    apply();
  }

  /* ---------------------------------------------------------- REVEAL */
  function initReveal() {
    var items = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------- 02 · RACE */
  var RACE = {
    classic: [
      { ms: 900,  clock: '+2 ชั่วโมง' },
      { ms: 1000, clock: '+1 วัน' },
      { ms: 700,  clock: '+1 วัน 2 ชม.' },
      { ms: 1500, clock: '+4 วัน' },
      { ms: 700,  clock: '+4 วัน 6 ชม.' },
      { ms: 1500, clock: '+7 วัน ขึ้นไป' }
    ],
    sdui: [
      { ms: 800, clock: '+2 นาที' },
      { ms: 500, clock: '+2 นาที 20 วิ' },
      { ms: 600, clock: '+2 นาที 21 วิ' },
      { ms: 500, clock: 'รวม ~3 นาที' }
    ]
  };

  function initRace() {
    var lanes = {
      classic: $('[data-lane="classic"]'),
      sdui: $('[data-lane="sdui"]')
    };
    var startBtn = $('#raceStart');
    var resetBtn = $('#raceReset');
    var signal = null;

    function reset() {
      if (signal) signal.abort();
      signal = null;
      Object.keys(lanes).forEach(function (key) {
        $$('[data-step]', lanes[key]).forEach(function (li) {
          li.classList.remove('is-running', 'is-done');
        });
        $('[data-clock]', lanes[key]).textContent = '—';
        var result = $('[data-result]', lanes[key]);
        result.textContent = 'ผู้ใช้ยังเห็นของเดิม…';
        result.classList.remove('is-win', 'is-late');
      });
      startBtn.disabled = false;
      startBtn.textContent = '▶ เริ่มจำลอง';
    }

    function runLane(key, steps, finalText, winner, sig) {
      var lane = lanes[key];
      var items = $$('[data-step]', lane);
      var clock = $('[data-clock]', lane);

      return steps.reduce(function (chain, step, i) {
        return chain.then(function () {
          if (sig.aborted) return Promise.reject(new Error('aborted'));
          items[i].classList.add('is-running');
          clock.textContent = step.clock;
          return sleep(step.ms, sig).then(function () {
            items[i].classList.remove('is-running');
            items[i].classList.add('is-done');
          });
        });
      }, Promise.resolve()).then(function () {
        var result = $('[data-result]', lane);
        result.textContent = finalText;
        result.classList.add(winner ? 'is-win' : 'is-late');
      });
    }

    startBtn.addEventListener('click', function () {
      reset();
      signal = makeSignal();
      var sig = signal;
      startBtn.disabled = true;
      startBtn.textContent = '⏳ กำลังจำลอง…';

      Promise.all([
        runLane('classic', RACE.classic, '🐢 กว่าจะถึงผู้ใช้ทุกคน ~7 วัน (และบางคนไม่อัปเดตเลย)', false, sig),
        runLane('sdui', RACE.sdui, '⚡ ผู้ใช้ทุกคนเห็น UI ใหม่ภายในไม่กี่นาที', true, sig)
      ]).then(function () {
        startBtn.disabled = false;
        startBtn.textContent = '↻ จำลองอีกครั้ง';
      }).catch(function () { /* ถูกยกเลิกด้วยปุ่มรีเซ็ต */ });
    });

    resetBtn.addEventListener('click', reset);
  }

  /* ------------------------------------------------------- 03 · FLOW */
  var FLOW_STEPS = [
    {
      title: '① ไคลเอนต์ขอ “หน้าจอ” ไม่ใช่แค่ “ข้อมูล”',
      desc: 'ผู้ใช้เปิดหน้าสินค้า แอปยังไม่รู้เลยว่าหน้านี้มีอะไรบ้าง จึงยิงคำขอไปถามเซิร์ฟเวอร์ พร้อมบอกบริบทของตัวเอง เช่น เวอร์ชันแอป แพลตฟอร์ม ภาษา และผู้ใช้คนนี้คือใคร',
      code: 'GET /screens/product/8823\n  X-App-Version: 1.0.0\n  X-Platform: ios\n  X-Schema-Version: 3',
      nodes: ['nClient'], wires: ['p1'], packets: [{ path: 'p1', label: 'REQ' }]
    },
    {
      title: '② เซิร์ฟเวอร์รวบรวมวัตถุดิบ',
      desc: 'เซิร์ฟเวอร์ (มักเป็นชั้น BFF — Backend For Frontend) ไปหยิบสองอย่าง: เลย์เอาต์/แคมเปญที่ทีมธุรกิจตั้งไว้ใน CMS และข้อมูลจริงจากฐานข้อมูล แล้วเอามาผสมกัน',
      code: 'layout  = cms.getLayout("product", ctx)\nproduct = db.findProduct(8823)\nflags   = experiments.assign(user)',
      nodes: ['nServer', 'nCms', 'nDb'], wires: ['p2', 'p3'],
      packets: [{ path: 'p2', label: 'CMS' }, { path: 'p3', label: 'DB' }]
    },
    {
      title: '③ ประกอบเป็นพิมพ์เขียว JSON',
      desc: 'ตรงนี้คือจุดที่ “การตัดสินใจเรื่อง UI” เกิดขึ้น — เซิร์ฟเวอร์เลือกว่าจะใส่ component อะไร เรียงลำดับยังไง ใครเห็นแบบไหน แล้วส่งออกมาเป็นโครงสร้างข้อมูลล้วน ๆ (ไม่ใช่โค้ด)',
      code: '{\n  "screenId": "product",\n  "schemaVersion": 3,\n  "components": [ … ]\n}',
      nodes: ['nServer'], wires: [], packets: [], build: true
    },
    {
      title: '④ ส่ง JSON กลับไปให้ไคลเอนต์',
      desc: 'สิ่งที่วิ่งข้ามเน็ตเวิร์กคือข้อความ JSON ธรรมดา ขนาดไม่กี่ KB ไม่มีสคริปต์ ไม่มี HTML ทำให้ตรวจสอบง่ายและปลอดภัยกว่าการส่งโค้ดมารัน',
      code: 'HTTP/1.1 200 OK\nContent-Type: application/json\nETag: "cfg-v42"      ← ใช้ทำ cache',
      nodes: ['nServer', 'nClient'], wires: ['p4'], packets: [{ path: 'p4', label: 'JSON', json: true }], build: true
    },
    {
      title: '⑤ ไคลเอนต์แปลง JSON เป็น UI จริง',
      desc: 'ไคลเอนต์ไล่อ่านทีละ node เอา type ไปเปิด “ตารางทะเบียน component” แล้วสร้าง view ของจริงตามลำดับที่เซิร์ฟเวอร์กำหนด พร้อมเก็บ JSON ล่าสุดลง cache เผื่อครั้งหน้าเปิดแบบออฟไลน์',
      code: 'json.components.forEach(node => {\n  const View = registry[node.type] ?? Fallback\n  screen.add(View(node))\n})\ncache.save(json)',
      nodes: ['nClient'], wires: [], packets: [], build: true, render: true
    }
  ];

  /* -------------------------------------------------------------------
   * ผังของแผนภาพ — เก็บเป็น "ข้อมูล" ชุดเดียว แล้ววางตำแหน่งใหม่ตามขนาดจอ
   *   col = มือถือ/แท็บเล็ตแนวตั้ง — เรียงบนลงล่าง viewBox แคบ ตัวอักษรจึงใหญ่
   *   row = จอกว้าง — เรียงซ้ายไปขวา
   * เดิมแผนภาพเขียนตายตัวใน HTML เป็น viewBox 960 กว้าง พอย่อลงมือถือ
   * ตัวอักษรเหลือ ~4px อ่านไม่ออก จึงเปลี่ยนมาสร้างด้วย JS เพื่อสลับผังได้
   * ----------------------------------------------------------------- */
  var DIAGRAM_NODES = [
    { id: 'nClient', title: '📱 ไคลเอนต์',    sub: 'แอป / เว็บ',          inner: 'mini' },
    { id: 'nServer', title: '🛰️ BFF / API',   sub: 'ประกอบหน้าจอ',        inner: 'json' },
    { id: 'nCms',    title: '🧰 CMS / Config', sub: 'เลย์เอาต์, โปรโมชัน' },
    { id: 'nDb',     title: '🗄️ ฐานข้อมูล',   sub: 'ข้อมูลสินค้า, ผู้ใช้' }
  ];

  var LAYOUTS = {
    col: {
      viewBox: '0 0 420 544',
      maxWidth: '460px',
      font: { title: 19, sub: 13, label: 15, packet: 11 },
      packetR: 16,
      titleDy: 32, subDy: 54,
      nodes: {
        nClient: { x: 50,  y: 10,  w: 320, h: 150, r: 22 },
        nServer: { x: 50,  y: 250, w: 320, h: 150, r: 22 },
        nCms:    { x: 16,  y: 456, w: 184, h: 76,  r: 18 },
        nDb:     { x: 220, y: 456, w: 184, h: 76,  r: 18 }
      },
      mini: [
        { x: 84, y: 74,  w: 252, h: 22, r: 6 },
        { x: 84, y: 102, w: 180, h: 10, r: 4 },
        { x: 84, y: 117, w: 252, h: 10, r: 4 },
        { x: 84, y: 135, w: 252, h: 18, r: 8, cta: true }
      ],
      json: { x: 84, y: 316, step: 16, h: 9, widths: [230, 180, 210, 145, 195] },
      wires: {
        p1: 'M282,164 C282,196 282,216 282,246',
        p2: 'M150,404 C150,428 120,436 108,452',
        p3: 'M270,404 C270,428 300,436 312,452',
        p4: 'M138,246 C138,216 138,196 138,164'
      },
      labels: [
        { t: '①', x: 300, y: 212, anchor: 'start' },
        { t: '④', x: 120, y: 212, anchor: 'end' }
      ]
    },
    row: {
      viewBox: '0 0 880 360',
      maxWidth: '',
      font: { title: 18, sub: 14, label: 14, packet: 9 },
      packetR: 14,
      titleDy: 33, subDy: 56,
      nodes: {
        nClient: { x: 30,  y: 110, w: 190, h: 190, r: 20 },
        nServer: { x: 350, y: 110, w: 180, h: 180, r: 20 },
        nCms:    { x: 660, y: 40,  w: 196, h: 86,  r: 16 },
        nDb:     { x: 660, y: 240, w: 196, h: 86,  r: 16 }
      },
      mini: [
        { x: 58, y: 182, w: 134, h: 26, r: 6 },
        { x: 58, y: 216, w: 100, h: 12, r: 4 },
        { x: 58, y: 236, w: 134, h: 12, r: 4 },
        { x: 58, y: 262, w: 134, h: 24, r: 8, cta: true }
      ],
      json: { x: 382, y: 186, step: 16, h: 9, widths: [116, 92, 106, 74, 98] },
      wires: {
        p1: 'M220,180 C280,180 290,145 350,145',
        p2: 'M530,135 C580,115 610,82 658,82',
        p3: 'M530,215 C580,245 610,282 658,282',
        p4: 'M350,240 C290,240 280,232 220,232'
      },
      labels: [
        { t: '① ขอหน้าจอ',     x: 285, y: 128 },
        { t: '② ดึงเลย์เอาต์',  x: 596, y: 122 },
        { t: '② ดึงข้อมูล',     x: 596, y: 232 },
        { t: '④ ส่ง JSON กลับ', x: 285, y: 272 }
      ]
    }
  };

  function initFlow() {
    var svg = $('#flowSvg');
    if (!svg) return;

    var NS = 'http://www.w3.org/2000/svg';
    var stepsBar = $('#flowSteps');
    var titleEl = $('#flowTitle');
    var descEl = $('#flowDesc');
    var codeEl = $('#flowCode');
    var badge = $('#flowBadge');
    var playBtn = $('#flowPlay');
    var current = -1;
    var playing = false;
    var token = 0;
    var layout = null;
    var mode = '';

    function svgEl(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }
    function svgText(str, x, y, cls, size, anchor) {
      var t = svgEl('text', { x: x, y: y, class: cls, 'font-size': size });
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = str;
      return t;
    }
    function pickMode() {
      return window.matchMedia('(min-width: 900px)').matches ? 'row' : 'col';
    }

    /* วาดแผนภาพทั้งหมดใหม่จาก LAYOUTS[next] */
    function build(next) {
      mode = next;
      layout = LAYOUTS[mode];
      svg.textContent = '';
      svg.setAttribute('viewBox', layout.viewBox);
      svg.style.maxWidth = layout.maxWidth;
      svg.style.marginInline = layout.maxWidth ? 'auto' : '';

      /* เส้นก่อน เพื่อให้กล่องทับเส้นเสมอ */
      Object.keys(layout.wires).forEach(function (id) {
        svg.appendChild(svgEl('path', { id: id, class: 'wire', d: layout.wires[id] }));
      });

      DIAGRAM_NODES.forEach(function (n) {
        var box = layout.nodes[n.id];
        var cx = box.x + box.w / 2;
        var g = svgEl('g', { class: 'node', id: n.id });
        g.appendChild(svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: box.r }));
        g.appendChild(svgText(n.title, cx, box.y + layout.titleDy, 'node__t', layout.font.title));
        g.appendChild(svgText(n.sub, cx, box.y + layout.subDy, 'node__s', layout.font.sub));

        if (n.inner === 'mini') {
          var mini = svgEl('g', { id: 'clientUI', class: 'mini' });
          layout.mini.forEach(function (m) {
            mini.appendChild(svgEl('rect', {
              class: 'mini__el' + (m.cta ? ' mini__el--cta' : ''),
              x: m.x, y: m.y, width: m.w, height: m.h, rx: m.r
            }));
          });
          g.appendChild(mini);
        }
        if (n.inner === 'json') {
          var jl = svgEl('g', { id: 'serverJson', class: 'jsonlines' });
          layout.json.widths.forEach(function (w, i) {
            jl.appendChild(svgEl('rect', {
              x: layout.json.x, y: layout.json.y + i * layout.json.step,
              width: w, height: layout.json.h, rx: 4
            }));
          });
          g.appendChild(jl);
        }
        svg.appendChild(g);
      });

      (layout.labels || []).forEach(function (l) {
        svg.appendChild(svgText(l.t, l.x, l.y, 'wire__label', layout.font.label, l.anchor || 'middle'));
      });
    }

    /* ปุ่มเลขลำดับขั้น */
    var buttons = FLOW_STEPS.map(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(i + 1);
      b.setAttribute('aria-label', 'ขั้นตอนที่ ' + (i + 1));
      b.addEventListener('click', function () { stopPlaying(); goTo(i); });
      stepsBar.appendChild(b);
      return b;
    });

    /* ---- ยิง packet วิ่งไปตามเส้น path ด้วย requestAnimationFrame ---- */
    function sendPacket(pathId, label, isJson, myToken) {
      var path = svg.querySelector('#' + pathId);
      if (!path) return;
      var total = path.getTotalLength();

      var g = svgEl('g', { class: 'flow-packet' });
      g.appendChild(svgEl('circle', { r: layout.packetR, class: 'packet' + (isJson ? ' packet--json' : '') }));
      var t = svgText(label, 0, 0, 'packet__t', layout.font.packet);
      t.setAttribute('dy', (layout.font.packet * 0.35).toFixed(1));
      g.appendChild(t);
      svg.appendChild(g);

      if (motionOff()) {
        var mid = path.getPointAtLength(total / 2);
        g.setAttribute('transform', 'translate(' + mid.x + ',' + mid.y + ')');
        setTimeout(function () { g.remove(); }, 400);
        return;
      }

      var duration = 1100;
      var start = null;
      function frame(now) {
        if (myToken !== token) { g.remove(); return; }
        if (start === null) start = now;
        var p = Math.min((now - start) / duration, 1);
        var eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        var pt = path.getPointAtLength(total * eased);
        g.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
        g.setAttribute('opacity', String(p < 0.1 ? p / 0.1 : p > 0.9 ? (1 - p) / 0.1 : 1));
        if (p < 1) requestAnimationFrame(frame); else g.remove();
      }
      requestAnimationFrame(frame);
    }

    function clearVisuals() {
      token++;
      $$('.flow-packet', svg).forEach(function (g) { g.remove(); });
      $$('.wire', svg).forEach(function (w) { w.classList.remove('is-hot'); });
      $$('.node', svg).forEach(function (n) { n.classList.remove('is-active'); });
      var sj = svg.querySelector('#serverJson');
      var cu = svg.querySelector('#clientUI');
      if (sj) sj.classList.remove('is-building');
      if (cu) cu.classList.remove('is-on');
    }

    function goTo(index) {
      current = Math.max(0, Math.min(FLOW_STEPS.length - 1, index));
      var step = FLOW_STEPS[current];
      clearVisuals();
      var myToken = token;

      buttons.forEach(function (b, i) {
        b.classList.toggle('is-active', i === current);
        b.classList.toggle('is-past', i < current);
      });

      step.nodes.forEach(function (id) {
        var n = svg.querySelector('#' + id);
        if (n) n.classList.add('is-active');
      });
      step.wires.forEach(function (id) {
        var w = svg.querySelector('#' + id);
        if (w) w.classList.add('is-hot');
      });

      /* สถานะสะสม: พอ JSON ถูกสร้างแล้ว ก็ควรคาอยู่ในขั้นถัด ๆ ไป */
      var sj = svg.querySelector('#serverJson');
      var cu = svg.querySelector('#clientUI');
      if (sj && FLOW_STEPS.slice(0, current + 1).some(function (s) { return s.build; })) {
        sj.classList.add('is-building');
      }
      if (cu && step.render) cu.classList.add('is-on');

      step.packets.forEach(function (pk, i) {
        setTimeout(function () { sendPacket(pk.path, pk.label, pk.json, myToken); }, i * 220);
      });

      titleEl.textContent = step.title;
      descEl.textContent = step.desc;
      codeEl.textContent = step.code;
      badge.textContent = 'ขั้นที่ ' + (current + 1) + ' / ' + FLOW_STEPS.length;
    }

    function stopPlaying() {
      playing = false;
      playBtn.textContent = current >= FLOW_STEPS.length - 1 ? '↻ เล่นใหม่' : '▶ เล่น';
    }

    function play() {
      playing = true;
      playBtn.textContent = '⏸ หยุด';
      var i = 0;
      (function next() {
        if (!playing) return;
        if (i >= FLOW_STEPS.length) { stopPlaying(); return; }
        goTo(i++);
        setTimeout(next, motionOff() ? 700 : 2600);
      })();
    }

    playBtn.addEventListener('click', function () {
      if (playing) { stopPlaying(); return; }
      play();
    });
    $('#flowPrev').addEventListener('click', function () { stopPlaying(); goTo(current - 1); });
    $('#flowNext').addEventListener('click', function () { stopPlaying(); goTo(current + 1); });

    build(pickMode());

    /* หมุนจอ / ย่อขยายหน้าต่าง แล้วข้ามเส้นแบ่ง → วางผังใหม่ แล้วคงขั้นเดิมไว้ */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var next = pickMode();
        if (next === mode) return;
        build(next);
        if (current >= 0) goTo(current);
      }, 180);
    });

    /* เริ่มเล่นอัตโนมัติครั้งเดียวเมื่อผู้ใช้เลื่อนมาถึงส่วนนี้ */
    if ('IntersectionObserver' in window) {
      var once = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          once.disconnect();
          if (current === -1) play();
        }
      }, { threshold: 0.25 });
      once.observe($('.flow'));
    } else {
      goTo(0);
    }
  }

  /* ---------------------------------------------------- 04 · MAPPING */
  var MAP_STEPS = [
    { type: 'image',   lines: ['  { "type": "image",  "label": "👟", "height": 118 },'],
      node: { type: 'image', label: '👟', height: 118 } },
    { type: 'badge',   lines: ['  { "type": "badge",  "tone": "danger", "value": "ลด 20%" },'],
      node: { type: 'badge', tone: 'danger', value: 'ลด 20%' } },
    { type: 'text',    lines: ['  { "type": "text",   "variant": "title",', '    "value": "รองเท้าวิ่ง Aero X" },'],
      node: { type: 'text', variant: 'title', value: 'รองเท้าวิ่ง Aero X' } },
    { type: 'rating',  lines: ['  { "type": "rating", "value": 4.5, "count": 218 },'],
      node: { type: 'rating', value: 4.5, count: 218 } },
    { type: 'text',    lines: ['  { "type": "text",   "variant": "body",', '    "value": "น้ำหนักเบา พื้นรองรับแรงกระแทก" },'],
      node: { type: 'text', variant: 'body', value: 'น้ำหนักเบา พื้นรองรับแรงกระแทก เหมาะกับวิ่งระยะไกล' } },
    { type: 'divider', lines: ['  { "type": "divider" },'],
      node: { type: 'divider' } },
    { type: 'button',  lines: ['  { "type": "button", "tone": "primary",', '    "value": "ซื้อเลย ฿2,490",', '    "action": { "kind": "addToCart", "id": 8823 } }'],
      node: { type: 'button', tone: 'primary', value: 'ซื้อเลย ฿2,490' } },
    { type: 'flashsale', lines: ['  ,{ "type": "flashsale", "endsIn": 3600 }  ← type ใหม่'],
      node: { type: 'flashsale', endsIn: 3600 } }
  ];

  /* ระบายสี JSON แบบง่าย ๆ ด้วย regex เดียว (คีย์ / สตริง / ตัวเลข / คอมเมนต์) */
  function highlightJson(line) {
    var out = '';
    var re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)|(←.*$)/g;
    var last = 0, m;
    function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    while ((m = re.exec(line)) !== null) {
      out += '<span class="c-p">' + esc(line.slice(last, m.index)) + '</span>';
      if (m[1] !== undefined) {
        out += '<span class="' + (m[2] ? 'c-k' : 'c-s') + '">' + esc(m[1]) + '</span>' + (m[2] || '');
      } else if (m[3] !== undefined) {
        out += '<span class="c-n">' + esc(m[3]) + '</span>';
      } else {
        out += '<span class="c-cm">' + esc(m[4]) + '</span>';
      }
      last = m.index + m[0].length;
    }
    out += '<span class="c-p">' + esc(line.slice(last)) + '</span>';
    return out;
  }

  function initMapping() {
    var jsonEl = $('#mapJson');
    var screen = $('#mapScreen');
    if (!jsonEl) return;

    /* วาดบล็อก JSON โดยผูกแต่ละบรรทัดเข้ากับหมายเลขขั้น */
    var html = '<code>';
    html += '<span class="ln">{ <span class="c-k">"screenId"</span>: <span class="c-s">"product"</span>,</span>';
    html += '<span class="ln">  <span class="c-k">"schemaVersion"</span>: <span class="c-n">3</span>,</span>';
    html += '<span class="ln">  <span class="c-k">"components"</span>: [</span>';
    MAP_STEPS.forEach(function (step, i) {
      step.lines.forEach(function (line) {
        html += '<span class="ln" data-s="' + i + '">' + highlightJson(line) + '</span>';
      });
    });
    html += '<span class="ln">  ]</span><span class="ln">}</span></code>';
    jsonEl.innerHTML = html;

    var index = -1;

    function reset() {
      index = -1;
      screen.textContent = '';
      var hint = document.createElement('p');
      hint.className = 'ui-empty';
      hint.textContent = 'ยังไม่มีอะไรบนหน้าจอ\nรอ JSON จากเซิร์ฟเวอร์…';
      hint.style.whiteSpace = 'pre-line';
      screen.appendChild(hint);
      $$('.ln', jsonEl).forEach(function (el) { el.classList.remove('is-hot', 'is-done'); });
      $$('.registry__row').forEach(function (r) { r.classList.remove('is-hit'); });
      $('#mapStep').disabled = false;
      $('#mapStep').textContent = '▶ แปลบรรทัดถัดไป';
    }

    function step() {
      if (index >= MAP_STEPS.length - 1) return false;
      if (index === -1) screen.textContent = '';
      index++;
      var s = MAP_STEPS[index];

      /* ไฮไลต์บรรทัด JSON ที่กำลังถูกอ่าน */
      $$('.ln', jsonEl).forEach(function (el) {
        var owner = el.getAttribute('data-s');
        el.classList.remove('is-hot');
        if (owner === null) return;
        var n = Number(owner);
        el.classList.toggle('is-hot', n === index);
        el.classList.toggle('is-done', n < index);
      });

      /* ไฮไลต์แถวในตารางทะเบียน — ถ้าไม่รู้จักให้ไปโดนแถว fallback */
      var known = window.SDUI.isKnown(s.type);
      $$('.registry__row').forEach(function (r) {
        r.classList.toggle('is-hit', r.dataset.type === (known ? s.type : '__unknown'));
      });

      /* วาด component ลงหน้าจอจำลอง */
      var el = window.SDUI.renderNode(s.node, {});
      if (el) {
        el.classList.add('ui-enter');
        screen.appendChild(el);
        screen.scrollTop = screen.scrollHeight;
      }

      if (index >= MAP_STEPS.length - 1) {
        $('#mapStep').disabled = true;
        $('#mapStep').textContent = '✓ แปลครบทุกบรรทัดแล้ว';
      }
      return true;
    }

    $('#mapStep').addEventListener('click', step);
    $('#mapReset').addEventListener('click', reset);
    $('#mapAll').addEventListener('click', function () {
      reset();
      var timer = setInterval(function () {
        if (!step()) clearInterval(timer);
      }, motionOff() ? 30 : 420);
    });

    reset();
  }

  /* ------------------------------------------------- 05 · PLAYGROUND */
  var PRESETS = {
    product: {
      screenId: 'product',
      schemaVersion: 3,
      components: [
        { type: 'image', label: '👟', height: 130 },
        { type: 'badge', tone: 'danger', value: 'ลด 20% วันนี้เท่านั้น' },
        { type: 'text', variant: 'title', value: 'รองเท้าวิ่ง Aero X' },
        { type: 'rating', value: 4.5, count: 218 },
        { type: 'text', variant: 'body', value: 'น้ำหนักเบา 210 กรัม พื้นโฟมรองรับแรงกระแทก เหมาะกับการวิ่งระยะไกล' },
        { type: 'divider' },
        { type: 'row', children: [
          { type: 'text', variant: 'caption', value: 'ราคาปกติ ฿3,120' },
          { type: 'text', variant: 'title', value: '฿2,490', align: 'right' }
        ] },
        { type: 'button', tone: 'primary', value: 'ซื้อเลย', action: { kind: 'addToCart', id: 8823 } },
        { type: 'button', tone: 'secondary', value: 'เพิ่มในรายการโปรด' }
      ]
    },
    promo: {
      screenId: 'promo',
      schemaVersion: 3,
      components: [
        { type: 'badge', tone: 'warn', value: '🔥 FLASH SALE' },
        { type: 'text', variant: 'title', value: 'ลดทั้งร้าน สูงสุด 50%' },
        { type: 'text', variant: 'caption', value: 'เหลือเวลาอีก 2 ชั่วโมง 14 นาที' },
        { type: 'image', label: '🎁', height: 100 },
        { type: 'card', children: [
          { type: 'text', variant: 'body', value: 'โค้ดส่วนลดของคุณ' },
          { type: 'text', variant: 'title', value: 'SAVE50' },
          { type: 'button', tone: 'danger', value: 'กดใช้โค้ดเลย' }
        ] },
        { type: 'divider' },
        { type: 'text', variant: 'caption', value: 'สินค้าแนะนำ' },
        { type: 'row', children: [
          { type: 'image', label: '👟', height: 46 },
          { type: 'text', variant: 'body', value: 'รองเท้าวิ่ง Aero X\n฿2,490' }
        ] },
        { type: 'row', children: [
          { type: 'image', label: '🎧', height: 46 },
          { type: 'text', variant: 'body', value: 'หูฟัง Pulse Air\n฿1,790' }
        ] }
      ]
    },
    profile: {
      screenId: 'profile',
      schemaVersion: 3,
      components: [
        { type: 'image', label: '🧑‍🚀', height: 92 },
        { type: 'text', variant: 'title', value: 'สมชาย ใจดี' },
        { type: 'text', variant: 'caption', value: 'สมาชิกระดับทอง · เข้าร่วมปี 2565' },
        { type: 'divider' },
        { type: 'input', placeholder: 'ค้นหาคำสั่งซื้อ…' },
        { type: 'list', items: ['คำสั่งซื้อของฉัน (12)', 'ที่อยู่จัดส่ง', 'วิธีการชำระเงิน', 'การแจ้งเตือน'] },
        { type: 'spacer', height: 10 },
        { type: 'button', tone: 'secondary', value: 'แก้ไขโปรไฟล์' },
        { type: 'button', tone: 'danger', value: 'ออกจากระบบ' }
      ]
    },
    unknown: {
      screenId: 'future-layout',
      schemaVersion: 7,
      components: [
        { type: 'text', variant: 'title', value: 'หน้าจอที่ออกแบบด้วย schema v7' },
        { type: 'text', variant: 'body', value: 'แอปเครื่องนี้ยังเป็น v3 จึงรู้จักบาง component เท่านั้น' },
        { type: 'liveVideoBanner', src: 'rtmp://…' },
        { type: 'arPreview', modelId: 'aero-x' },
        { type: 'divider' },
        { type: 'button', tone: 'primary', value: 'ส่วนที่รู้จักยังกดได้ปกติ' }
      ]
    }
  };

  function initPlayground() {
    var input = $('#pgInput');
    var screen = $('#pgScreen');
    var status = $('#pgStatus');
    if (!input) return;

    var timer = null;

    function render() {
      var text = input.value;
      var schema;
      try {
        schema = JSON.parse(text);
      } catch (err) {
        status.className = 'playground__status is-err';
        status.textContent = '✕ JSON ไม่ถูกต้อง: ' + err.message;
        return;   /* คงหน้าจอเดิมไว้ — เหมือนแอปจริงที่ไม่ควรจอขาวเพราะ response พัง */
      }

      var count = window.SDUI.renderScreen(screen, schema, { animate: !motionOff() });
      var unknown = (schema.components || []).filter(function (n) {
        return n && n.type && !window.SDUI.isKnown(n.type);
      }).length;

      status.className = 'playground__status is-ok';
      status.textContent = '✓ เรนเดอร์สำเร็จ ' + count + ' component'
        + (unknown ? ' · ⚠️ ไม่รู้จัก ' + unknown + ' ตัว → แสดง fallback' : '');
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(render, 260);
    }

    function load(name, btn) {
      input.value = JSON.stringify(PRESETS[name], null, 2);
      $$('.playground__presets .chip').forEach(function (c) { c.classList.toggle('is-active', c === btn); });
      render();
    }

    $$('.playground__presets .chip').forEach(function (btn) {
      btn.addEventListener('click', function () { load(btn.dataset.preset, btn); });
    });
    input.addEventListener('input', schedule);

    load('product', $('.playground__presets .chip'));
  }

  /* --------------------------------------------------------- 06 · OTA */
  function initOta() {
    var screen = $('#otaScreen');
    if (!screen) return;

    var fields = {
      title: $('#otaTitle'),
      cta: $('#otaCta'),
      tone: $('#otaTone'),
      badge: $('#otaBadge'),
      banner: $('#otaBanner'),
      review: $('#otaReview')
    };
    var serverVerEl = $('#otaServerVer');
    var clientVerEl = $('#otaClientVer');
    var hintEl = $('#otaHint');
    var packet = $('#otaPacket');
    var wire = $('.ota__wire');

    var serverVersion = 1;
    var deployed = snapshot();     /* config ที่อยู่บนเซิร์ฟเวอร์ตอนนี้ */
    var onDevice = { config: deployed, version: 1 };   /* config ที่เครื่องผู้ใช้ถืออยู่ */
    var dirty = false;

    function snapshot() {
      return {
        title: fields.title.value || 'สินค้า',
        cta: fields.cta.value || 'ซื้อเลย',
        tone: fields.tone.value,
        badge: fields.badge.checked,
        banner: fields.banner.checked,
        review: fields.review.checked
      };
    }

    /* นี่คือสิ่งที่เซิร์ฟเวอร์ "ประกอบ" ขึ้นจากค่าใน CMS */
    function buildSchema(cfg) {
      var components = [];
      if (cfg.banner) {
        components.push({ type: 'badge', tone: 'warn', value: '🔥 แคมเปญกลางปี' });
      }
      components.push({ type: 'image', label: '👟', height: 96 });
      if (cfg.badge) {
        components.push({ type: 'badge', tone: 'danger', value: 'ลด 20%' });
      }
      components.push({ type: 'text', variant: 'title', value: cfg.title });
      if (cfg.review) {
        components.push({ type: 'rating', value: 4.5, count: 218 });
      }
      /* วาง CTA ไว้เหนือคำบรรยาย เพื่อให้ทุกอย่างที่แผงควบคุมแก้ได้
         (แบนเนอร์ / ป้าย / หัวเรื่อง / รีวิว / ปุ่ม) อยู่ในส่วนบนของจอทั้งหมด
         ไม่งั้นบนมือถือจะต้องเลื่อนลงไปดูว่าปุ่มเปลี่ยนสีแล้วหรือยัง */
      components.push({ type: 'button', tone: cfg.tone, value: cfg.cta });
      components.push({ type: 'divider' });
      components.push({ type: 'text', variant: 'body', value: 'น้ำหนักเบา พื้นรองรับแรงกระแทก' });
      return { screenId: 'product', components: components };
    }

    function paint() {
      window.SDUI.renderScreen(screen, buildSchema(onDevice.config), { animate: !motionOff() });
      clientVerEl.textContent = 'กำลังใช้ config v' + onDevice.version;
      clientVerEl.classList.toggle('is-stale', onDevice.version < serverVersion);
    }

    function markDirty() {
      dirty = true;
      hintEl.innerHTML = '✏️ มีการแก้ไขที่ <b>ยังไม่ได้ deploy</b> — ค่านี้ยังอยู่แค่ในแผงควบคุม';
    }

    Object.keys(fields).forEach(function (key) {
      fields[key].addEventListener('input', markDirty);
      fields[key].addEventListener('change', markDirty);
    });

    $('#otaDeploy').addEventListener('click', function () {
      deployed = snapshot();
      serverVersion++;
      dirty = false;
      serverVerEl.textContent = 'config v' + serverVersion;
      clientVerEl.classList.add('is-stale');
      hintEl.innerHTML = '✅ deploy <b>config v' + serverVersion + '</b> ขึ้นเซิร์ฟเวอร์แล้ว '
        + '(ใช้เวลาไม่กี่วินาที ไม่ต้อง build แอป) — แต่มือถือยังถือ config v' + onDevice.version
        + ' อยู่ กด <b>🔄 ผู้ใช้เปิดแอป</b> เพื่อดึงของใหม่';
    });

    $('#otaFetch').addEventListener('click', function () {
      wire.classList.add('is-live');
      packet.classList.remove('is-flying');
      void packet.offsetWidth;               /* บังคับให้ browser รีสตาร์ตแอนิเมชัน */
      packet.classList.add('is-flying');

      setTimeout(function () {
        onDevice = { config: deployed, version: serverVersion };
        paint();
        wire.classList.remove('is-live');
        hintEl.innerHTML = onDevice.version === 1 && !dirty
          ? 'ดึง config เดิมมาใหม่ — ลองแก้ค่าด้านบนแล้ว deploy ดูสิ'
          : '🎉 มือถือเรนเดอร์ใหม่ด้วย <b>config v' + onDevice.version + '</b> แล้ว '
            + 'สังเกตว่าแอปยังเป็น <b>v1.0.0</b> ตัวเดิม ไม่ได้อัปเดตจาก store เลยแม้แต่ครั้งเดียว';
      }, motionOff() ? 60 : 950);
    });

    paint();
  }

  /* ---------------------------------------------------------- BOOT */
  function boot() {
    initChrome();
    initReveal();
    initRace();
    initFlow();
    initMapping();
    initPlayground();
    initOta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
