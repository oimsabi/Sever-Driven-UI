/* =====================================================================
 * renderer.js
 * ---------------------------------------------------------------------
 * นี่คือ "หัวใจของฝั่งไคลเอนต์" ในสถาปัตยกรรม Server-Driven UI
 *
 * หน้าที่เดียวของไฟล์นี้คือ: รับ JSON (พิมพ์เขียวหน้าจอ) → คืน DOM (UI จริง)
 * ตัวมันเองไม่รู้เลยว่าหน้าจอไหนหน้าตายังไง — เซิร์ฟเวอร์เป็นคนบอกทั้งหมด
 *
 * ในแอปจริง ไฟล์นี้คือโค้ด native (Swift / Kotlin / React) ที่ถูก compile
 * ฝังไปกับแอป และเป็นส่วนที่ "ไม่ค่อยได้แก้" — สิ่งที่แก้บ่อยคือ JSON
 * ===================================================================== */

(function (global) {
  'use strict';

  /* -------------------------------------------------------------------
   * COMPONENT REGISTRY — ทะเบียนชิ้นส่วน
   * แปลง "ชื่อชนิด" ที่เซิร์ฟเวอร์ส่งมา ให้กลายเป็น element จริง
   * การเพิ่ม component ใหม่ = เพิ่ม key ที่นี่ (ต้อง release แอปใหม่)
   * ----------------------------------------------------------------- */
  var registry = {

    /* ข้อความ: title / body / caption */
    text: function (node) {
      var el = document.createElement('p');
      el.className = 'ui-text ui-text--' + (node.variant || 'body');
      el.textContent = node.value != null ? String(node.value) : '';
      if (node.align) el.style.textAlign = node.align;
      return el;
    },

    /* ปุ่มกด — action ถูกส่งมาเป็น "ข้อมูล" ไม่ใช่โค้ด (ดูหัวข้อกับดักข้อ 4) */
    button: function (node, ctx) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'ui-button ui-button--' + (node.tone || 'primary');
      el.textContent = node.value != null ? String(node.value) : 'ปุ่ม';
      el.addEventListener('click', function () {
        if (ctx && typeof ctx.onAction === 'function') ctx.onAction(node.action || null, node);
      });
      return el;
    },

    /* รูปภาพ — ในเดโมใช้อีโมจิแทนไฟล์จริง เพื่อให้หน้าเว็บทำงานได้แบบออฟไลน์ */
    image: function (node) {
      var el = document.createElement('div');
      el.className = 'ui-image';
      el.style.height = (Number(node.height) || 110) + 'px';
      el.textContent = node.label || '🖼️';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', node.alt || node.label || 'รูปภาพ');
      return el;
    },

    /* ป้ายเล็ก ๆ เช่น "ลด 20%" */
    badge: function (node) {
      var el = document.createElement('span');
      el.className = 'ui-badge ui-badge--' + (node.tone || 'primary');
      el.textContent = node.value != null ? String(node.value) : '';
      return el;
    },

    /* คะแนนรีวิว */
    rating: function (node) {
      var score = Math.max(0, Math.min(5, Number(node.value) || 0));
      var full = Math.round(score);
      var el = document.createElement('div');
      el.className = 'ui-rating';

      var stars = document.createElement('span');
      stars.className = 'ui-rating__stars';
      stars.textContent = '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);

      var label = document.createElement('span');
      label.textContent = score.toFixed(1) + (node.count ? ' (' + node.count + ' รีวิว)' : '');

      el.appendChild(stars);
      el.appendChild(label);
      return el;
    },

    /* ช่องกรอกข้อความ */
    input: function (node) {
      var el = document.createElement('input');
      el.className = 'ui-input';
      el.type = node.inputType === 'password' ? 'password' : 'text';
      el.placeholder = node.placeholder || '';
      return el;
    },

    /* รายการหัวข้อ */
    list: function (node) {
      var el = document.createElement('ul');
      el.className = 'ui-list';
      (Array.isArray(node.items) ? node.items : []).forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = String(item);
        el.appendChild(li);
      });
      return el;
    },

    /* เส้นคั่น */
    divider: function () {
      var el = document.createElement('hr');
      el.className = 'ui-divider';
      return el;
    },

    /* ช่องว่าง */
    spacer: function (node) {
      var el = document.createElement('div');
      el.className = 'ui-spacer';
      el.style.height = (Number(node.height) || 8) + 'px';
      return el;
    },

    /* -------- container: มีลูกอยู่ข้างใน จึงต้องเรียก renderNode ซ้ำ -------- */

    card: function (node, ctx) {
      var el = document.createElement('div');
      el.className = 'ui-card';
      appendChildren(el, node.children, ctx);
      return el;
    },

    row: function (node, ctx) {
      var el = document.createElement('div');
      el.className = 'ui-row';
      appendChildren(el, node.children, ctx);
      return el;
    },

    stack: function (node, ctx) {
      var el = document.createElement('div');
      el.className = 'ui-card';
      el.style.background = 'transparent';
      el.style.border = '0';
      el.style.padding = '0';
      appendChildren(el, node.children, ctx);
      return el;
    }
  };

  /* -------------------------------------------------------------------
   * FALLBACK — สิ่งที่ต้องมีเสมอในระบบ SDUI จริง
   * ถ้าเซิร์ฟเวอร์ส่ง component ที่แอปเวอร์ชันนี้ยังไม่รู้จัก
   * ห้ามแครช ห้ามหน้าจอว่าง — ต้องข้ามอย่างปลอดภัยหรือแสดงกล่องแทน
   * ----------------------------------------------------------------- */
  function renderUnknown(node) {
    var el = document.createElement('div');
    el.className = 'ui-fallback';
    el.textContent = '⚠️ แอปเวอร์ชันนี้ยังไม่รู้จัก component "' + node.type + '" — ข้ามอย่างปลอดภัย';
    return el;
  }

  function appendChildren(parent, children, ctx) {
    (Array.isArray(children) ? children : []).forEach(function (child) {
      var el = renderNode(child, ctx);
      if (el) parent.appendChild(el);
    });
  }

  /* แปลง node เดียว (พร้อมลูกทั้งหมด) เป็น element */
  function renderNode(node, ctx) {
    if (!node || typeof node !== 'object' || !node.type) return null;
    var build = registry[node.type] || renderUnknown;
    var el;
    try {
      el = build(node, ctx || {});
    } catch (err) {
      el = renderUnknown(node);
    }
    if (el && node.type !== 'spacer') el.classList.add('ui-node');
    return el;
  }

  /* -------------------------------------------------------------------
   * renderScreen — จุดเริ่มต้น: เอา JSON ทั้งหน้าจอมาวาดลงใน container
   * options.stagger : หน่วงเวลาให้ element โผล่ทีละชิ้น (มม.วินาที)
   * options.animate : เปิด/ปิดแอนิเมชันตอนเข้า
   * ----------------------------------------------------------------- */
  function renderScreen(container, schema, options) {
    var opts = options || {};
    container.textContent = '';

    var nodes = (schema && Array.isArray(schema.components)) ? schema.components : [];
    if (!nodes.length) {
      var empty = document.createElement('p');
      empty.className = 'ui-empty';
      empty.textContent = 'ไม่มี component ให้แสดง';
      container.appendChild(empty);
      return 0;
    }

    var count = 0;
    nodes.forEach(function (node, i) {
      var el = renderNode(node, opts);
      if (!el) return;
      if (opts.animate !== false) {
        el.classList.add('ui-enter');
        el.style.animationDelay = (i * (opts.stagger != null ? opts.stagger : 55)) + 'ms';
      }
      container.appendChild(el);
      count++;
    });
    return count;
  }

  /* ตรวจว่า type นี้แอปรู้จักไหม (ใช้ตอนไฮไลต์ตารางทะเบียน) */
  function isKnown(type) {
    return Object.prototype.hasOwnProperty.call(registry, type);
  }

  global.SDUI = {
    registry: registry,
    renderNode: renderNode,
    renderScreen: renderScreen,
    isKnown: isKnown
  };

})(window);
