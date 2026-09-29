/*
 * 화면 — 해시 주소로 나눕니다.
 *   #/cases     검사 건 (등록·선택)                      기획서 5장 「검사 건 등록」
 *   #/spec      치수 기준표 (입력·붙여넣기·파일)           「치수 기준표 입력」
 *   #/meas      측정결과 (CMM 파일 + 열 지정, 수기 입력)    「CMM 결과 가져오기」
 *   #/result    판정 결과 (OK/NOK/확인필요, 성적서 Excel)  「자동 판정」「확인필요 분류」「통합 검사결과 표」「검사성적서 출력」
 *   #/drawing   도면 보기 (핀 찍기·판정 색 표시)           「도면 오버레이」
 *   #/daily     과제 B 일일점검 (등록 현황판·규칙 검사)     기획서 8장 1단계 과제 B
 *   #/data      판정 규칙·열 지정 템플릿·백업
 */
(function () {
  'use strict';
  var L = window.QCLogic, S = window.QCStore, Sample = window.QCSample;
  var db = S.loadDb();
  var main = document.getElementById('main');
  var memImages = {};           // 저장 공간이 모자랄 때 도면을 잠시 들고 있는 곳
  var ui = { resultFilter: 'ALL', selectedPin: null, placing: false, dailyDate: '' };

  // ── 도우미 ────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  // append(el, 자식1, 자식2, …) — 배열·null 허용
  function append(el) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); continue; }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
  }
  function svg(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]); else el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  function save() {
    var ok = S.saveDb(db);
    showStoreBanner(ok ? null : '저장 공간에 쓰지 못해 이 화면을 닫으면 내용이 사라집니다. 「데이터」 메뉴에서 엑셀 백업을 받아 두십시오.');
    document.getElementById('sampleBanner').hidden = !db._sample;
    updateNetBadge();
  }
  function showStoreBanner(msg) {
    var b = document.getElementById('storeBanner');
    b.textContent = msg || ''; b.hidden = !msg;
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function cur() {
    return db.inspections.filter(function (x) { return x.id === db.current; })[0] || null;
  }
  function fmtNum(x) { return x == null || x === '' ? '' : String(x); }
  function signed(x) { return x == null ? '' : (x > 0 ? '+' : '') + x; }
  function badge(st) { return h('span', { class: 'st st-' + st }, L.STATUS_LABEL[st]); }
  function today() { return L.toDateStr(new Date()); }
  function stamp() { var d = new Date(); return today().replace(/-/g, '') + '_' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2); }
  function prefix() { return db._sample ? '예시데이터_' : ''; }
  function safeName(s) { return String(s || '').replace(/[\\\/:*?"<>|\s]+/g, '_').slice(0, 40); }

  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  // buttons = [{label, primary, onClick(returns false → 닫지 않음)}]
  function dialog(title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var box = document.getElementById('dialogContent');
    box.textContent = '';
    append(box, content);
    var acts = document.getElementById('dialogActions');
    acts.textContent = '';
    (buttons || [{ label: '닫기' }]).forEach(function (b) {
      acts.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''), type: 'button',
        onclick: function () { var keep = b.onClick ? b.onClick() === false : false; if (!keep) closeDialog(); }
      }, b.label));
    });
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    return dlg;
  }
  function closeDialog() { var d = document.getElementById('dialog'); if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }
  function confirmBox(title, msg, okLabel, onOk) {
    dialog(title, h('p', null, msg), [{ label: '취소' }, { label: okLabel, primary: true, onClick: onOk }]);
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function downloadCsv(name, rows) { download(name, new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' })); }
  function downloadXlsx(name, sheets) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (sn) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[sn]), sn.slice(0, 31)); });
    XLSX.writeFile(wb, name);
  }
  function field(label, control, cls) { return h('label', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', null, label), control); }
  function fileButton(label, accept, onFile) {
    var input = h('input', { type: 'file', accept: accept, 'aria-label': label });
    input.addEventListener('change', function () { var f = input.files[0]; input.value = ''; if (f) onFile(f); });
    return h('span', { class: 'btn file-btn' }, label, input);
  }

  // ── 파일 → 2차원 표 ─────────────────────────────────────────
  // CSV 는 UTF-8 로 읽고, 깨지면 EUC-KR(CP949) 로 다시 읽습니다(국내 장비 출력 대비).
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return new TextDecoder('utf-8').decode(buf); } }
  }
  function readTableFile(file, cb) {
    var name = file.name.toLowerCase();
    var reader = new FileReader();
    reader.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
    reader.onload = function () {
      try {
        if (/\.(csv|tsv|txt)$/.test(name)) { cb(L.parseDelimited(decodeText(reader.result)), file.name); return; }
        var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: false });
        var toRows = function (sn) {
          return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' })
            .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
        };
        if (wb.SheetNames.length === 1) { cb(toRows(wb.SheetNames[0]), file.name); return; }
        dialog('시트 고르기', h('div', { class: 'btn-row' }, wb.SheetNames.map(function (sn) {
          return h('button', { class: 'btn', type: 'button', onclick: function () { closeDialog(); cb(toRows(sn), file.name + ' / ' + sn); } }, sn);
        })), [{ label: '취소' }]);
      } catch (e) { toast('표로 읽을 수 없는 파일입니다: ' + e.message, true); }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── 열 지정(컬럼 매핑) 대화상자 ─────────────────────────────
  // kind: spec | meas | equip | daily | limits.  onDone(objs)
  function mappingDialog(kind, rows, sourceName, onDone) {
    if (!rows.length) { toast('읽은 표가 비어 있습니다.', true); return; }
    var defs = L.FIELDS[kind];
    var headerRow = L.guessHeaderRow(rows);
    var map = L.guessMapping(rows[headerRow], kind);
    var wrap = h('div');
    var templates = db.templates.filter(function (t) { return t.kind === kind; });

    function headersOf() { return (rows[headerRow] || []).map(function (c, i) { return String(c).trim() || ('(' + (i + 1) + '번째 열)'); }); }
    function applyTemplate(t) {
      var hs = (rows[headerRow] || []).map(function (c) { return String(c).trim(); });
      map = {};
      Object.keys(t.cols).forEach(function (k) { var i = hs.indexOf(t.cols[k]); if (i >= 0) map[k] = i; });
      draw();
    }
    function draw() {
      wrap.textContent = '';
      var hs = headersOf();
      append(wrap, h('p', { class: 'note' }, (sourceName ? sourceName + ' — ' : '') + '실제 파일의 열 이름을 미리 알 수 없어, 어느 열이 어떤 값인지 여기서 지정합니다. 머리행 글자로 추정한 값이 들어 있으니 확인만 하십시오.'));
      var hr = h('input', { type: 'number', min: 1, max: rows.length, value: headerRow + 1 });
      hr.addEventListener('change', function () {
        var n = Math.max(1, Math.min(rows.length, parseInt(hr.value, 10) || 1)) - 1;
        headerRow = n; map = L.guessMapping(rows[headerRow], kind); draw();
      });
      var tsel = null;
      if (templates.length) {
        tsel = h('select', { 'aria-label': '저장된 열 지정 템플릿' }, h('option', { value: '' }, '(템플릿 선택 안 함)'),
          templates.map(function (t, i) { return h('option', { value: String(i) }, t.name); }));
        tsel.addEventListener('change', function () { if (tsel.value !== '') applyTemplate(templates[Number(tsel.value)]); });
      }
      append(wrap, h('div', { class: 'form-grid' },
        field('머리행(열 이름이 있는 줄) 번호', hr),
        tsel ? field('저장된 열 지정 템플릿', tsel) : null));
      append(wrap, h('div', { class: 'map-grid' }, defs.map(function (f) {
        var sel = h('select', { 'data-field': f.key }, h('option', { value: '' }, '(없음)'),
          hs.map(function (x, i) { return h('option', { value: String(i) }, x); }));
        sel.value = map[f.key] == null ? '' : String(map[f.key]);
        sel.addEventListener('change', function () { if (sel.value === '') delete map[f.key]; else map[f.key] = Number(sel.value); drawPreview(); });
        return field(f.label + (f.need ? ' *' : ''), sel);
      })));
      var pv = h('div', { class: 'preview-wrap' });
      append(wrap, pv);
      function drawPreview() {
        pv.textContent = '';
        var objs = L.applyMapping(rows, headerRow, map, kind);
        append(pv, h('p', { class: 'note' }, '가져올 행 ' + objs.length + '개 · 앞 5행 미리보기'));
        append(pv, h('div', { class: 'table-wrap preview-table' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, defs.map(function (f) { return h('th', null, f.label); }))),
          h('tbody', null, objs.slice(0, 5).map(function (o) { return h('tr', null, defs.map(function (f) { return h('td', null, fmtNum(o[f.key])); })); })))));
      }
      drawPreview();
      if (kind === 'meas' || kind === 'spec') {
        var tn = h('input', { type: 'text', name: 'tpl_name', placeholder: '예: 3번 CMM 장비' });
        append(wrap, h('div', { class: 'form-grid' }, field('이 열 지정을 템플릿으로 저장(선택) — 이름', tn)));
        wrap._tplName = tn;
      }
    }
    draw();
    dialog('열 지정', wrap, [{ label: '취소' }, {
      label: '가져오기', primary: true, onClick: function () {
        var miss = L.missingRequired(map, kind);
        if (miss.length) { toast('꼭 지정할 열: ' + miss.join(', '), true); return false; }
        var objs = L.applyMapping(rows, headerRow, map, kind);
        if (!objs.length) { toast('가져올 행이 없습니다.', true); return false; }
        var tn = wrap._tplName && wrap._tplName.value.trim();
        if (tn) {
          var hs = rows[headerRow].map(function (c) { return String(c).trim(); });
          var cols = {}; Object.keys(map).forEach(function (k) { cols[k] = hs[map[k]]; });
          db.templates = db.templates.filter(function (t) { return !(t.kind === kind && t.name === tn); });
          db.templates.push({ name: tn, kind: kind, cols: cols });
        }
        // 다음 대화상자(바꾸기/덧붙이기)가 이 대화상자 닫기에 같이 닫히지 않도록 한 박자 뒤에 넘깁니다
        setTimeout(function () { onDone(objs); }, 0);
      }
    }]);
  }
  function pasteDialog(kind, title, hint, onDone) {
    var ta = h('textarea', { name: 'paste', placeholder: hint, rows: 8 });
    dialog(title, [h('p', { class: 'note' }, '엑셀에서 머리행(열 이름)까지 함께 복사해 붙여 넣으십시오. 다음 단계에서 열을 지정합니다.'), field('붙여 넣을 내용', ta)],
      [{ label: '취소' }, {
        label: '다음(열 지정)', primary: true, onClick: function () {
          var rows = L.parseDelimited(ta.value);
          if (!rows.length) { toast('붙여 넣은 내용이 없습니다.', true); return false; }
          setTimeout(function () { mappingDialog(kind, rows, '붙여넣기', onDone); }, 0);
        }
      }]);
  }

  // ── 사진 (2026-09-29 — 수기 측정표·일일점검표 촬영 등록) ──────────────
  // 사진은 이 화면에서 보기 위해 메모리에만 두고 저장소·서버에 넣지 않습니다(용량·보안).
  // 파일 지문(hash)은 같은 사진 재업로드 확인용으로 원본 바이트에서 계산합니다.
  function readPhoto(file, cb) {
    var r1 = new FileReader();
    r1.onerror = function () { toast('사진을 읽지 못했습니다.', true); };
    r1.onload = function () {
      var hash = L.hashBytes(new Uint8Array(r1.result));
      var blobUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(blobUrl);
        cb({ name: file.name || '촬영사진.jpg', dataUrl: c.toDataURL('image/jpeg', 0.9), hash: hash, zoom: 1 });
      };
      img.onerror = function () { URL.revokeObjectURL(blobUrl); toast('이미지로 읽을 수 없는 파일입니다.', true); };
      img.src = blobUrl;
    };
    r1.readAsArrayBuffer(file);
  }
  function rotatePhoto(ph, dir, cb) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = img.naturalHeight; c.height = img.naturalWidth;
      var g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2); g.rotate(dir * Math.PI / 2); g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ph.dataUrl = c.toDataURL('image/jpeg', 0.9); cb();
    };
    img.src = ph.dataUrl;
  }
  // 촬영 버튼 — 휴대폰에서는 카메라가 바로 열립니다(capture=environment). PC 에서는 파일 고르기.
  function photoButton(label, onFile) {
    var input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': label });
    input.addEventListener('change', function () { var f = input.files[0]; input.value = ''; if (f) onFile(f); });
    return h('span', { class: 'btn btn-primary file-btn' }, label, input);
  }
  // 확대·회전 보기. ph: { name, dataUrl, zoom }
  function photoViewer(ph) {
    var img = h('img', { src: ph.dataUrl, alt: '올린 사진 ' + ph.name, style: 'width:' + Math.round(ph.zoom * 100) + '%' });
    var box = h('div', { class: 'photo-scroll' }, img);
    function zoom(z) {
      var cx = box.scrollLeft + box.clientWidth / 2, cy = box.scrollTop + box.clientHeight / 2, k = z / ph.zoom;
      ph.zoom = z; img.style.width = Math.round(z * 100) + '%';
      box.scrollLeft = cx * k - box.clientWidth / 2; box.scrollTop = cy * k - box.clientHeight / 2;
      lab.textContent = Math.round(z * 100) + '%';
    }
    var lab = h('span', { class: 'note zoom-label' }, Math.round(ph.zoom * 100) + '%');
    var tools = h('div', { class: 'btn-row photo-tools', role: 'group', 'aria-label': '사진 보기 도구' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: function () { zoom(Math.max(0.5, ph.zoom / 1.5)); } }, '축소'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: function () { zoom(Math.min(8, ph.zoom * 1.5)); } }, '확대'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: function () { zoom(1); } }, '폭에 맞춤'), lab,
      h('button', { class: 'btn btn-small', type: 'button', onclick: function () { rotatePhoto(ph, -1, render); } }, '왼쪽으로 돌리기'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: function () { rotatePhoto(ph, 1, render); } }, '오른쪽으로 돌리기'));
    return h('div', { class: 'photo-viewer' }, tools, box, h('p', { class: 'note' }, ph.name + ' · 이 사진은 저장하지 않고 이 화면에만 띄웁니다. 두 손가락으로 벌리거나 「확대」로 크게 보십시오.'));
  }
  // 폐쇄망 모드 표시
  function offline() { return db.settings.offline_mode !== false; }
  function updateNetBadge() {
    var b = document.getElementById('netBadge');
    if (!b) return;
    b.className = 'net-badge' + (offline() ? '' : ' ai-on');
    b.textContent = offline()
      ? '폐쇄망 모드 · 이 화면은 어떤 데이터도 외부로 보내지 않습니다. 파일·사진은 이 PC 브라우저 안에서만 읽고 저장합니다.'
      : 'AI 읽기 사용 가능 · 「AI 읽기」를 누를 때만 그 사진 한 장이 OpenAI 로 전송됩니다. 도면·사내 측정표 사진에는 쓰지 마십시오.';
  }
  // AI 읽기 도구 묶음 — 폐쇄망 모드에서는 아무것도 그리지 않습니다(null).
  //   opts: { photo: fn → 사진, prompt: fn → 요청문, onRows: fn(rows) }
  function aiTools(opts) {
    if (offline()) return null;
    var busy = false;
    function answer(text) {
      var r = L.parseAiJson(text);
      if (r.error) { toast('AI 답을 읽지 못했습니다: ' + r.error, true); return false; }
      opts.onRows(r.rows);
      toast('AI 가 읽은 ' + r.rows.length + '줄을 표에 채웠습니다. 사진과 대조해 확인한 뒤 등록하십시오.');
    }
    return h('div', { class: 'ai-tools' },
      h('p', { class: 'note' }, 'AI 읽기는 보안 요구가 없는 사진(협력사 점검표 등)에만 쓰십시오. 읽은 값은 표에 채워만 두고, 사람이 확인해 「등록」을 눌러야 들어갑니다.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn', type: 'button', onclick: function (e) {
            var ph = opts.photo(); if (!ph) { toast('먼저 사진을 올리십시오.', true); return; }
            if (busy) return; busy = true; var btn = e.currentTarget; btn.textContent = 'AI 가 읽는 중…';
            QCAI.readPhoto({ offline: db.settings.offline_mode, key: S.getKey(), model: db.settings.ai_model, prompt: opts.prompt(), dataUrl: ph.dataUrl })
              .then(function (text) { answer(text); })
              .catch(function (err) { toast('AI 읽기 실패: ' + err.message, true); })
              .then(function () { busy = false; btn.textContent = 'AI 읽기(내 API 키)'; });
          }
        }, 'AI 읽기(내 API 키)'),
        h('button', {
          class: 'btn', type: 'button', onclick: function () {
            var p = opts.prompt();
            var ta = h('textarea', { rows: 10, readonly: true }); ta.value = p;
            dialog('요청문 (반자동)', [h('p', { class: 'note' }, 'ChatGPT 같은 AI 에 사진을 첨부하고 아래 요청문을 붙여 넣으십시오. 받은 답을 「AI 답 붙여넣기」에 넣으면 표에 채워집니다.'), ta],
              [{ label: '닫기' }, { label: '복사', primary: true, onClick: function () { ta.select(); try { navigator.clipboard.writeText(p); } catch (e) { document.execCommand('copy'); } toast('요청문을 복사했습니다.'); } }]);
          }
        }, '요청문 복사(반자동)'),
        h('button', {
          class: 'btn', type: 'button', onclick: function () {
            var ta = h('textarea', { rows: 8, placeholder: '[{"no":"1","value":"100.02"}]' });
            dialog('AI 답 붙여넣기', [field('AI 가 준 답(JSON)', ta)], [{ label: '취소' }, { label: '표에 채우기', primary: true, onClick: function () { return answer(ta.value); } }]);
          }
        }, 'AI 답 붙여넣기')));
  }

  // ── 머리·메뉴 ──────────────────────────────────────────────
  var MENU = [
    ['#/cases', '검사 건'], ['#/spec', '치수 기준표'], ['#/meas', '측정결과'], ['#/result', '판정 결과'],
    ['#/drawing', '도면 보기'], ['#/daily', '일일점검(과제 B)'], ['#/data', '설정·데이터']
  ];
  function renderNav(route) {
    var nav = document.getElementById('nav');
    nav.textContent = '';
    MENU.forEach(function (m) {
      nav.appendChild(h('a', { href: m[0], 'aria-current': route.indexOf(m[0]) === 0 ? 'page' : null }, m[1]));
    });
    document.getElementById('sampleBanner').hidden = !db._sample;
    updateNetBadge();
  }
  function pageHead(title, extra) { return h('div', { class: 'page-head' }, h('h1', null, title), extra || null); }
  function caseLine(it) {
    return [it.part_no || '(품번 없음)', it.rev ? 'Rev ' + it.rev : '', it.lot ? 'LOT ' + it.lot : '', it.insp_date].filter(Boolean).join(' · ');
  }
  function needCase(title) {
    var it = cur();
    if (it) return it;
    main.appendChild(pageHead(title));
    main.appendChild(h('div', { class: 'card' },
      h('p', null, '먼저 검사 건을 등록하거나 고르십시오.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/cases' }, '검사 건으로 가기'),
        h('button', { class: 'btn', type: 'button', onclick: function () { loadSample(); } }, '예시 데이터 불러오기'))));
    return null;
  }
  function caseBar(it) {
    return h('div', { class: 'mode-note' }, '현재 검사 건: ', h('b', null, caseLine(it)), it.vendor ? ' · 업체 ' + it.vendor : '', ' ',
      h('a', { href: '#/cases' }, '바꾸기'));
  }

  function loadSample() {
    function doIt() {
      S.clearAll(); memImages = {};
      db = Sample.build();
      var dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Sample.drawingSvg());
      if (!S.setImage(db.current, dataUrl)) memImages[db.current] = dataUrl;
      save();
      toast('예시 데이터를 불러왔습니다. 모두 가상 값입니다.');
      go('#/result');
    }
    if (db.inspections.length || db.daily.records.length) confirmBox('예시 데이터 불러오기', '지금 이 브라우저에 있는 검사 건·점검 데이터를 지우고 예시 데이터로 바꿉니다. 먼저 「설정·데이터」에서 엑셀 백업을 받아 두십시오.', '바꾸기', doIt);
    else doIt();
  }

  // ── 검사 건 ────────────────────────────────────────────────
  function viewCases() {
    var it = cur();
    main.appendChild(pageHead('검사 건'));
    if (!db.inspections.length) {
      main.appendChild(h('div', { class: 'card' },
        h('h2', null, '처음 쓰시나요?'),
        h('p', null, '가상 부품으로 만든 예시 검사 건으로 흐름을 먼저 볼 수 있습니다. 예시 데이터는 실제 도면·측정값이 아닙니다.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { loadSample(); } }, '예시 데이터 불러오기')));
    }
    var f = h('form', { class: 'card', novalidate: true });
    var FIELDS = [['part_no', '품번 *'], ['rev', 'Rev'], ['lot', 'LOT'], ['insp_date', '검사일'], ['vendor', '업체'], ['inspector', '검사자']];
    append(f, h('h2', null, it ? '검사 건 정보 (현재 건 수정 또는 새로 등록)' : '새 검사 건 등록'));
    append(f, h('div', { class: 'form-grid' }, FIELDS.map(function (x) {
      return field(x[1], h('input', { name: x[0], type: x[0] === 'insp_date' ? 'date' : 'text', value: it ? it[x[0]] : (x[0] === 'insp_date' ? today() : '') }));
    })));
    function values() { var o = {}; FIELDS.forEach(function (x) { o[x[0]] = f.elements[x[0]].value.trim(); }); return o; }
    append(f, h('div', { class: 'btn-row', style: 'margin-top:16px' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, '새 검사 건으로 등록'),
      it ? h('button', {
        class: 'btn', type: 'button', onclick: function () {
          var v = values(); if (!v.part_no) { toast('품번을 입력하십시오.', true); return; }
          Object.keys(v).forEach(function (k) { it[k] = v[k]; }); save(); toast('현재 검사 건 정보를 고쳤습니다.'); render();
        }
      }, '현재 검사 건 정보 고치기') : null,
      it ? h('button', {
        class: 'btn', type: 'button', onclick: function () {
          var v = values(); if (!v.part_no) { toast('품번을 입력하십시오.', true); return; }
          var n = L.newInspection(v); n.spec = JSON.parse(JSON.stringify(it.spec)); n.pins = JSON.parse(JSON.stringify(it.pins));
          n.drawing_name = it.drawing_name;
          var img = imageOf(it.id); if (img && !S.setImage(n.id, img)) memImages[n.id] = img;
          db.inspections.push(n); db.current = n.id; save(); toast('기준표·도면·핀을 복사해 새 검사 건을 만들었습니다. 측정결과는 비어 있습니다.'); render();
        }
      }, '같은 품번 새 LOT (기준표·도면 복사)') : null));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = values(); if (!v.part_no) { toast('품번을 입력하십시오.', true); return; }
      var n = L.newInspection(v); db.inspections.push(n); db.current = n.id; save();
      toast('검사 건을 등록했습니다. 치수 기준표를 입력하십시오.'); go('#/spec');
    });
    main.appendChild(f);
    if (db.inspections.length) {
      main.appendChild(h('div', { class: 'card' }, h('h2', null, '검사 건 목록 (' + db.inspections.length + '건)'),
        h('div', { class: 'case-list' }, db.inspections.map(function (x) {
          var ev = L.evaluate(x, db.settings);
          return h('div', { class: 'case-item' + (x.id === db.current ? ' current' : '') },
            h('h3', null, caseLine(x)),
            h('div', { class: 'meta' }, (x.vendor ? '업체 ' + x.vendor + ' · ' : '') + '기준 ' + x.spec.length + '개 · 측정 ' + x.meas.length + '개'),
            h('div', { class: 'btn-row', style: 'margin-bottom:8px' }, badge('OK'), ' ' + ev.counts.OK, badge('NOK'), ' ' + ev.counts.NOK, badge('CHECK'), ' ' + ev.counts.CHECK),
            h('div', { class: 'btn-row' },
              x.id === db.current ? h('span', { class: 'note' }, '현재 선택') :
                h('button', { class: 'btn btn-small', type: 'button', onclick: function () { db.current = x.id; save(); render(); } }, '고르기'),
              h('button', { class: 'btn btn-small', type: 'button', onclick: function () { db.current = x.id; save(); go('#/result'); } }, '판정 결과'),
              h('button', {
                class: 'btn btn-small btn-danger', type: 'button', onclick: function () {
                  confirmBox('검사 건 지우기', caseLine(x) + ' 을(를) 지웁니다. 되돌릴 수 없습니다.', '지우기', function () {
                    db.inspections = db.inspections.filter(function (y) { return y.id !== x.id; });
                    S.delImage(x.id); delete memImages[x.id];
                    if (db.current === x.id) db.current = db.inspections.length ? db.inspections[0].id : null;
                    save(); render();
                  });
                }
              }, '지우기')));
        }))));
    }
  }

  // ── 치수 기준표 ─────────────────────────────────────────────
  var SPEC_COLS = [['no', '항목번호', 'nowrap'], ['name', '항목명', 'wide'], ['type', '치수 종류'], ['nominal', '기준값'],
    ['tol_upper', '상한공차(+)'], ['tol_lower', '하한공차(-)'], ['unit', '단위'], ['decimals', '자리수']];
  function viewSpec() {
    var it = needCase('치수 기준표'); if (!it) return;
    main.appendChild(pageHead('치수 기준표'));
    main.appendChild(caseBar(it));
    function addRows(objs, replace) {
      it.spec = replace ? objs : it.spec.concat(objs); save();
      toast('기준 ' + objs.length + '줄을 ' + (replace ? '넣었습니다(기존 기준표 교체).' : '덧붙였습니다.')); render();
    }
    function askReplace(objs) {
      if (!it.spec.length) { addRows(objs, true); return; }
      dialog('기존 기준표가 있습니다', h('p', null, '지금 기준표 ' + it.spec.length + '줄이 있습니다. 새로 읽은 ' + objs.length + '줄로 바꿀까요, 뒤에 덧붙일까요?'),
        [{ label: '취소' }, { label: '뒤에 덧붙이기', onClick: function () { addRows(objs, false); } }, { label: '바꾸기', primary: true, onClick: function () { addRows(objs, true); } }]);
    }
    main.appendChild(h('div', { class: 'card' },
      h('p', null, '도면의 치수를 한 줄에 하나씩 넣습니다. 항목번호는 도면의 풍선 번호와 같게 적으십시오. 측정결과와 이 번호로 맞춥니다.'),
      h('p', { class: 'note' }, '공차는 기준값에서 더하는 값입니다. 예: 10 ±0.1 → 상한공차 0.1, 하한공차 -0.1 / 단측 8 +0.05/0 → 상한 0.05, 하한 0. 엑셀에 「±0.1」처럼 한 칸으로 적혀 있으면 가져올 때 「공차(한 칸 표기)」 열로 지정하면 나눠 넣습니다.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: function () { pasteDialog('spec', '엑셀에서 붙여넣기', '항목번호\t항목명\t기준값\t공차\n1\t전장\t100\t±0.2', askReplace); } }, '엑셀에서 붙여넣기'),
        fileButton('파일에서 가져오기(xlsx·csv)', '.xlsx,.xls,.csv,.tsv,.txt', function (file) { readTableFile(file, function (rows, nm) { mappingDialog('spec', rows, nm, askReplace); }); }),
        h('button', { class: 'btn', type: 'button', onclick: function () { it.spec.push({ no: String(nextNo(it)), name: '', type: '', nominal: '', tol_upper: '', tol_lower: '', unit: 'mm', decimals: '' }); save(); render(); } }, '행 추가'),
        it.spec.length ? h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { confirmBox('기준표 비우기', '기준표 ' + it.spec.length + '줄을 모두 지웁니다.', '비우기', function () { it.spec = []; save(); render(); }); } }, '기준표 비우기') : null)));
    if (!it.spec.length) { main.appendChild(h('p', { class: 'note' }, '아직 기준이 없습니다.')); return; }
    var lim = h('span', { class: 'note' });
    var table = h('table', { class: 'list edit' },
      h('thead', null, h('tr', null, SPEC_COLS.map(function (c) { return h('th', null, c[1]); }), h('th', null, '하한 ~ 상한'), h('th', null, ''))),
      h('tbody', null, it.spec.map(function (s, i) {
        var rangeCell = h('td', { class: 'num' });
        function updRange() { var l = L.specLimits(s); rangeCell.textContent = l.error ? L.REASONS[l.error].split('(')[0] : l.lower + ' ~ ' + l.upper; }
        updRange();
        return h('tr', null, SPEC_COLS.map(function (c) {
          var ctl;
          if (c[0] === 'type') {
            ctl = h('select', { 'aria-label': c[1] }, h('option', { value: '' }, '-'), L.DIM_TYPES.map(function (t) { return h('option', { value: t }, t); }));
            if (s.type && L.DIM_TYPES.indexOf(s.type) < 0) ctl.appendChild(h('option', { value: s.type }, s.type));
            ctl.value = s.type || '';
          } else ctl = h('input', { type: 'text', inputmode: /nominal|tol|decimals/.test(c[0]) ? 'decimal' : null, value: fmtNum(s[c[0]]), 'aria-label': c[1] + ' ' + (i + 1) + '행' });
          ctl.addEventListener('change', function () { s[c[0]] = ctl.value.trim(); save(); updRange(); });
          return h('td', { class: c[2] || null }, ctl);
        }), rangeCell, h('td', null, h('button', { class: 'btn btn-small', type: 'button', 'aria-label': (i + 1) + '행 지우기', onclick: function () { it.spec.splice(i, 1); save(); render(); } }, '지우기')));
      })));
    main.appendChild(h('div', { class: 'list-meta' }, h('b', null, '기준 ' + it.spec.length + '줄'), lim, h('a', { class: 'btn', href: '#/meas' }, '다음: 측정결과')));
    main.appendChild(h('div', { class: 'table-wrap' }, table));
  }
  function nextNo(it) {
    var mx = 0; it.spec.forEach(function (s) { var n = parseInt(s.no, 10); if (n > mx) mx = n; }); return mx + 1;
  }

  // ── 측정결과 ────────────────────────────────────────────────
  function viewMeas() {
    var it = needCase('측정결과'); if (!it) return;
    main.appendChild(pageHead('측정결과'));
    main.appendChild(caseBar(it));
    function addMeas(objs, source) {
      objs = objs.map(function (o) {
        var r = { no: String(o.no == null ? '' : o.no), name: o.name || '', value: o.value, unit: o.unit || '', source: source };
        ['nominal', 'tol_upper', 'tol_lower', 'photo'].forEach(function (k) { if (o[k] != null && o[k] !== '') r[k] = o[k]; });
        return r;
      });
      var had = it.meas.filter(function (m) { return m.source === source; }).length;
      function put(replace) {
        if (replace) it.meas = it.meas.filter(function (m) { return m.source !== source; });
        it.meas = it.meas.concat(objs); save(); toast(source + ' 측정값 ' + objs.length + '개를 넣었습니다.'); render();
      }
      if (!had) { put(false); return; }
      dialog('이미 ' + source + ' 측정값이 있습니다', h('p', null, '지금 ' + source + ' 측정값 ' + had + '개가 있습니다. 새로 읽은 ' + objs.length + '개로 바꿀까요, 덧붙일까요?'),
        [{ label: '취소' }, { label: '덧붙이기', onClick: function () { put(false); } }, { label: '바꾸기', primary: true, onClick: function () { put(true); } }]);
    }
    main.appendChild(h('div', { class: 'card' },
      h('h2', null, 'CMM 결과 가져오기'),
      h('p', null, 'CMM 장비가 내보낸 Excel/CSV 파일을 고르면, 어느 열이 측정번호·항목명·측정값·단위인지 지정하는 단계가 나옵니다. 장비별로 열 지정을 템플릿으로 저장해 두면 다음부터 고르기만 하면 됩니다.'),
      h('p', { class: 'note' }, 'CMM 결과에 기준값(Nominal)·공차(+Tol/-Tol) 열이 있으면 함께 지정해 주십시오(선택). 측정번호가 없거나 도면 번호와 달라도 아래 「번호 없는 측정 짝 맞추기」에서 기준값·공차로 도면 항목을 찾아 드립니다.'),
      h('div', { class: 'btn-row' },
        fileButton('CMM 파일 고르기(xlsx·csv)', '.xlsx,.xls,.csv,.tsv,.txt', function (file) { readTableFile(file, function (rows, nm) { mappingDialog('meas', rows, nm, function (o) { addMeas(o, 'CMM'); }); }); }),
        h('button', { class: 'btn', type: 'button', onclick: function () { pasteDialog('meas', 'CMM 결과 붙여넣기', 'Point\tFeature\tActual\tUnit\n1\tLENGTH\t100.12\tmm', function (o) { addMeas(o, 'CMM'); }); } }, 'CMM 결과 붙여넣기'),
        h('button', { class: 'btn', type: 'button', onclick: function () { pdfPasteDialog(function (o) { addMeas(o, 'CMM'); }); } }, 'PDF 성적서 글자 붙여넣기'))));
    main.appendChild(matchCard(it));

    main.appendChild(handPhotoCard(it, addMeas));

    // 수기 측정 입력 (한 줄씩)
    var mf = h('form', { class: 'card', novalidate: true });
    var noSel = h('input', { name: 'no', list: 'specNoList', 'aria-label': '항목번호' });
    append(mf, h('h2', null, '수기 측정값 입력'),
      h('p', { class: 'note' }, '종이 검사표의 값을 한 줄씩 옮겨 적습니다. 사진을 보며 여러 항목을 한 번에 넣으려면 위 「수기 측정표 사진으로 등록」을 쓰십시오. 엑셀에 있으면 「수기 측정 붙여넣기」로 한 번에 넣을 수 있습니다.'),
      h('datalist', { id: 'specNoList' }, it.spec.map(function (s) { return h('option', { value: s.no }, s.name); })),
      h('div', { class: 'form-grid' },
        field('항목번호 *', noSel),
        field('측정값 *', h('input', { name: 'value', inputmode: 'decimal' })),
        field('단위(비우면 기준표 단위)', h('input', { name: 'unit' }))),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, '수기 측정값 추가'),
        h('button', { class: 'btn', type: 'button', onclick: function () { pasteDialog('meas', '수기 측정 붙여넣기', '항목번호\t측정값\n9\t30.2', function (o) { addMeas(o, '수기'); }); } }, '수기 측정 붙여넣기')));
    mf.addEventListener('submit', function (e) {
      e.preventDefault();
      var no = mf.elements.no.value.trim(), v = mf.elements.value.value.trim();
      if (!no || !v) { toast('항목번호와 측정값을 넣으십시오.', true); return; }
      var s = it.spec.filter(function (x) { return L.normKey(x.no) === L.normKey(no); })[0];
      it.meas.push({ no: no, name: s ? s.name : '', value: v, unit: mf.elements.unit.value.trim(), source: '수기' });
      save(); toast(no + '번 수기 측정값을 넣었습니다.'); render();
      setTimeout(function () { var el = main.querySelector('input[name=no]'); if (el) el.focus(); }, 0);
    });
    main.appendChild(mf);

    if (!it.meas.length) { main.appendChild(h('p', { class: 'note' }, '아직 측정값이 없습니다.')); return; }
    var bySrc = {}; it.meas.forEach(function (m) { bySrc[m.source || '-'] = (bySrc[m.source || '-'] || 0) + 1; });
    main.appendChild(h('div', { class: 'list-meta' },
      h('b', null, '측정값 ' + it.meas.length + '개'),
      h('span', { class: 'note' }, Object.keys(bySrc).map(function (k) { return k + ' ' + bySrc[k]; }).join(' · ')),
      h('a', { class: 'btn btn-primary', href: '#/result' }, '판정 결과 보기'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { confirmBox('측정값 비우기', '측정값 ' + it.meas.length + '개를 모두 지웁니다.', '비우기', function () { it.meas = []; save(); render(); }); } }, '측정값 비우기')));
    main.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['출처', '측정번호', '항목명', '측정값', '단위', '기준값·공차(측정 파일)', ''].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, it.meas.map(function (m, i) {
        var how = m.matched === 'suggest' ? '짝 제안으로 연결' : m.matched === 'auto_no' ? '자동 번호' : '';
        if (how && m.orig_no) how += ' (원래 ' + m.orig_no + ')';
        return h('tr', null, h('td', { class: 'nowrap' }, m.source), h('td', { class: 'nowrap' }, m.no || '(없음)', how ? h('span', { class: 'sub' }, how) : null), h('td', null, m.name),
          h('td', { class: 'num' }, fmtNum(m.value)), h('td', null, m.unit),
          h('td', { class: 'num' }, m.nominal == null || m.nominal === '' ? '' : fmtNum(m.nominal) + (m.tol_upper != null || m.tol_lower != null ? ' ' + signed(L.parseNum(m.tol_upper)) + '/' + signed(L.parseNum(m.tol_lower)) : '')),
          h('td', null, h('button', { class: 'btn btn-small', type: 'button', onclick: function () { it.meas.splice(i, 1); save(); render(); } }, '지우기')));
      })))));
  }

  // PDF 성적서: 직접 읽지 않고, PDF 뷰어에서 표를 드래그해 복사한 글자를 붙여 넣습니다.
  function pdfPasteDialog(onDone) {
    var ta = h('textarea', { name: 'pdftext', rows: 10, placeholder: 'No Feature Nominal +Tol -Tol Actual\n1 LENGTH 100.000 0.200 -0.200 100.120' });
    dialog('PDF 성적서 글자 붙여넣기', [
      h('p', { class: 'note' }, 'PDF 뷰어(엣지·크롬·아크로뱃)에서 측정표 부분을 드래그해 복사(Ctrl+C)한 뒤 여기에 붙여 넣으십시오. 줄마다 칸을 나눈 뒤 다음 단계에서 열을 지정합니다. 스캔한 PDF(글자를 드래그할 수 없는 그림 PDF)는 사진처럼 「수기 측정표 사진으로 등록」으로 옮겨 적으십시오.'),
      field('복사한 글자', ta)],
      [{ label: '취소' }, {
        label: '다음(열 지정)', primary: true, onClick: function () {
          var rows = L.textToRows(ta.value);
          if (!rows.length) { toast('붙여 넣은 내용이 없습니다.', true); return false; }
          setTimeout(function () { mappingDialog('meas', rows, 'PDF 붙여넣기', onDone); }, 0);
        }
      }]);
  }

  // 번호 없는 측정 ↔ 도면 항목 짝 맞추기 (logic.js suggestMatches)
  function matchCard(it) {
    var ev = L.evaluate(it, db.settings);
    var card = h('div', { class: 'card', id: 'matchCard' }, h('h2', null, '번호 없는 측정 짝 맞추기'));
    if (!ev.extra.length) {
      append(card, h('p', { class: 'note' }, it.meas.length ? '모든 측정값이 기준표 항목과 짝지어져 있습니다.' : '측정값을 넣으면, 번호가 없거나 도면 번호와 맞지 않는 측정을 여기서 기준값·공차로 짝지어 드립니다.'));
      return card;
    }
    var sug = L.suggestMatches(it, db.settings);
    var withNominal = sug.filter(function (x) { return L.parseNum(it.meas[x.meas].nominal) != null; }).length;
    append(card, h('p', null, '기준표와 짝이 없는 측정 ' + sug.length + '개가 있습니다. 측정 결과에 적힌 기준값·공차가 같은 도면 항목을 찾아 제안합니다. 확인한 줄만 골라 「고른 짝 반영」을 누르십시오.'),
      h('p', { class: 'note' }, '신뢰도 높음 = 기준값·공차가 같은 항목이 하나뿐 / 보통 = 같은 기준 항목이 여럿이라 측정 순서대로 짝지었거나 공차가 다름 / 낮음 = 기준값 정보 없이 측정값이 공차 안에 드는 항목(참고용). 판정은 반영한 뒤 계산합니다.'));
    var checks = [];
    append(card, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['반영', '측정(출처·번호·항목명)', '측정값', '기준값·공차', '제안 항목', '신뢰도', '근거'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, sug.map(function (x) {
        var m = it.meas[x.meas];
        var sel = h('select', { 'aria-label': '붙일 항목번호' }, h('option', { value: '' }, '(짝 없음)'),
          it.spec.filter(function (s) { return L.normKey(s.no); }).map(function (s) { return h('option', { value: s.no }, s.no + '번 ' + (s.name || '') + ' · ' + fmtNum(s.nominal)); }));
        sel.value = x.no || '';
        var cb = h('input', { type: 'checkbox', 'aria-label': '이 짝 반영', checked: x.level === 'high' || x.level === 'mid' });
        sel.addEventListener('change', function () { cb.checked = !!sel.value; });
        checks.push({ cb: cb, sel: sel, meas: x.meas });
        return h('tr', { class: x.no ? null : 'row-CHECK' },
          h('td', null, cb),
          h('td', null, (m.source || '-') + ' · ' + (m.no || '번호 없음') + (m.name ? ' · ' + m.name : '')),
          h('td', { class: 'num' }, fmtNum(m.value) + (m.unit ? ' ' + m.unit : '')),
          h('td', { class: 'num' }, m.nominal == null || m.nominal === '' ? '-' : fmtNum(m.nominal) + ' ' + signed(L.parseNum(m.tol_upper)) + '/' + signed(L.parseNum(m.tol_lower))),
          h('td', null, sel, x.alts.length ? h('span', { class: 'sub' }, '다른 후보: ' + x.alts.join(', ')) : null),
          h('td', { class: 'nowrap' }, x.level ? h('span', { class: 'lv lv-' + x.level }, L.MATCH_LEVEL[x.level]) : '제안 없음'),
          h('td', { class: 'reason' }, x.no ? L.matchWhyText(x.why) : '기준값이 같은 도면 항목이 없습니다. 기준표에 항목을 추가하거나 직접 고르십시오.'));
      })))));
    append(card, h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', {
        class: 'btn btn-primary', type: 'button', onclick: function () {
          var picks = checks.filter(function (c) { return c.cb.checked && c.sel.value; }).map(function (c) { return { meas: c.meas, no: c.sel.value }; });
          if (!picks.length) { toast('반영할 줄을 고르십시오.', true); return; }
          var n = L.applyMatches(it, picks); save(); toast(n + '개 측정을 도면 항목과 짝지었습니다.'); render();
        }
      }, '고른 짝 반영'),
      withNominal ? h('button', {
        class: 'btn', type: 'button', onclick: function () {
          confirmBox('측정 결과로 기준표 항목 만들기', '짝이 없는 측정 중 기준값이 있는 ' + withNominal + '개를 기준표에 새 항목으로 넣고 번호를 ' + L.nextSpecNo(it.spec) + '번부터 자동으로 매깁니다. 도면에 풍선 번호가 없을 때 쓰십시오. 이후 「도면 보기」에서 번호 순서대로 위치를 눌러 풍선을 찍으면 됩니다.', '만들기', function () {
            var n = L.specFromMeas(it, db.settings); save(); toast('기준표에 ' + n + '개 항목을 자동 번호로 넣었습니다.'); render();
          });
        }
      }, '기준값으로 기준표 항목 만들기(자동 번호)') : null));
    return card;
  }

  // 수기 측정표 사진 → 사진 옆 입력표에 옮겨 적기 (+ 선택: AI 읽기)
  function handPhotoCard(it, addMeas) {
    var ph = ui.handPhoto && ui.handPhoto.insp === it.id ? ui.handPhoto : null;
    var card = h('div', { class: 'card', id: 'handPhoto' }, h('h2', null, '수기 측정표 사진으로 등록'),
      h('p', null, '종이 측정표를 휴대폰으로 찍거나 사진 파일을 올리면, 사진을 옆에 띄워 두고 항목별 측정값을 옮겨 적을 수 있습니다. 사진은 저장하지 않고 이 화면에만 띄웁니다.'),
      h('div', { class: 'btn-row' },
        photoButton(ph ? '다른 사진 찍기·올리기' : '사진 찍기·올리기', function (f) {
          readPhoto(f, function (p) { p.insp = it.id; ui.handPhoto = p; ui.handVals = {}; ui.handExtra = [{ no: '', value: '' }, { no: '', value: '' }]; render(); });
        }),
        ph ? h('button', { class: 'btn', type: 'button', onclick: function () { ui.handPhoto = null; render(); } }, '사진 닫기') : null),
      offline() ? h('p', { class: 'note' }, '폐쇄망 모드라 사진 속 숫자를 자동으로 읽지 않습니다(브라우저 자체에는 글자 인식 기능이 없고, 외부 판독 서비스로 보내지 않기 때문입니다). 확대·회전해 보면서 옮겨 적으십시오.') : null);
    if (!ph) return card;
    var vals = ui.handVals || (ui.handVals = {});
    var extra = ui.handExtra || (ui.handExtra = []);
    function valInput(key, obj) {
      var inp = h('input', { type: 'text', inputmode: 'decimal', value: obj.value || '', 'aria-label': key + '번 측정값', class: obj.ai ? (obj.unsure ? 'ai-unsure' : 'ai-filled') : null });
      inp.addEventListener('input', function () { obj.value = inp.value; obj.ai = false; inp.className = ''; });
      return inp;
    }
    var rows = it.spec.filter(function (s) { return L.normKey(s.no); }).map(function (s) {
      var o = vals[s.no] || (vals[s.no] = { value: '' });
      return h('tr', null, h('td', { class: 'nowrap' }, s.no), h('td', null, s.name || ''),
        h('td', { class: 'num' }, fmtNum(s.nominal) + ' ' + (s.tol_upper !== '' || s.tol_lower !== '' ? signed(L.parseNum(s.tol_upper)) + '/' + signed(L.parseNum(s.tol_lower)) : '')),
        h('td', null, valInput(s.no, o)));
    });
    extra.forEach(function (o, i) {
      var noIn = h('input', { type: 'text', value: o.no || '', 'aria-label': '추가 줄 ' + (i + 1) + ' 항목번호', placeholder: '번호' });
      noIn.addEventListener('input', function () { o.no = noIn.value; });
      rows.push(h('tr', null, h('td', null, noIn), h('td', { class: 'note' }, '기준표에 없는 번호'), h('td'), h('td', null, valInput('추가 ' + (i + 1), o))));
    });
    var form = h('div', { class: 'photo-entry-form' },
      h('p', { class: 'note' }, '사진을 보며 측정값 칸만 채우십시오. 빈칸은 등록하지 않습니다. 노란 칸은 AI 가 확실하지 않다고 한 값, 파란 칸은 AI 가 채운 값입니다.'),
      h('div', { class: 'table-wrap entry-table' }, h('table', { class: 'list edit' },
        h('thead', null, h('tr', null, ['번호', '항목명', '기준·공차', '측정값'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, rows))),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: function () { extra.push({ no: '', value: '' }); render(); } }, '줄 추가'),
        h('button', {
          class: 'btn btn-primary', type: 'button', onclick: function () {
            var objs = [];
            Object.keys(vals).forEach(function (no) { var o = vals[no]; if (String(o.value || '').trim()) objs.push({ no: no, name: '', value: String(o.value).trim(), unit: '' }); });
            extra.forEach(function (o) { if (String(o.value || '').trim()) objs.push({ no: String(o.no || '').trim(), name: '', value: String(o.value).trim(), unit: '' }); });
            if (!objs.length) { toast('옮겨 적은 측정값이 없습니다.', true); return; }
            objs.forEach(function (o) { var s = it.spec.filter(function (x) { return L.normKey(x.no) === L.normKey(o.no); })[0]; if (s) o.name = s.name; });
            var photo = ph.name;
            ui.handPhoto = null;
            addMeas(objs.map(function (o) { o.photo = photo; return o; }), '수기');
          }
        }, '옮겨 적은 값 등록(출처: 수기)')),
      aiTools({
        photo: function () { return ph; },
        prompt: function () { return L.aiPromptMeasure(it.spec); },
        onRows: function (rs) {
          rs.forEach(function (r) {
            var k = it.spec.filter(function (s) { return L.normKey(s.no) === L.normKey(r.no); })[0];
            var tgt = k ? (vals[k.no] = vals[k.no] || {}) : null;
            if (!tgt) { tgt = { no: r.no || '' }; extra.push(tgt); }
            tgt.value = r.value || ''; tgt.ai = true; tgt.unsure = !!r.unsure;
          });
          render();
        }
      }));
    append(card, h('div', { class: 'photo-entry' }, photoViewer(ph), form));
    return card;
  }

  // ── 판정 결과 ───────────────────────────────────────────────
  function viewResult() {
    var it = needCase('판정 결과'); if (!it) return;
    var ev = L.evaluate(it, db.settings);
    main.appendChild(pageHead('판정 결과', h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { exportReport(it, ev); } }, '검사성적서 Excel 내려받기'),
      h('button', { class: 'btn', type: 'button', onclick: function () { downloadCsv(prefix() + '판정결과_' + safeName(it.part_no) + '_' + stamp() + '.csv', L.reportRows(ev)); } }, 'CSV 내려받기'))));
    main.appendChild(caseBar(it));
    main.appendChild(h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('b', null, String(ev.counts.total)), h('span', null, '전체 항목')),
      h('div', { class: 'tile OK' }, h('b', null, String(ev.counts.OK)), h('span', null, 'OK')),
      h('div', { class: 'tile NOK' }, h('b', null, String(ev.counts.NOK)), h('span', null, 'NOK')),
      h('div', { class: 'tile CHECK' }, h('b', null, String(ev.counts.CHECK)), h('span', null, '확인필요'))));
    main.appendChild(h('p', { class: 'note' }, '판정은 기준값·공차·측정값으로 계산합니다(AI 추정 아님). 매칭이 안 되었거나 값·단위·공차가 모호한 항목은 억지로 판정하지 않고 「확인필요」로 둡니다. 판정 규칙은 「설정·데이터」에서 바꿉니다.'));
    var fbar = h('div', { class: 'btn-row', role: 'group', 'aria-label': '판정 거르기' },
      [['ALL', '전체'], ['NOK', 'NOK만'], ['CHECK', '확인필요만'], ['OK', 'OK만']].map(function (f) {
        return h('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': ui.resultFilter === f[0] ? 'true' : 'false', onclick: function () { ui.resultFilter = f[0]; render(); } }, f[1]);
      }));
    main.appendChild(h('div', { class: 'list-meta' }, fbar));
    var rows = ev.rows.map(function (r) { return { r: r, extra: false }; }).concat(ev.extra.map(function (x) { return { r: x, extra: true }; }))
      .filter(function (x) { return ui.resultFilter === 'ALL' || x.r.status === ui.resultFilter; });
    if (!it.spec.length) main.appendChild(h('div', { class: 'alert info' }, '치수 기준표가 비어 있습니다. ', h('a', { href: '#/spec' }, '기준표 입력하기')));
    main.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['판정', '항목번호', '항목명', '종류', '기준값', '공차', '하한 ~ 상한', '측정값', '편차', '이탈량', '출처', '확인필요 사유'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, rows.map(function (x) {
        var r = x.r;
        if (x.extra) {
          return h('tr', { class: 'row-CHECK' }, h('td', null, badge('CHECK')), h('td', { class: 'nowrap' }, r.no), h('td', null, r.name), h('td'), h('td'), h('td'), h('td'),
            h('td', { class: 'num' }, fmtNum(r.value) + (r.unit ? ' ' + r.unit : '')), h('td'), h('td'), h('td', null, r.source), h('td', { class: 'reason' }, L.reasonText(r.reasons)));
        }
        var tol = (r.tol_upper !== '' || r.tol_lower !== '') ? signed(L.parseNum(r.tol_upper)) + ' / ' + signed(L.parseNum(r.tol_lower)) : '';
        return h('tr', {
          class: 'row-' + r.status + ' click', tabindex: '0', title: '도면에서 보기',
          onclick: function () { ui.selectedPin = r.no; go('#/drawing'); },
          onkeydown: function (e) { if (e.key === 'Enter') { ui.selectedPin = r.no; go('#/drawing'); } }
        },
          h('td', null, badge(r.status)), h('td', { class: 'nowrap' }, r.no), h('td', null, r.name), h('td', { class: 'nowrap' }, r.type),
          h('td', { class: 'num' }, fmtNum(r.nominal) + (r.unit ? ' ' + r.unit : '')), h('td', { class: 'num' }, tol),
          h('td', { class: 'num' }, r.lower == null ? '' : r.lower + ' ~ ' + r.upper),
          h('td', { class: 'num' }, fmtNum(r.value) + (r.results.length > 1 ? ' (' + r.results.length + '건)' : '')),
          h('td', { class: 'num' }, signed(r.deviation)), h('td', { class: 'num' }, r.status === 'NOK' ? signed(r.over) : ''),
          h('td', null, r.results.map(function (y) { return y.source; }).filter(Boolean).join(', ')),
          h('td', { class: 'reason' }, L.reasonText(r.reasons)));
      })))));
  }
  function exportReport(it, ev) {
    var info = [
      ['초도품 검사성적서 (1단계 범용 양식)'], [],
      ['품번', it.part_no, 'Rev', it.rev], ['LOT', it.lot, '검사일', it.insp_date], ['업체', it.vendor, '검사자', it.inspector],
      ['판정 요약', 'OK ' + ev.counts.OK + ' / NOK ' + ev.counts.NOK + ' / 확인필요 ' + ev.counts.CHECK + ' (전체 ' + ev.counts.total + ')'],
      ['판정 규칙', '항목번호 직접 매칭' + (db.settings.match_by_name ? '(번호 없으면 항목명)' : '') + ' · 판정 전 반올림 ' + (db.settings.round_before_judge ? '함' : '안 함') + ' · 경계값 포함'],
      ['만든 시각', new Date().toLocaleString('ko-KR')]
    ];
    if (db._sample) info.splice(1, 0, ['예시 데이터 — 가상 부품·가상 측정값입니다. 실제 성적서가 아닙니다.']);
    var sheets = { '성적서': info.concat([[]], L.reportRows(ev)) };
    sheets['치수기준표'] = [['항목번호', '항목명', '치수 종류', '기준값', '상한공차', '하한공차', '단위', '자리수']].concat(it.spec.map(function (s) { return [s.no, s.name, s.type, s.nominal, s.tol_upper, s.tol_lower, s.unit, s.decimals]; }));
    sheets['측정원본'] = [['출처', '측정번호', '항목명', '측정값', '단위']].concat(it.meas.map(function (m) { return [m.source, m.no, m.name, m.value, m.unit]; }));
    downloadXlsx(prefix() + '검사성적서_' + safeName(it.part_no) + '_' + safeName(it.lot) + '_' + stamp() + '.xlsx', sheets);
  }

  // ── 도면 보기 ───────────────────────────────────────────────
  function imageOf(id) { return memImages[id] || S.getImage(id); }
  function loadDrawing(it, file) {
    var name = file.name.toLowerCase();
    if (/\.pdf$/.test(name)) { toast('PDF 는 1단계에서 바로 읽지 않습니다. 도면을 PNG·JPG 로 저장해 올려 주십시오.', true); return; }
    function store(dataUrl) {
      it.drawing_name = file.name;
      memImages[it.id] = dataUrl;
      if (S.setImage(it.id, dataUrl)) delete memImages[it.id];
      else showStoreBanner('도면 이미지가 커서 브라우저 저장 공간에 넣지 못했습니다. 이 화면을 닫으면 도면만 다시 올려야 합니다(핀 위치는 남습니다).');
      save(); render();
    }
    var reader = new FileReader();
    if (/\.svg$/.test(name)) {
      reader.onload = function () { store('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(reader.result)); };
      reader.readAsText(file); return;
    }
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // 저장 공간을 아끼려고 긴 변 2400px 로 줄여 둡니다(핀은 비율 좌표라 영향 없음)
        var k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        store(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { toast('이미지로 읽을 수 없는 파일입니다.', true); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function viewDrawing() {
    var it = needCase('도면 보기'); if (!it) return;
    var ev = L.evaluate(it, db.settings);
    var rowByNo = {}; ev.rows.forEach(function (r) { rowByNo[r.no] = r; });
    var src = imageOf(it.id);
    main.appendChild(pageHead('도면 보기', h('div', { class: 'btn-row' },
      src ? h('button', {
        class: 'btn', type: 'button', 'aria-pressed': ui.balloon ? 'true' : 'false',
        onclick: function () { ui.balloon = !ui.balloon; ui.placing = false; render(); }
      }, ui.balloon ? '번호 풍선 찍기 끝내기' : '번호 풍선 새로 찍기(자동 번호)') : null,
      fileButton(src ? '도면 바꾸기' : '도면 이미지 올리기', 'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg,.pdf', function (f) { loadDrawing(it, f); }))));
    main.appendChild(caseBar(it));
    if (src) main.appendChild(h('div', { class: 'mode-note' },
      ui.balloon ? h('b', null, '번호 풍선 찍기 중 — 도면에서 치수 위치를 누를 때마다 ' + L.nextSpecNo(it.spec) + '번부터 번호가 붙은 풍선이 찍히고 기준표에 새 항목이 생깁니다. 오른쪽에서 기준값·공차를 넣으십시오.')
        : '도면에 풍선 번호가 있으면 오른쪽 목록에서 그 번호를 고르고 「핀 찍기」로 위치를 누르십시오. 번호가 없으면 「번호 풍선 새로 찍기」로 1, 2, 3… 을 찍고 기준값·공차를 넣으면, 측정 결과의 기준값·공차로 짝을 자동 제안합니다(측정결과 → 번호 없는 측정 짝 맞추기).'));
    main.appendChild(h('div', { class: 'legend' }, badge('OK'), ' 공차 안 ', badge('NOK'), ' 공차 밖 ', badge('CHECK'), ' 확인필요 · 도면 파일: ' + (it.drawing_name || '없음')));
    if (!src) {
      main.appendChild(h('div', { class: 'card' }, h('p', null, '도면 이미지(PNG·JPG·SVG)를 올리면 항목 위치에 핀을 찍고 판정 색으로 볼 수 있습니다. 파일은 이 브라우저 안에서만 씁니다.'),
        h('p', { class: 'note' }, 'PDF 도면은 1단계에서 바로 읽지 않습니다. PDF 뷰어에서 이미지로 저장하거나 화면 캡처해 올려 주십시오.')));
    }
    var selected = ui.selectedPin;
    var layout = h('div', { class: 'drawing-layout' });
    var box = h('div', { class: 'drawing-box' + ((ui.placing && selected) || ui.balloon ? ' placing' : '') });
    if (src) {
      var img = h('img', { src: src, alt: '도면 ' + (it.drawing_name || '') });
      var ov = svg('svg', { class: 'overlay', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none' });
      box.appendChild(img); box.appendChild(ov);
      var drawPins = function () {
        while (ov.firstChild) ov.removeChild(ov.firstChild);
        var w = img.clientWidth || 1, hgt = img.clientHeight || 1;
        var rx = 15 * 1000 / w, ry = 15 * 1000 / hgt; // 화면에서 지름 30px 원
        Object.keys(it.pins).forEach(function (no) {
          var r = rowByNo[no]; if (!r) return;
          var p = it.pins[no];
          var g = svg('g', { class: 'pin ' + r.status + (String(no) === String(selected) ? ' sel' : ''), 'data-no': no, tabindex: '0', role: 'button', 'aria-label': no + '번 ' + L.STATUS_LABEL[r.status] },
            svg('ellipse', { cx: p.x * 1000, cy: p.y * 1000, rx: rx, ry: ry }));
          // 글자는 비율이 찌그러지지 않게 별도 svg 없이 transform 으로 보정
          var t = svg('text', { x: 0, y: 0, transform: 'translate(' + (p.x * 1000) + ' ' + (p.y * 1000 + 5 * 1000 / hgt) + ') scale(' + (1000 / w) + ' ' + (1000 / hgt) + ')' });
          t.textContent = no; g.appendChild(t);
          g.addEventListener('click', function (e) { e.stopPropagation(); ui.selectedPin = no; ui.placing = false; render(); });
          g.addEventListener('keydown', function (e) { if (e.key === 'Enter') { ui.selectedPin = no; ui.placing = false; render(); } });
          ov.appendChild(g);
        });
      };
      img.addEventListener('load', drawPins);
      ui.drawPins = drawPins;
      if (img.complete) setTimeout(drawPins, 0);
      box.addEventListener('click', function (e) {
        if (!ui.balloon && (!ui.placing || !selected)) return;
        var rect = img.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        if (ui.balloon) {
          // 도면에 번호가 없을 때: 누른 자리에 다음 번호 풍선 + 기준표 새 항목
          var no = String(L.nextSpecNo(it.spec));
          it.spec.push({ no: no, name: '', type: '', nominal: '', tol_upper: '', tol_lower: '', unit: 'mm', decimals: '' });
          it.pins[no] = { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
          ui.selectedPin = no; save();
          toast(no + '번 풍선을 찍었습니다. 기준값·공차를 넣거나 이어서 다음 위치를 누르십시오.');
          render(); return;
        }
        it.pins[selected] = { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
        save();
        // 다음 핀 안 찍힌 항목으로 자동 이동
        var next = ev.rows.filter(function (r) { return !it.pins[r.no]; })[0];
        ui.selectedPin = next ? next.no : selected; ui.placing = !!next;
        toast(selected + '번 핀을 찍었습니다.' + (next ? ' 이어서 ' + next.no + '번 위치를 누르십시오.' : ''));
        render();
      });
    }
    layout.appendChild(h('div', null, box,
      src ? h('p', { class: 'note' }, ui.placing && selected ? selected + '번 위치를 도면에서 누르십시오.' : '오른쪽 목록에서 항목을 고르고 「핀 찍기」를 누른 뒤 도면을 누르면 핀이 찍힙니다. 핀을 누르면 값을 봅니다.') : null));

    // 오른쪽: 선택 항목 상세 + 항목 목록
    var side = h('div', { class: 'card' });
    var sr = selected != null ? rowByNo[selected] : null;
    if (sr) {
      append(side, h('h2', null, sr.no + '번 ' + (sr.name || '')), h('dl', { class: 'detail-kv' },
        h('dt', null, '판정'), h('dd', null, badge(sr.status)),
        h('dt', null, '기준값'), h('dd', null, fmtNum(sr.nominal) + (sr.unit ? ' ' + sr.unit : '')),
        h('dt', null, '공차'), h('dd', null, signed(L.parseNum(sr.tol_upper)) + ' / ' + signed(L.parseNum(sr.tol_lower))),
        h('dt', null, '하한 ~ 상한'), h('dd', null, sr.lower == null ? '-' : sr.lower + ' ~ ' + sr.upper),
        h('dt', null, '측정값'), h('dd', null, sr.results.length ? sr.results.map(function (x) { return fmtNum(x.value) + (x.source ? ' (' + x.source + ')' : ''); }).join(', ') : '-'),
        h('dt', null, '편차'), h('dd', null, sr.deviation == null ? '-' : signed(sr.deviation)),
        sr.reasons.length ? h('dt', null, '사유') : null, sr.reasons.length ? h('dd', null, L.reasonText(sr.reasons)) : null));
      if (src) append(side, h('div', { class: 'btn-row', style: 'margin:10px 0 16px' },
        h('button', { class: 'btn btn-primary btn-small', type: 'button', 'aria-pressed': ui.placing ? 'true' : 'false', onclick: function () { ui.placing = !ui.placing; render(); } }, ui.placing ? '핀 찍기 취소' : (it.pins[sr.no] ? '핀 옮기기' : '핀 찍기')),
        it.pins[sr.no] ? h('button', { class: 'btn btn-small', type: 'button', onclick: function () { delete it.pins[sr.no]; ui.placing = false; save(); render(); } }, '핀 지우기') : null));
      append(side, specQuickEdit(it, sr.no));
    } else append(side, h('p', { class: 'note' }, '항목을 고르십시오.'));
    var placed = ev.rows.filter(function (r) { return it.pins[r.no]; }).length;
    append(side, h('h3', null, '항목 (' + placed + ' / ' + ev.rows.length + ' 핀 찍음)'));
    append(side, h('ul', { class: 'side-list' }, ev.rows.map(function (r) {
      return h('li', null, h('button', { type: 'button', 'aria-pressed': String(r.no) === String(selected) ? 'true' : 'false', onclick: function () { ui.selectedPin = r.no; ui.placing = src && !it.pins[r.no] ? true : false; render(); } },
        badge(r.status), h('span', { class: 'grow' }, r.no + '번 ' + (r.name || ''), h('span', { class: 'sub' }, it.pins[r.no] ? '핀 있음' : '핀 없음'))));
    })));
    layout.appendChild(side);
    main.appendChild(layout);
  }

  // 도면 옆에서 바로 고치는 기준(항목명·기준값·공차·단위) — 번호 풍선을 찍은 뒤 값을 넣는 곳
  function specQuickEdit(it, no) {
    var s = it.spec.filter(function (x) { return String(x.no) === String(no); })[0];
    if (!s) return null;
    var tolText = s.tol_upper === '' && s.tol_lower === '' ? '' :
      (L.parseNum(s.tol_upper) === -L.parseNum(s.tol_lower) && L.parseNum(s.tol_upper) > 0 ? '±' + L.parseNum(s.tol_upper) : signed(L.parseNum(s.tol_upper)) + '/' + signed(L.parseNum(s.tol_lower)));
    var f = h('form', { class: 'quick-edit', novalidate: true },
      h('h3', null, no + '번 기준 고치기'),
      field('항목명', h('input', { name: 'name', value: s.name || '' })),
      field('기준값', h('input', { name: 'nominal', inputmode: 'decimal', value: fmtNum(s.nominal) })),
      field('공차 (예: ±0.1, +0.05/0)', h('input', { name: 'tol', value: tolText })),
      field('단위', h('input', { name: 'unit', value: s.unit || '' })),
      h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, '저장'));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var tv = f.elements.tol.value.trim(), t = tv ? L.parseTolerance(tv) : { upper: '', lower: '' };
      if (!t) { toast('공차를 읽지 못했습니다. ±0.1 또는 +0.05/0 처럼 적어 주십시오.', true); return; }
      s.name = f.elements.name.value.trim(); s.nominal = f.elements.nominal.value.trim(); s.unit = f.elements.unit.value.trim();
      s.tol_upper = t.upper; s.tol_lower = t.lower; save(); toast(no + '번 기준을 저장했습니다.'); render();
    });
    return f;
  }

  // ── 과제 B: 일일점검 ────────────────────────────────────────
  function viewDaily() {
    var d = db.daily;
    main.appendChild(pageHead('일일점검 현황 (과제 B)'));
    main.appendChild(h('div', { class: 'mode-note' }, '점검 데이터는 점검표 사진을 찍어 한 설비씩 넣거나, 표(엑셀·CSV)로 한꺼번에 넣습니다. 여러 협력사가 각자 올린 사진을 본사 한 곳에 모으는 업로드 링크·메일 알림은 서버가 필요해 다음 단계입니다.'));
    main.appendChild(dailyPhotoCard(d));
    function put(key, label) {
      return function (objs) {
        if (key === 'records') objs = objs.map(function (r) { r.date = L.toDateStr(r.date); return r; });
        function set(replace) { d[key] = replace ? objs : d[key].concat(objs); save(); toast(label + ' ' + objs.length + '줄을 넣었습니다.'); render(); }
        if (!d[key].length) { set(true); return; }
        dialog('이미 ' + label + '이(가) 있습니다', h('p', null, '지금 ' + d[key].length + '줄이 있습니다. 새로 읽은 ' + objs.length + '줄로 바꿀까요, 덧붙일까요?'),
          [{ label: '취소' }, { label: '덧붙이기', onClick: function () { set(false); } }, { label: '바꾸기', primary: true, onClick: function () { set(true); } }]);
      };
    }
    function importRow(kind, key, label, hint) {
      return h('div', { class: 'btn-row' },
        fileButton(label + ' 파일', '.xlsx,.xls,.csv,.tsv,.txt', function (file) { readTableFile(file, function (rows, nm) { mappingDialog(kind, rows, nm, put(key, label)); }); }),
        h('button', { class: 'btn', type: 'button', onclick: function () { pasteDialog(kind, label + ' 붙여넣기', hint, put(key, label)); } }, label + ' 붙여넣기'),
        h('span', { class: 'note' }, d[key].length + '줄'));
    }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '1. 데이터 넣기'),
      h('p', { class: 'note' }, '설비 목록: 협력사·설비·순서 / 점검 데이터: 협력사·점검일·설비·점검항목·판정·측정값·원본사진 / 관리 기준값: 점검항목·하한·상한. 열 이름은 달라도 됩니다. 넣을 때 열을 지정합니다.'),
      importRow('equip', 'equipment', '설비 목록', '협력사\t설비\t순서\nA사\t1호기\t1'),
      h('div', { style: 'height:8px' }),
      importRow('daily', 'records', '점검 데이터', '협력사\t점검일\t설비\t점검항목\t판정\t측정값\t원본사진\nA사\t2026-09-28\t1호기\t압력\t○\t18.2\ta.jpg'),
      h('div', { style: 'height:8px' }),
      importRow('limits', 'limits', '관리 기준값', '점검항목\t하한\t상한\n압력\t15\t20')));

    // 기준값 편집 + 반복 기준
    var rep = h('input', { type: 'number', min: 2, step: 1, name: 'repeat_days', value: d.repeat_days === '' || d.repeat_days == null ? '' : d.repeat_days, placeholder: '비우면 검사 안 함' });
    rep.addEventListener('change', function () { d.repeat_days = rep.value.trim() === '' ? '' : Math.max(2, parseInt(rep.value, 10) || 2); save(); render(); });
    var limTable = h('table', { class: 'list edit' },
      h('thead', null, h('tr', null, h('th', null, '점검항목'), h('th', null, '하한'), h('th', null, '상한'), h('th'))),
      h('tbody', null, d.limits.map(function (l, i) {
        function inp(k) { var x = h('input', { value: fmtNum(l[k]), 'aria-label': k }); x.addEventListener('change', function () { l[k] = x.value.trim(); save(); render(); }); return h('td', null, x); }
        return h('tr', null, inp('item'), inp('lower'), inp('upper'), h('td', null, h('button', { class: 'btn btn-small', type: 'button', onclick: function () { d.limits.splice(i, 1); save(); render(); } }, '지우기')));
      })));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '2. 검사 기준'),
      h('p', { class: 'note' }, '관리 기준값과 반복 기준은 실제 기준을 받기 전까지 임시로 넣는 값입니다. 기준값이 없는 항목은 이탈 검사를 하지 않습니다.'),
      h('div', { class: 'form-grid' }, field('같은 측정값이 몇 번 연속이면 「확인 필요」로 볼지', rep)),
      h('div', { class: 'table-wrap', style: 'margin-top:12px' }, limTable),
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { class: 'btn btn-small', type: 'button', onclick: function () { d.limits.push({ item: '', lower: '', upper: '' }); save(); render(); } }, '기준값 행 추가'))));

    // 현황판
    var dates = d.records.map(function (r) { return L.toDateStr(r.date); }).filter(Boolean).sort();
    if (!ui.dailyDate) ui.dailyDate = dates.length ? dates[dates.length - 1] : today();
    var dateIn = h('input', { type: 'date', name: 'board_date', value: ui.dailyDate });
    dateIn.addEventListener('change', function () { ui.dailyDate = dateIn.value; render(); });
    var board = L.dailyBoard(d.equipment, d.records, ui.dailyDate);
    var bcard = h('div', { class: 'card' }, h('h2', null, '3. 등록 현황판'), h('div', { class: 'form-grid' }, field('점검일', dateIn),
      h('div', { class: 'note', style: 'align-self:end' }, dates.length ? '데이터 기간 ' + dates[0] + ' ~ ' + dates[dates.length - 1] : '점검 데이터 없음')));
    if (!d.equipment.length) append(bcard, h('p', { class: 'note' }, '설비 목록을 넣으면 설비별 등록 여부가 나옵니다.'));
    else {
      append(bcard, h('div', { class: 'tiles', style: 'margin-top:12px' }, board.vendors.map(function (v) {
        return h('div', { class: 'tile ' + (v.registered === v.total ? 'OK' : 'NOK') }, h('b', null, v.registered + ' / ' + v.total), h('span', null, v.vendor + ' 등록 설비'));
      })));
      append(bcard, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['협력사', '순서', '설비', '등록', '점검항목 수'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, board.rows.map(function (r) {
          return h('tr', { class: r.registered ? null : 'row-NOK' }, h('td', null, r.vendor), h('td', { class: 'num' }, fmtNum(r.order)), h('td', null, r.equip),
            h('td', null, r.registered ? h('span', { class: 'board-ok' }, '등록') : h('span', { class: 'board-miss' }, '미등록')), h('td', { class: 'num' }, String(r.items)));
        })))));
    }
    main.appendChild(bcard);

    // 규칙 검사
    var checks = L.dailyChecks(d.records, d.limits, { repeat_days: d.repeat_days });
    var onlyDay = ui.dailyOnlyDay !== false;
    var shown = onlyDay ? checks.filter(function (c) { return c.date === ui.dailyDate; }) : checks;
    var ccard = h('div', { class: 'card' }, h('h2', null, '4. 규칙 검사 결과'),
      h('div', { class: 'list-meta' },
        h('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': onlyDay ? 'true' : 'false', onclick: function () { ui.dailyOnlyDay = true; render(); } }, '선택한 점검일만'),
        h('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': onlyDay ? 'false' : 'true', onclick: function () { ui.dailyOnlyDay = false; render(); } }, '전체 기간'),
        h('b', null, shown.length + '건'),
        checks.length ? h('button', {
          class: 'btn btn-small', type: 'button', onclick: function () {
            downloadCsv(prefix() + '일일점검_규칙검사_' + stamp() + '.csv', [['점검일', '협력사', '설비', '점검항목', '측정값', '검사 결과', '내용']].concat(checks.map(function (c) { return [c.date, c.vendor, c.equip, c.item, c.value, c.label, c.detail]; })));
          }
        }, '전체 CSV 내려받기') : null),
      h('p', { class: 'note' }, '반복값은 부정행위로 판정하지 않고 「확인 필요」로만 보여 줍니다. 판정 칸에 ×·X·NG·불량·이상·NOK 가 적히면 이상 기입으로 셉니다(가정).'));
    if (shown.length) append(ccard, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['점검일', '협력사', '설비', '점검항목', '측정값', '검사 결과', '내용'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, shown.map(function (c) {
        return h('tr', { class: c.kind === 'repeat' ? 'row-CHECK' : 'row-NOK' }, h('td', { class: 'nowrap' }, c.date), h('td', null, c.vendor), h('td', null, c.equip), h('td', null, c.item),
          h('td', { class: 'num' }, fmtNum(c.value)), h('td', null, c.label), h('td', null, c.detail));
      })))));
    else append(ccard, h('p', { class: 'note' }, d.records.length ? '해당 기간에 걸린 규칙이 없습니다.' : '점검 데이터를 넣으면 검사합니다.'));
    main.appendChild(ccard);
  }

  // 과제 B — 점검표 사진 한 장 = 협력사·점검일·설비 하나. 사진을 보며 점검항목별 판정·측정값을 옮겨 적습니다.
  // 보안 요구가 없는 협력사용이라 폐쇄망 모드를 끄면 「AI 읽기」로 표를 채울 수 있습니다.
  function dailyPhotoCard(d) {
    var fm = ui.dailyForm || (ui.dailyForm = { vendor: '', equip: '', date: today() });
    var ph = ui.dailyPhoto;
    var vendors = {}, equips = {};
    d.equipment.forEach(function (e) { vendors[e.vendor] = true; if (!fm.vendor || e.vendor === fm.vendor) equips[e.equip] = true; });
    function inp(key, label, list) {
      var x = h('input', { name: 'dp_' + key, value: fm[key] || '', type: key === 'date' ? 'date' : 'text', list: list || null });
      x.addEventListener('change', function () { fm[key] = x.value.trim(); if (key === 'vendor') render(); });
      return field(label, x);
    }
    var card = h('div', { class: 'card', id: 'dailyPhoto' }, h('h2', null, '점검표 사진으로 등록'),
      h('p', null, '휴대폰으로 설비 점검표를 찍거나 사진을 올린 뒤, 사진을 보며 점검항목별 판정(○·×)과 측정값을 옮겨 적습니다.' + (offline() ? ' 「설정·데이터」에서 폐쇄망 모드를 끄면 AI 가 사진을 읽어 표를 채워 줍니다(협력사용, 보안 요구가 없을 때).' : '')),
      h('datalist', { id: 'dpVendors' }, Object.keys(vendors).map(function (v) { return h('option', { value: v }); })),
      h('datalist', { id: 'dpEquips' }, Object.keys(equips).map(function (v) { return h('option', { value: v }); })),
      h('div', { class: 'form-grid' }, inp('vendor', '협력사 *', 'dpVendors'), inp('equip', '설비 *', 'dpEquips'), inp('date', '점검일 *')),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        photoButton(ph ? '다른 사진 찍기·올리기' : '점검표 사진 찍기·올리기', function (f) {
          readPhoto(f, function (p) {
            ui.dailyPhoto = p;
            var items = d.limits.map(function (l) { return l.item; }).filter(Boolean);
            ui.dailyRows = (items.length ? items : ['', '', '']).map(function (it) { return { item: it, result: '', value: '' }; });
            render();
          });
        }),
        ph ? h('button', { class: 'btn', type: 'button', onclick: function () { ui.dailyPhoto = null; render(); } }, '사진 닫기') : null));
    if (!ph) return card;
    var same = d.records.filter(function (r) { return r.photo_hash && r.photo_hash === ph.hash; })[0];
    if (same) append(card, h('div', { class: 'alert warn' }, '이 사진은 이미 올린 사진과 같은 파일입니다 — ' + same.date + ' ' + same.vendor + ' ' + same.equip + ' (' + (same.photo || '') + '). 다시 찍은 사진인지 확인해 주십시오.'));
    var rows = ui.dailyRows || (ui.dailyRows = []);
    function cell(o, k, label) {
      var x = h('input', { type: 'text', value: o[k] || '', 'aria-label': label, class: o.ai ? (o.unsure ? 'ai-unsure' : 'ai-filled') : null, inputmode: k === 'value' ? 'decimal' : null });
      x.addEventListener('input', function () { o[k] = x.value; });
      return h('td', null, x);
    }
    var form = h('div', { class: 'photo-entry-form' },
      h('div', { class: 'table-wrap entry-table' }, h('table', { class: 'list edit' },
        h('thead', null, h('tr', null, ['점검항목', '판정(○·×)', '측정값', ''].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, rows.map(function (o, i) {
          return h('tr', null, cell(o, 'item', '점검항목 ' + (i + 1)), cell(o, 'result', '판정 ' + (i + 1)), cell(o, 'value', '측정값 ' + (i + 1)),
            h('td', null, h('button', { class: 'btn btn-small', type: 'button', onclick: function () { rows.splice(i, 1); render(); } }, '빼기')));
        })))),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: function () { rows.push({ item: '', result: '', value: '' }); render(); } }, '줄 추가'),
        h('button', {
          class: 'btn btn-primary', type: 'button', onclick: function () {
            if (!fm.vendor || !fm.equip || !fm.date) { toast('협력사·설비·점검일을 넣으십시오.', true); return; }
            var recs = rows.filter(function (o) { return String(o.item || '').trim(); }).map(function (o) {
              return { vendor: fm.vendor, date: L.toDateStr(fm.date), equip: fm.equip, item: String(o.item).trim(), result: String(o.result || '').trim(), value: String(o.value || '').trim(), photo: ph.name, photo_hash: ph.hash };
            });
            if (!recs.length) { toast('점검항목을 한 줄 이상 적으십시오.', true); return; }
            ui.dailyPhoto = null; ui.dailyDate = L.toDateStr(fm.date);
            // 기존 데이터에 덧붙입니다(같은 날·설비를 다시 올리면 규칙 검사의 「같은 사진」·현황판에서 보입니다)
            d.records = d.records.concat(recs); save(); toast(fm.equip + ' 점검 ' + recs.length + '줄을 등록했습니다.'); render();
          }
        }, '점검 데이터로 등록')),
      aiTools({
        photo: function () { return ph; },
        prompt: function () { return L.aiPromptDaily(d.limits.map(function (l) { return l.item; })); },
        onRows: function (rs) {
          rs.forEach(function (r) {
            var t = rows.filter(function (o) { return L.normKey(o.item) === L.normKey(r.item); })[0];
            if (!t) { t = rows.filter(function (o) { return !String(o.item || '').trim(); })[0]; }
            if (!t) { t = {}; rows.push(t); }
            t.item = t.item || r.item || ''; t.result = r.result || ''; t.value = r.value || ''; t.ai = true; t.unsure = !!r.unsure;
          });
          render();
        }
      }));
    append(card, h('div', { class: 'photo-entry' }, photoViewer(ph), form));
    return card;
  }

  // ── 설정·데이터 ─────────────────────────────────────────────
  function viewData() {
    main.appendChild(pageHead('설정·데이터'));
    var st = db.settings;
    function chk(key, label, note) {
      var c = h('input', { type: 'checkbox', name: key, checked: !!st[key] });
      c.addEventListener('change', function () { st[key] = c.checked; save(); toast('판정 규칙을 바꿨습니다.'); });
      return h('label', { class: 'check-line' }, c, h('span', null, h('b', null, label), h('br'), h('span', { class: 'note' }, note)));
    }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '판정 규칙'),
      h('p', { class: 'note' }, '실제 공차 표기 규칙 문서를 받기 전까지의 임시 규칙입니다(기획서 10장 3번). 상·하한 경계값은 OK 로 봅니다.'),
      chk('match_by_name', '측정번호가 비어 있으면 항목명으로 맞추기', '항목명이 기준표와 글자까지 같을 때만 맞춥니다. 같은 이름이 두 줄 이상이면 맞추지 않습니다.'),
      chk('round_before_judge', '판정 전에 측정값을 기준표 「자리수」로 반올림하기', '끄면 측정값 그대로 비교합니다. 반올림 시점은 회사 규칙을 확인해 정하십시오.'),
      chk('blank_unit_as_spec', '측정 단위가 비어 있으면 기준표 단위로 보기', '끄면 단위가 빈 측정값은 확인필요가 됩니다.')));

    // 폐쇄망 모드 · 폐쇄망 사용법 (2026-09-29 수강생 요청 — 도면 외부 유출 불가)
    var offChk = h('input', { type: 'checkbox', name: 'offline_mode', checked: offline() });
    offChk.addEventListener('change', function () { db.settings.offline_mode = offChk.checked; save(); toast(offChk.checked ? '폐쇄망 모드를 켰습니다. AI 읽기가 숨겨집니다.' : '폐쇄망 모드를 껐습니다. 사진 등록 화면에 AI 읽기가 나타납니다.'); render(); });
    var offCard = h('div', { class: 'card', id: 'offlineCard' }, h('h2', null, '폐쇄망 모드 · 외부 전송'),
      h('label', { class: 'check-line' }, offChk, h('span', null, h('b', null, '폐쇄망 모드 (기본 켬)'), h('br'),
        h('span', { class: 'note' }, '켜 두면 이 화면은 어떤 데이터도 외부로 보내지 않습니다. 사진 「AI 읽기」 버튼도 숨겨집니다. 도면·사내 측정표를 다루는 과제 A 는 켠 채로 쓰십시오.'))));
    if (!offline()) {
      var keyIn = h('input', { type: 'password', name: 'openai_key', value: S.getKey(), autocomplete: 'off', placeholder: 'sk-...' });
      var modelIn = h('input', { type: 'text', name: 'ai_model', value: db.settings.ai_model || 'gpt-4o-mini' });
      append(offCard, h('div', { class: 'alert warn' }, '폐쇄망 모드가 꺼져 있습니다. 「AI 읽기」를 누르면 그 사진 한 장과 요청문이 OpenAI 로 전송됩니다. 협력사 점검표(과제 B)처럼 보안 요구가 없는 사진에만 쓰십시오.'),
        h('div', { class: 'form-grid' }, field('내 OpenAI API 키 (이 브라우저에만 저장)', keyIn), field('모델', modelIn)),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', {
          class: 'btn btn-small', type: 'button', onclick: function () {
            S.setKey(keyIn.value.trim()); db.settings.ai_model = modelIn.value.trim() || 'gpt-4o-mini'; save(); toast('AI 설정을 저장했습니다.');
          }
        }, 'AI 설정 저장'), h('button', { class: 'btn btn-small', type: 'button', onclick: function () { S.setKey(''); keyIn.value = ''; toast('API 키를 지웠습니다.'); } }, '키 지우기')),
        h('p', { class: 'note' }, '키는 엑셀 백업에 들어가지 않습니다. 공용 PC 에서는 쓰고 나서 「키 지우기」를 누르십시오.'));
    }
    main.appendChild(offCard);
    main.appendChild(h('div', { class: 'card', id: 'offlineGuide' }, h('h2', null, '폐쇄망 사용법 (사내망·인터넷 없는 PC)'),
      h('p', null, '이 도구는 서버 없이 브라우저만으로 도는 파일 묶음입니다. 폴더째 사내 PC 로 옮겨 index.html 을 열면 인터넷 연결 없이 모든 기능(기준표·CMM 가져오기·판정·도면 핀·성적서 Excel·사진 옮겨 적기)이 동작합니다. 엑셀 라이브러리도 폴더 안(vendor/)에 들어 있어 외부에서 아무것도 불러오지 않습니다.'),
      h('ol', { class: 'steps' },
        h('li', null, '인터넷이 되는 PC 에서 GitHub 저장소(aebonlee/data09-08) 화면의 「Code → Download ZIP」으로 ZIP 파일을 받습니다.'),
        h('li', null, '회사 반입 절차에 따라 ZIP 을 사내 PC 로 옮기고 압축을 풉니다(USB·사내 파일서버 등).'),
        h('li', null, '압축을 푼 폴더의 index.html 을 크롬·엣지로 엽니다(더블클릭). 주소창이 file:// 로 시작하면 정상입니다.'),
        h('li', null, '이 화면 「폐쇄망 모드」가 켜져 있는지 확인합니다(기본 켬). 화면 위 띠에 「이 화면은 어떤 데이터도 외부로 보내지 않습니다」가 보이면 됩니다.'),
        h('li', null, '도면·측정 데이터는 그 PC 의 브라우저 저장소(localStorage)와 내가 내려받은 파일(성적서 Excel·전체 백업)에만 남습니다. 다른 PC 로 옮길 때는 「엑셀로 전체 내보내기」 파일을 사내 경로로 옮기십시오.')),
      h('p', { class: 'note' }, '확인 방법: 개발자 도구(F12) → 네트워크 탭을 연 채로 써 보시면 외부 요청이 없습니다. 코드에서 외부로 요청하는 곳은 폐쇄망 모드를 껐을 때의 「AI 읽기」(js/ai.js) 한 곳뿐이며, index.html 의 보안 정책(Content-Security-Policy)이 그 밖의 주소로 연결하는 것을 막습니다. 저장소 test/logic.test.mjs 의 「폐쇄망」 검사가 이를 확인합니다.'),
      h('p', { class: 'note' }, '브라우저 저장소는 브라우저 데이터 삭제·시크릿 창에서 지워질 수 있으니 검사를 마치면 성적서·백업 파일을 사내 경로에 저장해 두십시오.')));

    var tpls = db.templates;
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '열 지정 템플릿 (' + tpls.length + '개)'),
      tpls.length ? h('ul', { class: 'side-list' }, tpls.map(function (t, i) {
        return h('li', { class: 'btn-row' }, h('span', { class: 'grow' }, t.name + ' — ' + ({ meas: '측정결과', spec: '치수 기준표' }[t.kind] || t.kind) + ' · ' +
          Object.keys(t.cols).map(function (k) { return k + '=' + t.cols[k]; }).join(', ')),
          h('button', { class: 'btn btn-small', type: 'button', onclick: function () { tpls.splice(i, 1); save(); render(); } }, '지우기'));
      })) : h('p', { class: 'note' }, '가져오기 할 때 「템플릿으로 저장」에 이름을 넣으면 여기 쌓입니다.')));

    main.appendChild(h('div', { class: 'card' }, h('h2', null, '백업·옮기기'),
      h('p', null, '데이터는 이 브라우저에만 있습니다. 다른 PC로 옮기거나 보관하려면 엑셀로 내보내고, 받는 쪽에서 가져오십시오. 도면 이미지는 엑셀에 들어가지 않으니 원본 파일로 다시 올리십시오(핀 좌표는 들어갑니다).'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { downloadXlsx(prefix() + '치수검사_전체백업_' + stamp() + '.xlsx', L.dbToSheets(db)); } }, '엑셀로 전체 내보내기'),
        fileButton('백업 엑셀 가져오기', '.xlsx', function (file) {
          var r = new FileReader();
          r.onload = function () {
            try {
              var wb = XLSX.read(new Uint8Array(r.result), { type: 'array' });
              var sheets = {}; wb.SheetNames.forEach(function (sn) { sheets[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }); });
              if (!sheets['검사건']) { toast('이 도구에서 내보낸 백업 파일이 아닙니다(「검사건」 시트 없음).', true); return; }
              var nd = L.sheetsToDb(sheets, db);
              confirmBox('백업 가져오기', '검사 건 ' + nd.inspections.length + '건, 점검 데이터 ' + nd.daily.records.length + '줄로 지금 데이터를 바꿉니다.', '바꾸기', function () {
                S.clearAll(); memImages = {}; db = nd; save(); toast('백업을 가져왔습니다. 도면은 다시 올려 주십시오.'); go('#/cases');
              });
            } catch (e) { toast('엑셀을 읽지 못했습니다: ' + e.message, true); }
          };
          r.readAsArrayBuffer(file);
        }),
        h('button', { class: 'btn', type: 'button', onclick: function () { loadSample(); } }, '예시 데이터 불러오기'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { confirmBox('모두 지우기', '이 브라우저에 저장된 검사 건·도면·점검 데이터·템플릿을 모두 지웁니다.', '모두 지우기', function () { S.clearAll(); memImages = {}; db = L.emptyDb(); save(); go('#/cases'); }); } }, '모두 지우기')),
      h('p', { class: 'note', style: 'margin-top:12px' }, '예시 파일(가상 데이터)은 samples/ 폴더에 있습니다: 예시데이터_치수기준표.xlsx · 예시데이터_CMM결과.csv · 예시데이터_도면.svg · 예시데이터_설비목록.csv · 예시데이터_일일점검.csv · 예시데이터_점검기준값.csv')));
  }

  // ── 주소 → 화면 ─────────────────────────────────────────────
  var VIEWS = { '#/cases': viewCases, '#/spec': viewSpec, '#/meas': viewMeas, '#/result': viewResult, '#/drawing': viewDrawing, '#/daily': viewDaily, '#/data': viewData };
  function render() {
    var route = location.hash || '#/cases';
    if (!VIEWS[route]) route = '#/cases';
    if (route !== '#/drawing') { ui.placing = false; ui.balloon = false; ui.drawPins = null; }
    renderNav(route);
    main.textContent = '';
    VIEWS[route]();
    main.setAttribute('data-route', location.hash || '#/cases');
  }
  window.addEventListener('hashchange', function () { closeDialog(); render(); window.scrollTo(0, 0); });
  window.addEventListener('resize', function () { if (ui.drawPins) ui.drawPins(); });
  if (!S.available()) showStoreBanner('이 브라우저는 저장 공간을 쓸 수 없어 창을 닫으면 내용이 사라집니다. 엑셀 백업을 받아 두십시오.');
  if (!location.hash) {
    if (db.inspections.length) history.replaceState(null, '', '#/result'); else history.replaceState(null, '', '#/cases');
  }
  render();
})();
