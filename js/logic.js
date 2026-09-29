/*
 * 초도품 치수검사 판정 도구 — 순수 로직 모듈 (화면·저장소와 무관)
 * 과제 A: 치수 기준표 + 측정결과 → 항목번호 매칭 → 공차 판정(OK / NOK / 확인필요)
 * 과제 B: 설비 목록 + 일일점검 데이터 → 등록 현황판 + 규칙 검사
 * 브라우저에서는 window.QCLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 파일(file://)로 열었을 때 브라우저가 module 스크립트를 막기 때문입니다.
 */
(function (root) {
  'use strict';

  var STATUS = { OK: 'OK', NOK: 'NOK', CHECK: 'CHECK' };
  var STATUS_LABEL = { OK: 'OK', NOK: 'NOK', CHECK: '확인필요' };

  // 치수 종류 (기획서 8장 1단계 2번)
  var DIM_TYPES = ['선형', '직경', '반경', '각도', '깊이', '위치', '동심도', '원통도', '진원도', '평면도', '위치도', '직각도', '평행도', '흔들림', '대칭도', '진직도'];

  // 확인필요 사유
  var REASONS = {
    no_measurement: '측정값 없음(매칭된 측정 항목이 없습니다)',
    invalid_value: '측정값을 숫자로 읽을 수 없습니다',
    invalid_nominal: '기준값이 비어 있거나 숫자가 아닙니다',
    no_tolerance: '공차가 비어 있습니다(일반공차 적용 여부 확인)',
    tol_reversed: '상한공차가 하한공차보다 작습니다',
    unit_mismatch: '단위가 서로 맞지 않아 변환할 수 없습니다',
    unit_unknown: '알 수 없는 단위입니다',
    dup_spec: '기준표에 같은 항목번호가 두 번 이상 있습니다',
    conflict: '같은 항목의 측정값 판정이 서로 다릅니다(OK와 NOK 혼재)',
    unmatched: '기준표에 없는 측정 항목입니다'
  };

  // ── 숫자·공차 ────────────────────────────────────────────────
  // 반환: 숫자 또는 null. 콤마 하나만 있고 점이 없으면 소수점 콤마로 봅니다(가정).
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).normalize ? String(v).normalize('NFKC') : String(v);
    s = s.replace(/[−–—]/g, '-').replace(/\s+/g, '');
    if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  // 부동소수 오차 정리 (10.1 - 10 = 0.0999999… 같은 값)
  function clean(x) { return x == null ? null : Math.round(x * 1e10) / 1e10; }

  // 사사오입(음수는 절댓값 기준) — 소수점 자리수 규칙용
  function roundTo(x, d) {
    if (x == null || d == null || d === '') return x;
    d = Number(d);
    if (!isFinite(d) || d < 0) return x;
    var sign = x < 0 ? -1 : 1;
    return sign * Number(Math.round(Number(Math.abs(x) + 'e' + d)) + 'e-' + d);
  }

  // 공차 문자열 → { upper, lower }  예: "±0.1", "+0.2/-0.1", "+0.1 0", "0/-0.05", "+0.3"
  function parseTolerance(text) {
    if (text == null) return null;
    var s = String(text).normalize ? String(text).normalize('NFKC') : String(text);
    s = s.replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var m = s.match(/^(?:±|\+\/-|\+-)\s*(\d*\.?\d+)$/);
    if (m) { var t = Number(m[1]); return { upper: t, lower: -t }; }
    var parts = s.split(/\s*[\/~,]\s*|\s+/).filter(Boolean);
    if (parts.length === 2) {
      var a = parseNum(parts[0]), b = parseNum(parts[1]);
      if (a == null || b == null) return null;
      return { upper: Math.max(a, b), lower: Math.min(a, b) };
    }
    if (parts.length === 1) {
      if (!/^[+-]/.test(parts[0])) return null; // 부호 없는 숫자 하나는 ±인지 단측인지 알 수 없어 읽지 않습니다
      var one = parseNum(parts[0]);
      if (one == null) return null;
      // 부호 하나만 있으면 단측공차: +0.3 → 0 ~ +0.3, -0.2 → -0.2 ~ 0
      return one >= 0 ? { upper: one, lower: 0 } : { upper: 0, lower: one };
    }
    return null;
  }

  // ── 단위 ────────────────────────────────────────────────────
  var UNITS = {
    mm: { dim: 'len', f: 1 }, cm: { dim: 'len', f: 10 }, um: { dim: 'len', f: 0.001 },
    inch: { dim: 'len', f: 25.4 }, deg: { dim: 'ang', f: 1 }
  };
  function normUnit(u) {
    if (u == null) return '';
    var s = String(u).normalize ? String(u).normalize('NFKC') : String(u);
    s = s.trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    if (s === 'mm' || s === '㎜') return 'mm';
    if (s === 'cm') return 'cm';
    if (s === 'um' || s === 'µm' || s === 'μm' || s === 'micron' || s === '㎛') return 'um';
    if (s === 'in' || s === 'inch' || s === '"' || s === 'inches') return 'inch';
    if (s === 'deg' || s === '°' || s === 'degree' || s === '도') return 'deg';
    return '?' + s;
  }
  // 값 변환. 호환되지 않거나 알 수 없으면 { error }
  function convertUnit(value, from, to) {
    var a = UNITS[from], b = UNITS[to];
    if (!a || !b) return { error: 'unit_unknown' };
    if (a.dim !== b.dim) return { error: 'unit_mismatch' };
    return { value: clean(value * a.f / b.f) };
  }

  // ── 항목번호 정규화 ───────────────────────────────────────────
  // 전각→반각, 앞뒤 공백·중간 공백 제거, 대문자, 앞의 '#' 제거, 숫자만이면 앞자리 0 제거
  function normKey(v) {
    if (v == null) return '';
    var s = String(v).normalize ? String(v).normalize('NFKC') : String(v);
    s = s.replace(/\s+/g, '').toUpperCase().replace(/^#/, '');
    if (/^\d+$/.test(s)) s = String(Number(s));
    if (/^\d+\.0+$/.test(s)) s = String(Number(s));
    return s;
  }

  // ── 판정 ────────────────────────────────────────────────────
  // 기준 한 줄의 상·하한
  function specLimits(spec) {
    var nominal = parseNum(spec.nominal);
    if (nominal == null) return { error: 'invalid_nominal' };
    var up = parseNum(spec.tol_upper), lo = parseNum(spec.tol_lower);
    if (up == null && lo == null) return { error: 'no_tolerance', nominal: nominal };
    if (up == null) up = 0;
    if (lo == null) lo = 0;
    if (up < lo) return { error: 'tol_reversed', nominal: nominal };
    return { nominal: nominal, upper: clean(nominal + up), lower: clean(nominal + lo) };
  }

  // 측정값 하나 판정. settings: { round_before_judge, blank_unit_as_spec }
  function judgeValue(spec, meas, settings) {
    settings = settings || {};
    var lim = specLimits(spec);
    var out = { status: STATUS.CHECK, reason: null, value: null, deviation: null, over: null, source: meas.source || '' };
    if (lim.error) { out.reason = lim.error; return out; }
    out.lower = lim.lower; out.upper = lim.upper;
    var v = parseNum(meas.value);
    if (v == null) { out.reason = 'invalid_value'; return out; }
    var su = normUnit(spec.unit), mu = normUnit(meas.unit);
    if (mu === '' && settings.blank_unit_as_spec !== false) mu = su;
    if (su === '' && mu !== '') su = mu; // 기준표에 단위가 없으면 측정 단위를 따릅니다
    if (su !== mu) {
      var c = convertUnit(v, mu, su);
      if (c.error) { out.reason = c.error; out.value = v; return out; }
      v = c.value;
    } else if (su && su.charAt(0) === '?') { out.reason = 'unit_unknown'; out.value = v; return out; }
    if (settings.round_before_judge && spec.decimals !== '' && spec.decimals != null) v = roundTo(v, spec.decimals);
    out.value = v;
    out.deviation = clean(v - lim.nominal);
    if (v > lim.upper) { out.status = STATUS.NOK; out.over = clean(v - lim.upper); }
    else if (v < lim.lower) { out.status = STATUS.NOK; out.over = clean(v - lim.lower); }
    else { out.status = STATUS.OK; out.over = 0; }
    return out;
  }

  // 검사 건 전체 평가: 매칭 + 판정
  // inspection: { spec:[...], meas:[...] }, settings: { match_by_name, round_before_judge, blank_unit_as_spec }
  // 기준표 색인: 항목번호·항목명 → 줄 번호
  function indexSpec(spec) {
    var byNo = {}, byName = {}, dupNo = {};
    (spec || []).forEach(function (s, i) {
      var k = normKey(s.no);
      if (k) { if (byNo[k] != null) dupNo[k] = true; else byNo[k] = i; }
      var nk = normKey(s.name);
      if (nk && byName[nk] == null) byName[nk] = i; else if (nk) byName[nk] = -1; // 이름이 겹치면 이름 매칭 안 함
    });
    return { byNo: byNo, byName: byName, dupNo: dupNo };
  }
  // 측정 한 줄이 기준표 몇 번째 줄과 맞는지(항목번호 → 번호가 비었으면 항목명). 못 맞추면 null
  function matchIndex(m, ix, settings) {
    var k = normKey(m.no);
    if (k) return ix.byNo[k] != null ? ix.byNo[k] : null;
    if (settings && settings.match_by_name === false) return null;
    var nk = normKey(m.name);
    return nk && ix.byName[nk] != null && ix.byName[nk] >= 0 ? ix.byName[nk] : null;
  }

  function evaluate(inspection, settings) {
    settings = settings || {};
    var spec = inspection.spec || [], meas = inspection.meas || [];
    var ix = indexSpec(spec), dupNo = ix.dupNo;
    var bucket = spec.map(function () { return []; });
    var extra = [];
    meas.forEach(function (m) {
      var idx = matchIndex(m, ix, settings);
      if (idx == null) extra.push({ no: m.no, name: m.name, value: m.value, unit: m.unit, source: m.source || '', status: STATUS.CHECK, reasons: ['unmatched'] });
      else bucket[idx].push(m);
    });
    var counts = { OK: 0, NOK: 0, CHECK: 0 };
    var rows = spec.map(function (s, i) {
      var lim = specLimits(s);
      var row = {
        no: s.no, name: s.name || '', type: s.type || '', nominal: s.nominal, tol_upper: s.tol_upper, tol_lower: s.tol_lower,
        unit: s.unit || '', decimals: s.decimals, lower: lim.lower == null ? null : lim.lower, upper: lim.upper == null ? null : lim.upper,
        results: [], value: null, deviation: null, over: null, status: STATUS.CHECK, reasons: []
      };
      if (dupNo[normKey(s.no)]) { row.reasons.push('dup_spec'); }
      var ms = bucket[i];
      if (!ms.length) row.reasons.push('no_measurement');
      row.results = ms.map(function (m) { return judgeValue(s, m, settings); });
      row.results.forEach(function (r) { if (r.reason && row.reasons.indexOf(r.reason) < 0) row.reasons.push(r.reason); });
      if (!row.reasons.length) {
        var st = row.results.map(function (r) { return r.status; });
        var allOk = st.every(function (x) { return x === STATUS.OK; });
        var allNok = st.every(function (x) { return x === STATUS.NOK; });
        if (allOk) row.status = STATUS.OK;
        else if (allNok) row.status = STATUS.NOK;
        else row.reasons.push('conflict');
      }
      // 대표값: 편차 절댓값이 가장 큰 측정값
      var rep = null;
      row.results.forEach(function (r) {
        if (r.value == null) return;
        if (!rep || Math.abs(r.deviation || 0) > Math.abs(rep.deviation || 0)) rep = r;
      });
      if (rep) { row.value = rep.value; row.deviation = rep.deviation; row.over = rep.over; }
      counts[row.status]++;
      return row;
    });
    counts.CHECK += extra.length;
    counts.total = rows.length + extra.length;
    return { rows: rows, extra: extra, counts: counts };
  }

  function reasonText(codes) {
    return (codes || []).map(function (c) { return REASONS[c] || c; }).join(' / ');
  }

  // ── 표 읽기(CSV·TSV) ────────────────────────────────────────
  function detectDelimiter(text) {
    var first = String(text).split(/\r?\n/)[0] || '';
    if (first.indexOf('\t') >= 0) return '\t';
    var sc = (first.match(/;/g) || []).length, cc = (first.match(/,/g) || []).length;
    return sc > cc ? ';' : ',';
  }
  function parseDelimited(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    delim = delim || detectDelimiter(text);
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  // ── 열 지정(컬럼 매핑) ───────────────────────────────────────
  // 실제 파일의 열 이름을 모르므로, 머리행 글자로 추정만 하고 사용자가 고칩니다.
  var FIELDS = {
    spec: [
      { key: 'no', label: '항목번호', need: true, kw: ['항목번호', '풍선번호', '치수번호', '번호', 'no', 'balloon', 'item', 'id', '#'] },
      { key: 'name', label: '항목명', kw: ['항목명', '명칭', '치수명', 'name', 'description', 'feature'] },
      { key: 'type', label: '치수 종류', kw: ['치수종류', '종류', '구분', 'type'] },
      { key: 'nominal', label: '기준값', need: true, kw: ['기준값', '기준치', '설계값', '도면치수', 'nominal', 'target'] },
      { key: 'tol_upper', label: '상한공차(+)', kw: ['상한공차', '상공차', '상한', 'upper', 'utol', '+tol'] },
      { key: 'tol_lower', label: '하한공차(-)', kw: ['하한공차', '하공차', '하한', 'lower', 'ltol', '-tol'] },
      { key: 'tol_text', label: '공차(한 칸 표기, 예: ±0.1)', kw: ['공차', 'tolerance', 'tol'] },
      { key: 'unit', label: '단위', kw: ['단위', 'unit'] },
      { key: 'decimals', label: '소수점 자리수', kw: ['자리수', '소수점', 'decimals'] }
    ],
    meas: [
      // 측정번호는 필수가 아닙니다 — 번호 없는 CMM 출력은 기준값·공차로 짝을 제안합니다(2026-09-29)
      { key: 'no', label: '측정번호(항목번호, 없으면 비움)', kw: ['측정번호', '항목번호', '번호', 'no', 'item', 'id', 'point', '#'] },
      { key: 'name', label: '항목명', kw: ['항목명', '명칭', 'name', 'feature', 'description', 'label'] },
      { key: 'value', label: '측정값', need: true, kw: ['측정값', '실측값', '측정치', 'actual', 'measured', 'meas', 'value', '결과'] },
      { key: 'unit', label: '단위', kw: ['단위', 'unit'] },
      // 아래 넷은 선택 — CMM 출력에 기준값·공차가 있으면 번호 없는 측정도 도면 항목과 짝을 제안할 수 있습니다
      { key: 'nominal', label: '기준값(선택)', kw: ['기준값', '기준치', '설계값', '도면치수', 'nominal', 'nom', 'target'] },
      { key: 'tol_upper', label: '상한공차(선택)', kw: ['상한공차', '상공차', '+tol', 'utol', 'uppertol', 'upper'] },
      { key: 'tol_lower', label: '하한공차(선택)', kw: ['하한공차', '하공차', '-tol', 'ltol', 'lowertol', 'lower'] },
      { key: 'tol_text', label: '공차 한 칸 표기(선택, 예: ±0.1)', kw: ['공차', 'tolerance', 'tol'] }
    ],
    equip: [
      { key: 'vendor', label: '협력사', need: true, kw: ['협력사', '업체', 'vendor', 'supplier'] },
      { key: 'equip', label: '설비', need: true, kw: ['설비번호', '설비', '호기', 'equipment', 'machine'] },
      { key: 'order', label: '순서', kw: ['순서', 'order', 'seq'] }
    ],
    daily: [
      { key: 'vendor', label: '협력사', need: true, kw: ['협력사', '업체', 'vendor', 'supplier'] },
      { key: 'date', label: '점검일', need: true, kw: ['점검일', '일자', '날짜', 'date'] },
      { key: 'equip', label: '설비', need: true, kw: ['설비번호', '설비', '호기', 'equipment', 'machine'] },
      { key: 'item', label: '점검항목', need: true, kw: ['점검항목', '항목', 'item'] },
      { key: 'result', label: '판정', kw: ['판정', '결과', 'result', 'check'] },
      { key: 'value', label: '측정값', kw: ['측정값', '수치', 'value'] },
      { key: 'photo', label: '원본사진', kw: ['원본사진', '사진', 'photo', 'image'] }
    ],
    limits: [
      { key: 'item', label: '점검항목', need: true, kw: ['점검항목', '항목', 'item'] },
      { key: 'lower', label: '하한', kw: ['하한', 'lower', 'min'] },
      { key: 'upper', label: '상한', kw: ['상한', 'upper', 'max'] }
    ]
  };

  function headerHas(h, kw) {
    h = String(h || '').normalize ? String(h || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '') : String(h || '').toLowerCase();
    var k = kw.toLowerCase().replace(/\s+/g, '');
    if (/^[a-z]+$/.test(k)) return new RegExp('(^|[^a-z])' + k + '([^a-z]|$)').test(h);
    return h.indexOf(k) >= 0;
  }
  // 반환: { fieldKey: 열 번호 } — 못 찾으면 넣지 않음
  function guessMapping(headers, kind) {
    var map = {}, used = {};
    var defs = FIELDS[kind] || [];
    // 1차: 머리행 전체가 키워드와 같은 경우, 2차: 포함
    [true, false].forEach(function (exact) {
      defs.forEach(function (f) {
        if (map[f.key] != null) return;
        for (var ki = 0; ki < f.kw.length; ki++) {
          for (var c = 0; c < headers.length; c++) {
            if (used[c]) continue;
            var hv = String(headers[c] || '').toLowerCase().replace(/\s+/g, '');
            var hit = exact ? hv === f.kw[ki].toLowerCase().replace(/\s+/g, '') : headerHas(headers[c], f.kw[ki]);
            if (hit) { map[f.key] = c; used[c] = true; return; }
          }
        }
      });
    });
    return map;
  }

  // 머리행 추정: 앞 10줄 중 채워진 칸이 가장 많은 첫 줄 (CMM 출력 앞의 제목 줄을 건너뜀)
  function guessHeaderRow(rows) {
    var best = 0, bestN = -1;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var n = rows[i].filter(function (c) { return String(c == null ? '' : c).trim() !== ''; }).length;
      if (n > bestN) { best = i; bestN = n; }
    }
    return best;
  }

  // rows: 2차원 배열, headerRow: 머리행 번호(0부터), map: { field: 열번호 }
  function applyMapping(rows, headerRow, map, kind) {
    var defs = FIELDS[kind] || [];
    var out = [];
    for (var r = headerRow + 1; r < rows.length; r++) {
      var o = {}, any = false;
      defs.forEach(function (f) {
        var c = map[f.key];
        var v = c == null || c === '' ? '' : rows[r][c];
        v = v == null ? '' : (typeof v === 'number' ? v : String(v).trim());
        if (v !== '') any = true;
        o[f.key] = v;
      });
      if (any) out.push(o);
    }
    if (kind === 'spec') out = out.map(normalizeSpecRow);
    if (kind === 'meas') out = out.map(normalizeMeasRow);
    return out;
  }
  function missingRequired(map, kind) {
    return (FIELDS[kind] || []).filter(function (f) { return f.need && (map[f.key] == null || map[f.key] === ''); })
      .map(function (f) { return f.label; });
  }

  // 공차 한 칸 표기가 있고 상·하한 칸이 비어 있으면 풀어 넣습니다.
  function normalizeSpecRow(o) {
    var r = {
      no: o.no == null ? '' : String(o.no), name: o.name || '', type: o.type || '', nominal: o.nominal,
      tol_upper: o.tol_upper == null ? '' : o.tol_upper, tol_lower: o.tol_lower == null ? '' : o.tol_lower,
      unit: o.unit || '', decimals: o.decimals == null ? '' : o.decimals
    };
    if (r.tol_upper === '' && r.tol_lower === '' && o.tol_text) {
      var t = parseTolerance(o.tol_text);
      if (t) { r.tol_upper = t.upper; r.tol_lower = t.lower; }
    }
    return r;
  }

  // 측정 한 줄: 공차 한 칸 표기를 상·하한으로 풀고, 쓰지 않은 선택 칸은 뺍니다
  function normalizeMeasRow(o) {
    var r = { no: o.no == null ? '' : String(o.no), name: o.name || '', value: o.value, unit: o.unit || '' };
    var up = o.tol_upper == null ? '' : o.tol_upper, lo = o.tol_lower == null ? '' : o.tol_lower;
    if (up === '' && lo === '' && o.tol_text) { var t = parseTolerance(o.tol_text); if (t) { up = t.upper; lo = t.lower; } }
    if (o.nominal != null && o.nominal !== '') r.nominal = o.nominal;
    if (up !== '') r.tol_upper = up;
    if (lo !== '') r.tol_lower = lo;
    return r;
  }

  // ── 번호 없는 측정 ↔ 도면 항목 짝 제안 (2026-09-29 수강생 요청) ─────────
  // 도면에 풍선 번호가 없거나 CMM 측정번호가 도면 번호와 다를 때, 측정 결과에 함께 나오는
  // 기준값·공차로 기준표(도면 항목)의 짝을 「제안」합니다. 반영은 사람이 확인한 뒤에만 합니다.
  //   점수: 기준값 같음 60 · 공차까지 같음 +30 · 공차 다름 -20 · 항목명 같음 +10
  //         기준값이 없으면 측정값이 공차 안에 드는 항목 15(참고용, 기본 선택 안 함)
  //         같은 출처 측정이 이미 붙은 항목 -25
  //   같은 점수 후보가 여럿이면(예: 같은 Ø8 +0.05/0 구멍 두 개) 측정 순서대로 남은 항목과 짝짓고 신뢰도를 한 단계 낮춥니다.
  var MATCH_WHY = {
    nominal: '기준값 같음', tol: '공차 같음', tol_diff: '공차 다름', name: '항목명 같음',
    range: '측정값이 이 항목 공차 안(기준값 정보 없음 — 참고용)', taken: '이미 같은 출처 측정이 붙은 항목', order: '같은 기준 항목이 여럿 — 순서대로 짝지음',
    type: '종류 같음', fit_sign: '끼워맞춤 문자와 공차 방향 맞음', fit_bad: '끼워맞춤 문자와 공차 방향 다름',
    fit_need: '끼워맞춤 공차 숫자는 ISO 286 표나 직접 입력으로 확인'
  };
  var MATCH_LEVEL = { high: '높음', mid: '보통', low: '낮음' };
  function sameNum(a, b) { return a != null && b != null && Math.abs(clean(a) - clean(b)) < 1e-9; }
  // 측정 단위의 값을 기준 단위로. 알 수 없거나 비어 있으면 그대로(같은 단위로 봄)
  function toSpecUnit(v, mUnit, sUnit) {
    if (v == null) return null;
    var mu = normUnit(mUnit), su = normUnit(sUnit);
    if (!mu || !su || mu === su) return v;
    var c = convertUnit(v, mu, su);
    return c.error ? null : c.value;
  }
  function suggestMatches(inspection, settings) {
    var spec = inspection.spec || [], meas = inspection.meas || [];
    var ix = indexSpec(spec);
    var taken = {};  // 기준 줄 번호 → { 출처: true }
    var todo = [];
    meas.forEach(function (m, i) {
      var idx = matchIndex(m, ix, settings);
      if (idx != null) { (taken[idx] = taken[idx] || {})[m.source || ''] = true; }
      else todo.push(i);
    });
    var out = [];
    todo.forEach(function (i) {
      var m = meas[i], src = m.source || '';
      var mn = parseNum(m.nominal), mv = parseNum(m.value);
      var mu = parseNum(m.tol_upper), ml = parseNum(m.tol_lower);
      var cands = [];
      var mt = typeFromName(m.name);
      spec.forEach(function (s, j) {
        if (!normKey(s.no)) return;               // 번호 없는 기준 줄에는 붙일 수 없습니다
        var sn = parseNum(s.nominal); if (sn == null) return;
        var st = s.type || typeFromName(s.name);
        var gdt = GDT_TYPES.indexOf(st) >= 0 || GDT_TYPES.indexOf(mt) >= 0;
        // 형상·위치공차는 종류가 다르면 짝이 아닙니다(동심도 0.02 ≠ 흔들림 0.02). 양쪽 종류를 알 때만 거릅니다
        if (gdt && st && mt && st !== mt) return;
        var score = 0, why = [];
        if (mn != null) {
          if (!sameNum(toSpecUnit(mn, m.unit, s.unit), sn)) return;
          score = 60; why.push('nominal');
          var su = parseNum(s.tol_upper), sl = parseNum(s.tol_lower);
          if (mu != null || ml != null) {
            var a = toSpecUnit(mu == null ? 0 : mu, m.unit, s.unit), b = toSpecUnit(ml == null ? 0 : ml, m.unit, s.unit);
            if (sameNum(a, su == null ? 0 : su) && sameNum(b, sl == null ? 0 : sl)) { score += 30; why.push('tol'); }
            // 형상·위치공차는 기준값이 늘 0 이라 공차가 다르면 근거가 거의 없습니다 → 낮음
            else if (gdt) { score = 20; why.push('tol_diff'); }
            else { score -= 20; why.push('tol_diff'); }
          }
        } else {
          var lim = specLimits(s), v = toSpecUnit(mv, m.unit, s.unit);
          if (lim.error || v == null || v < lim.lower || v > lim.upper) return;
          score = 15; why.push('range');
        }
        if (normKey(m.name) && normKey(m.name) === normKey(s.name)) { score += 10; why.push('name'); }
        if (st && mt && st === mt) { score += gdt ? 15 : 5; why.push('type'); }
        // 끼워맞춤(g6·f6 …): 기준표에 공차 숫자가 없으면 공차 방향만 맞춰 봅니다
        if (s.fit && parseNum(s.tol_upper) == null && parseNum(s.tol_lower) == null && mn != null && (mu != null || ml != null)) {
          var ok = fitSignOk(s.fit, mu, ml);
          if (ok === true) { score += 20; why.push('fit_sign'); } else if (ok === false) { score -= 10; why.push('fit_bad'); }
          if (why.indexOf('tol_diff') >= 0) { score += 20; why.splice(why.indexOf('tol_diff'), 1); }
          why.push('fit_need');
        }
        cands.push({ j: j, score: score, why: why });
      });
      out.push({ meas: i, cands: cands });
    });
    // 짝짓기: ① 모든 (측정, 후보) 쌍을 점수 높은 순으로 — 같은 점수면 측정 순서대로 — 아직 이 출처로 짝지어지지 않은 항목에 붙입니다.
    //   (측정 순서대로 욕심껏 고르면 앞 측정이 뒤 측정의 정확한 짝을 가로챕니다: 동심도 0.03 이 0.025 칸을 먼저 차지하는 식)
    // ② 남은 측정은 이미 붙은 항목까지 포함해(-25) 가장 높은 후보. 15점 미만은 제안하지 않습니다.
    var pick = {}, pairs = [];
    out.forEach(function (o, oi) { o.cands.forEach(function (c) { pairs.push({ oi: oi, c: c }); }); });
    pairs.sort(function (a, b) { return b.c.score - a.c.score || a.oi - b.oi || a.c.j - b.c.j; });
    pairs.forEach(function (p) {
      if (pick[p.oi] || p.c.score < 15) return;
      var src = meas[out[p.oi].meas].source || '';
      if (taken[p.c.j] && taken[p.c.j][src]) return;
      pick[p.oi] = { j: p.c.j, score: p.c.score, why: p.c.why.slice() };
      (taken[p.c.j] = taken[p.c.j] || {})[src] = true;
    });
    out.forEach(function (o, oi) {
      if (pick[oi]) return;
      var best = null;
      o.cands.forEach(function (c) {
        var sc = c.score - 25;
        if (sc >= 15 && (!best || sc > best.score || (sc === best.score && c.j < best.j))) best = { j: c.j, score: sc, why: c.why.concat('taken') };
      });
      if (best) pick[oi] = best;
    });
    return out.map(function (o, oi) {
      var src = meas[o.meas].source || '';
      var pk = pick[oi];
      if (!pk) return { meas: o.meas, no: null, level: null, score: 0, why: [], alts: [] };
      var level = pk.score >= 90 ? 'high' : pk.score >= 50 ? 'mid' : 'low';
      var why = pk.why;
      // 원래 점수로 같은 최고점 후보가 여럿이었으면 순서로 짝지은 것입니다
      var raw = o.cands.filter(function (c) { return c.j === pk.j; })[0].score;
      var top = Math.max.apply(null, o.cands.map(function (c) { return c.score; }));
      var rivals = o.cands.filter(function (c) { return c.score === raw; }).length;
      if (raw === top && rivals > 1) { why.push('order'); if (level === 'high') level = 'mid'; }
      return {
        meas: o.meas, no: spec[pk.j].no, name: spec[pk.j].name || '', level: level, score: pk.score, why: why,
        alts: o.cands.filter(function (c) { return c.j !== pk.j && c.score >= 50; }).sort(function (a, b) { return b.score - a.score; }).map(function (c) { return spec[c.j].no; })
      };
    });
  }
  function matchWhyText(codes) { return (codes || []).map(function (c) { return MATCH_WHY[c] || c; }).join(' · '); }
  // picks: [{ meas: 측정 줄 번호, no: 붙일 항목번호 }] — 측정의 번호를 바꾸고 「제안 매칭」 표시를 남깁니다
  function applyMatches(inspection, picks) {
    var n = 0;
    (picks || []).forEach(function (p) {
      var m = inspection.meas[p.meas];
      if (!m || p.no == null || p.no === '') return;
      if (!m.orig_no && m.no) m.orig_no = m.no;   // 원래 CMM 측정번호는 남겨 둡니다
      m.no = String(p.no); m.matched = 'suggest'; n++;
    });
    return n;
  }

  // 기준표 다음 번호(숫자 번호 중 가장 큰 값 + 1)
  function nextSpecNo(spec) {
    var mx = 0;
    (spec || []).forEach(function (s) { var k = normKey(s.no); if (/^\d+$/.test(k) && Number(k) > mx) mx = Number(k); });
    return mx + 1;
  }
  // 도면에 번호가 없고 기준표도 없을 때: 기준값이 있는 측정 줄로 기준표를 만들고 번호를 1, 2, 3… 매깁니다.
  // 측정에 번호가 있고 기준표에 없는 번호면 그 번호를 그대로 씁니다. 측정 줄의 번호도 같이 채워 짝을 지어 둡니다.
  function specFromMeas(inspection, settings) {
    var spec = inspection.spec || (inspection.spec = []);
    var ix = indexSpec(spec), added = 0;
    (inspection.meas || []).forEach(function (m) {
      if (matchIndex(m, ix, settings) != null) return;
      if (parseNum(m.nominal) == null) return;
      var k = normKey(m.no);
      var no = k && ix.byNo[k] == null ? String(m.no).trim() : String(nextSpecNo(spec));
      spec.push({ no: no, name: m.name || '', type: '', nominal: m.nominal, tol_upper: m.tol_upper == null ? '' : m.tol_upper,
        tol_lower: m.tol_lower == null ? '' : m.tol_lower, unit: m.unit || '', decimals: '' });
      ix.byNo[normKey(no)] = spec.length - 1;
      if (String(m.no || '') !== no) { if (m.no) m.orig_no = m.no; m.no = no; m.matched = 'auto_no'; }
      added++;
    });
    return added;
  }

  // ── PDF 성적서 글자 붙여넣기 → 표 ─────────────────────────────
  // PDF 를 직접 읽지 않는 대신, PDF 뷰어에서 표를 드래그해 복사한 글자를 줄·칸으로 나눕니다.
  // 탭이나 두 칸 이상 공백이 있으면 그것으로 나누고, 없으면 공백으로 나누되 숫자 사이에 낀
  // 글자 조각(HOLE A DIA 처럼 띄어 쓴 항목명)은 한 칸으로 붙입니다. 숫자가 섞인 번호(P1)는 따로 둡니다.
  function isNumTok(t) { return parseNum(String(t).replace(/^[+]/, '')) != null; }
  function textToRows(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    var out = [];
    lines.forEach(function (line) {
      var raw = line.replace(/ /g, ' ').trim();
      if (!raw) return;
      var cells;
      if (raw.indexOf('\t') >= 0) cells = raw.split('\t').map(function (c) { return c.trim(); });
      else if (/\S\s{2,}\S/.test(raw)) cells = raw.split(/\s{2,}/);
      else {
        var toks = raw.split(/\s+/);
        var nums = toks.filter(isNumTok).length;
        if (nums < 2) cells = toks;            // 머리행·제목 줄: 낱말마다 한 칸
        else {
          cells = [];
          toks.forEach(function (t, i) {
            // 앞 토큰이 숫자 없는 낱말일 때만 붙입니다(P1·A12 같은 번호는 따로 한 칸)
            var prevText = i > 0 && !/\d/.test(toks[i - 1]) && cells.length;
            if (!isNumTok(t) && prevText) cells[cells.length - 1] += ' ' + t;
            else cells.push(t);
          });
        }
      }
      out.push(cells);
    });
    return out;
  }

  // ── 사진 판독(AI) 요청문·답 읽기 ────────────────────────────
  // 요청문은 도면·치수 정보 없이 「번호·측정값」만 뽑게 합니다. 답은 JSON 배열.
  function aiPromptMeasure(spec) {
    var list = (spec || []).filter(function (s) { return normKey(s.no); })
      .map(function (s) { return '- ' + s.no + (s.name ? ' (' + s.name + ')' : ''); }).join('\n');
    return [
      '첨부한 사진은 손으로 적은 치수 측정표입니다. 표에 적힌 항목번호와 측정값을 읽어 줘.',
      '규칙:',
      '1. 답은 JSON 배열 하나만 보내 줘. 설명 문장은 붙이지 말아 줘.',
      '2. 형식: [{"no": "항목번호", "value": "측정값", "unit": "단위(적혀 있을 때만)", "unsure": true/false}]',
      '3. 숫자는 사진에 적힌 그대로 옮겨 줘(반올림·추정 금지). 흐리거나 확실하지 않으면 "unsure": true 로 표시해 줘.',
      '4. 읽을 수 없는 칸은 빼 줘.',
      list ? '참고 — 이 검사의 항목번호 목록:\n' + list : ''
    ].filter(Boolean).join('\n');
  }
  function aiPromptDaily(items) {
    var list = (items || []).filter(Boolean).map(function (x) { return '- ' + x; }).join('\n');
    return [
      '첨부한 사진은 설비 일일점검표입니다. 점검항목별 판정 표시(√ ○ × 등)와 측정값을 읽어 줘. 중국어로 적혀 있으면 점검항목 이름을 한국어로 옮기고 원문을 괄호에 남겨 줘.',
      '규칙:',
      '1. 답은 JSON 배열 하나만 보내 줘. 설명 문장은 붙이지 말아 줘.',
      '2. 형식: [{"item": "점검항목", "result": "판정 표시 그대로", "value": "측정값(없으면 빈칸)", "unsure": true/false}]',
      '3. 숫자는 사진에 적힌 그대로 옮겨 줘. 흐리거나 확실하지 않으면 "unsure": true 로 표시해 줘.',
      list ? '참고 — 이 설비의 점검항목 목록:\n' + list : ''
    ].filter(Boolean).join('\n');
  }
  // AI 답(글자) → 배열. ```json 울타리·앞뒤 설명·{rows:[…]} 형태를 모두 받습니다. 못 읽으면 { error }
  function parseAiJson(text) {
    var s = String(text || '').trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var a = s.indexOf('['), b = s.lastIndexOf(']');
    var data = null;
    try { data = JSON.parse(s); }
    catch (e) { if (a >= 0 && b > a) { try { data = JSON.parse(s.slice(a, b + 1)); } catch (e2) { data = null; } } }
    if (data && !Array.isArray(data)) { var k = Object.keys(data).filter(function (x) { return Array.isArray(data[x]); })[0]; data = k ? data[k] : null; }
    if (!Array.isArray(data)) return { error: 'JSON 배열을 찾지 못했습니다' };
    return {
      rows: data.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
        var o = {};
        Object.keys(r).forEach(function (k) { o[k] = r[k] == null ? '' : (typeof r[k] === 'boolean' ? r[k] : String(r[k]).trim()); });
        o.unsure = r.unsure === true || r.unsure === 'true';
        return o;
      })
    };
  }

  // 파일 바이트 지문(FNV-1a 32비트 두 벌) — 같은 사진 파일을 다시 올렸는지 확인용. 암호용이 아닙니다.
  function hashBytes(bytes) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < bytes.length; i++) {
      h1 ^= bytes[i]; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= bytes[i] + (i & 0xff); h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8) + '-' + bytes.length;
  }

  // ── 성적서 행 ──────────────────────────────────────────────
  function fmt(x) { return x == null || x === '' ? '' : x; }
  function reportRows(ev) {
    var head = ['항목번호', '항목명', '치수 종류', '기준값', '상한공차', '하한공차', '단위', '하한', '상한', '측정값', '측정 출처', '편차', '공차 이탈량', '판정', '확인필요 사유'];
    var rows = ev.rows.map(function (r) {
      return [r.no, r.name, r.type, fmt(parseNum(r.nominal) != null ? parseNum(r.nominal) : r.nominal), fmt(r.tol_upper), fmt(r.tol_lower), r.unit,
        fmt(r.lower), fmt(r.upper), fmt(r.value),
        r.results.map(function (x) { return x.source; }).filter(Boolean).join(', '),
        fmt(r.deviation), r.status === 'NOK' ? fmt(r.over) : '', STATUS_LABEL[r.status], reasonText(r.reasons)];
    });
    ev.extra.forEach(function (x) {
      rows.push([x.no, x.name, '', '', '', '', x.unit, '', '', fmt(x.value), x.source, '', '', STATUS_LABEL.CHECK, reasonText(x.reasons)]);
    });
    return [head].concat(rows);
  }

  function toCsv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (c) {
        var s = c == null ? '' : String(c);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  // ── 과제 B: 일일점검 ────────────────────────────────────────
  function toDateStr(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
      return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    }
    var m = String(v).trim().match(/^(\d{4})[.\-\/年]\s*(\d{1,2})[.\-\/月]\s*(\d{1,2})/);
    if (!m) return String(v).trim();
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  // 당일 등록 현황판
  function dailyBoard(equipment, records, date) {
    var day = toDateStr(date);
    var seen = {};
    (records || []).forEach(function (r) {
      if (toDateStr(r.date) !== day) return;
      var k = normKey(r.vendor) + '|' + normKey(r.equip);
      seen[k] = (seen[k] || 0) + 1;
    });
    var list = (equipment || []).slice().sort(function (a, b) {
      if (a.vendor !== b.vendor) return String(a.vendor).localeCompare(String(b.vendor), 'ko');
      return (parseNum(a.order) || 0) - (parseNum(b.order) || 0);
    });
    var vendors = {};
    var rows = list.map(function (e) {
      var n = seen[normKey(e.vendor) + '|' + normKey(e.equip)] || 0;
      var v = vendors[e.vendor] || (vendors[e.vendor] = { vendor: e.vendor, total: 0, registered: 0 });
      v.total++; if (n) v.registered++;
      return { vendor: e.vendor, equip: e.equip, order: e.order, items: n, registered: n > 0 };
    });
    return { date: day, rows: rows, vendors: Object.keys(vendors).map(function (k) { return vendors[k]; }) };
  }

  var NG_WORDS = ['×', 'X', 'NG', '불량', '이상', 'NOK'];
  var CHECK_KIND = {
    missing_result: '판정 빈칸',
    result_ng: '판정이 이상(×·NG)으로 기입됨',
    missing_value: '측정값 미기입',
    invalid_value: '측정값을 숫자로 읽을 수 없음',
    out_of_limit: '관리 기준값 이탈',
    repeat: '같은 측정값이 연속 반복됨 — 확인 필요(부정행위로 판정하지 않음)',
    same_photo: '이전에 올린 것과 같은 사진 파일 — 확인 필요'
  };

  // 규칙 검사. limits: [{item, lower, upper}], opts: { repeat_days: 숫자 또는 빈값(검사 안 함) }
  function dailyChecks(records, limits, opts) {
    opts = opts || {};
    var lim = {};
    (limits || []).forEach(function (l) { lim[normKey(l.item)] = { lower: parseNum(l.lower), upper: parseNum(l.upper) }; });
    var out = [];
    function add(r, kind, detail) {
      out.push({ date: toDateStr(r.date), vendor: r.vendor, equip: r.equip, item: r.item, value: r.value, kind: kind, label: CHECK_KIND[kind], detail: detail || '' });
    }
    (records || []).forEach(function (r) {
      var res = r.result == null ? '' : String(r.result).trim();
      if (!res) add(r, 'missing_result');
      else if (NG_WORDS.indexOf(res.toUpperCase()) >= 0) add(r, 'result_ng', res);
      var L = lim[normKey(r.item)];
      var raw = r.value == null ? '' : String(r.value).trim();
      if (L && (L.lower != null || L.upper != null)) {
        if (!raw) { add(r, 'missing_value'); return; }
        var v = parseNum(raw);
        if (v == null) { add(r, 'invalid_value', raw); return; }
        if (L.upper != null && v > L.upper) add(r, 'out_of_limit', v + ' > 상한 ' + L.upper);
        else if (L.lower != null && v < L.lower) add(r, 'out_of_limit', v + ' < 하한 ' + L.lower);
      }
    });
    // 같은 사진 파일이 다른 날·다른 설비 점검에 다시 쓰였는지(파일 지문 photo_hash 기준)
    var firstUse = {};
    (records || []).forEach(function (r) {
      if (!r.photo_hash) return;
      var key = toDateStr(r.date) + '|' + normKey(r.vendor) + '|' + normKey(r.equip);
      var f = firstUse[r.photo_hash];
      if (!f) { firstUse[r.photo_hash] = { key: key, r: r, flagged: {} }; return; }
      if (f.key === key || f.flagged[key]) return;
      f.flagged[key] = true;
      add(r, 'same_photo', '처음 쓰인 곳: ' + toDateStr(f.r.date) + ' ' + f.r.vendor + ' ' + f.r.equip);
    });
    var n = parseNum(opts.repeat_days);
    if (n != null && n >= 2) {
      var groups = {};
      (records || []).forEach(function (r) {
        if (parseNum(r.value) == null) return;
        var k = normKey(r.vendor) + '|' + normKey(r.equip) + '|' + normKey(r.item);
        (groups[k] = groups[k] || []).push(r);
      });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k].slice().sort(function (a, b) { return toDateStr(a.date) < toDateStr(b.date) ? -1 : toDateStr(a.date) > toDateStr(b.date) ? 1 : 0; });
        var run = 1;
        for (var i = 1; i < g.length; i++) {
          run = parseNum(g[i].value) === parseNum(g[i - 1].value) ? run + 1 : 1;
          if (run >= n) add(g[i], 'repeat', run + '회 연속 ' + parseNum(g[i].value));
        }
      });
    }
    return out;
  }

  // ── 과제 B: 월간 점검표 격자 (2026-09-29 메일 샘플 반영) ─────────────────
  // 협력사 점검표는 「사진 한 장 = 한 설비 한 달」 격자입니다(날짜 1~31 × 점검항목, 교대가 있으면 × 교대).
  // 양식 정의는 받은 중국어 양식 2종의 구조만 옮긴 것입니다(회사명·양식번호·설비번호·이름은 넣지 않음).
  // kind: check = ✓/× 표시, num = 숫자 기입(관리 범위), sign = 서명 칸(이름은 옮기지 않고 「있음」만 ✓)
  var SHEET_TEMPLATES = [
    {
      id: 'cnc_monthly', zh: '数控机床点检表', ko: 'CNC 공작기계 점검표 (월간, 날짜별 1칸)',
      shifts: [], day_from: 1, day_to: 31, sign: 'row',
      rows_note: '양식에는 날짜가 1~16 / 17~말일 두 줄로 인쇄돼 있습니다. 여기서는 1~31 한 줄로 펼쳐 입력합니다.',
      items: [
        { no: '1', kind: 'num', lower: 5, upper: 7, unit: 'MPa', zh: '检查油压力为多少，请填写数值（正常为5-7MPa）', ko: '유압 압력 확인 — 수치 기입 (정상 5~7MPa)' },
        { no: '2', kind: 'check', zh: '检查润滑油位、液压油位是否正常', ko: '윤활유·작동유 유위 정상 여부' },
        { no: '3', kind: 'check', zh: '检查加工程序和加工产品是否一致', ko: '가공 프로그램과 가공 제품 일치 여부' },
        { no: '4', kind: 'check', zh: '检查机床面板灯、按键、机床照明灯是否正常', ko: '조작반 램프·버튼·기계 조명등 정상 여부' },
        { no: '5', kind: 'check', zh: '检查加工刀具、工装是否正常', ko: '가공 공구·지그 정상 여부' },
        { no: '6', kind: 'check', zh: '检查排屑机工作是否正常', ko: '칩 컨베이어 작동 정상 여부' },
        { no: '7', kind: 'check', zh: '检查有无漏气、漏油、漏水现象，冷却风扇是否正常', ko: '공기·오일·물 누설 유무, 냉각팬 정상 여부 (현장에서는 「无(없음)」으로 적음 → ✓ 로 입력)' },
        { no: '8', kind: 'num', lower: 7, upper: 12, unit: '%', zh: '检查冷却液浓度，用折光仪查看并填写数值（正常为7%-12%）', ko: '절삭유 농도 — 굴절계로 보고 수치 기입 (정상 7~12%)' },
        { no: '9', kind: 'sign', zh: '操作者签名（每天开机后第一件事情必须先按以上面项目点检机床）', ko: '작업자 서명 (매일 가동 후 가장 먼저 위 항목을 점검)' }
      ]
    },
    {
      id: 'hob_daily', zh: '设备日常点检项目表（数控滚齿机）', ko: '설비 일상점검 항목표 — CNC 호빙기 (날짜 × 日/中 교대)',
      shifts: ['日', '中'], day_from: 1, day_to: 16, sign: 'header',
      rows_note: '받은 사진은 1~16일만 인쇄된 장이었습니다. 17일~말일 장이 따로 있으면 「이 장이 덮는 날」을 17 ~ 31 로 바꾸십시오. 日/中 은 교대(주간/중간)로 보았습니다(확인 필요).',
      items: [
        { no: '1', kind: 'check', zh: '上下班对设备内外保持清洁整理。', ko: '출·퇴근 시 설비 안팎 청소·정리' },
        { no: '2', kind: 'check', zh: '开启总电源时因注意周围情况。', ko: '주전원을 켤 때 주변 상황 주의' },
        { no: '3', kind: 'check', zh: '各轴回零点时，注意观察越位碰撞，随时急停', ko: '각 축 원점 복귀 시 오버트래블·충돌 관찰, 필요하면 즉시 비상정지' },
        { no: '4', kind: 'check', zh: '特别注意对裸露导轨、工作台面磕碰保护。', ko: '노출된 가이드레일·테이블 면 충돌 보호' },
        { no: '5', kind: 'check', zh: '安全装置是否完好。', ko: '안전장치 이상 유무' },
        { no: '6', kind: 'check', zh: '开启前对刀具、夹具是否紧固可靠。', ko: '가동 전 공구·지그 체결 상태' },
        { no: '7', kind: 'check', zh: '开机后，听机械传动是否有异常。', ko: '가동 후 기계 구동부 이상음 확인' },
        { no: '8', kind: 'check', zh: '注意液压油、润滑油、蜗轮副、油量充足。', ko: '작동유·윤활유·웜기어 유량 충분 여부' },
        { no: '9', kind: 'num', lower: 4, upper: 5, unit: 'MPa', zh: '总系统压力4～5MPa，可对照机床压力表。', ko: '시스템 총압력 4~5MPa (기계 압력계로 확인)' },
        { no: '10', kind: 'check', zh: '立柱负荷、工件夹紧、平衡油缸、随产品需要。', ko: '컬럼 부하·공작물 클램프·밸런스 실린더 (제품에 따라)' },
        { no: '11', kind: 'check', zh: '注意油管接头、油箱泄漏检查。', ko: '오일 배관 이음부·오일탱크 누유 점검' },
        { no: '12', kind: 'check', zh: '注意油位、油的清洁情况。', ko: '유위·오일 청정 상태' },
        { no: '13', kind: 'check', zh: '检查刀架润滑的流量及回油情况。', ko: '공구대 윤활 유량·회유 상태' }
      ]
    }
  ];
  function sheetTemplate(id) { return SHEET_TEMPLATES.filter(function (t) { return t.id === id; })[0] || null; }

  // 칸 입력값 정리. 사진에 보이는 그대로 적으면 됩니다: ✓ √ v o ○ → ✓ / × x X NG → × / 无·무·없음(누설 없음) → ✓ / 有·있음 → ×
  var MARK_OK = ['✓', '√', '✔', 'V', 'O', '○', 'ㅇ', 'OK', '1', '无', '無', '무', '없음'];
  var MARK_NG = ['×', 'X', '✗', '✕', 'NG', '有', '유', '있음', '이상', '불량'];
  function normMark(v, kind) {
    var s = v == null ? '' : String(v).trim();
    if (!s) return '';
    if (kind === 'sign') return '✓';                                  // 서명 칸: 이름은 옮기지 않고 「있음」만
    if (kind === 'num') {
      var t = s.replace(/\s*(mpa|%|bar)\s*$/i, '');
      return parseNum(t) == null ? s : t;                              // 적힌 그대로(6.0 은 6.0), 단위만 뗌
    }
    var u = s.toUpperCase();
    if (MARK_OK.indexOf(u) >= 0) return '✓';
    if (MARK_NG.indexOf(u) >= 0) return '×';
    return s;
  }
  function cellKey(no, day, shift) { return String(no) + '|' + Number(day) + '|' + (shift || ''); }
  function daysInMonth(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{1,2})/);
    if (!m) return 31;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  }
  // 이 장에서 볼 칸 목록(날짜 × 교대)
  function gridSlots(grid, tpl) {
    var from = Math.max(1, parseInt(grid.day_from, 10) || tpl.day_from);
    var to = Math.min(daysInMonth(grid.month), parseInt(grid.day_to, 10) || tpl.day_to);
    var shifts = tpl.shifts.length ? tpl.shifts : [''];
    var out = [];
    for (var d = from; d <= to; d++) shifts.forEach(function (s) { out.push({ day: d, shift: s }); });
    return out;
  }
  function itemRange(grid, it) {
    var o = (grid.ranges || {})[it.no] || {};
    var lo = parseNum(o.lower), hi = parseNum(o.upper);
    return { lower: lo != null ? lo : (it.lower == null ? null : it.lower), upper: hi != null ? hi : (it.upper == null ? null : it.upper) };
  }
  // 사진 찍은 날 기준 「이미 지난 날」의 마지막 날짜. 사진 찍은 날 자체는 점검이 진행 중일 수 있어 누락으로 세지 않습니다.
  function gridCutoff(grid) {
    var p = toDateStr(grid.photo_date), ym = String(grid.month || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p) || !/^\d{4}-\d{2}$/.test(ym)) return { before: 0, photoDay: 0 };
    var pm = p.slice(0, 7);
    if (pm > ym) return { before: 99, photoDay: 0 };
    if (pm < ym) return { before: 0, photoDay: 0 };
    var d = Number(p.slice(8, 10));
    return { before: d - 1, photoDay: d };
  }

  var GRID_KIND = {
    out_of_range: { level: 'NOK', label: '관리 범위 이탈' },
    invalid_value: { level: 'CHECK', label: '숫자로 읽을 수 없음' },
    abnormal: { level: 'NOK', label: '× 이상 표시' },
    invalid_mark: { level: 'CHECK', label: '알 수 없는 표시(✓·× 가 아님)' },
    missed_day: { level: 'NOK', label: '점검 누락(칸 전체 빈칸)' },
    blank_cell: { level: 'CHECK', label: '일부 항목 빈칸' },
    missing_sign: { level: 'NOK', label: '서명·보전자 없음' },
    after_photo: { level: 'CHECK', label: '사진 찍은 날 뒤의 날짜에 기록 있음(미리 적은 기록 의심)' },
    formal_suspect: { level: 'CHECK', label: '형식적 기록 의심 — 확인 필요(경고일 뿐 부정으로 판정하지 않음)' }
  };
  function slotLabel(s) { return s.day + '일' + (s.shift ? ' ' + s.shift : ''); }

  // 격자 규칙 검사. opts: { formal_run: 같은 기록이 몇 칸 연속이면 경고(기본 3, 0 이면 끔) }
  // 반환: [{ day, shift, no, item, value, kind, level, label, detail }]
  function gridChecks(grid, opts) {
    opts = opts || {};
    var tpl = sheetTemplate(grid.template);
    if (!tpl) return [];
    var cells = grid.cells || {};
    var off = {}; (grid.off_days || []).forEach(function (d) { off[Number(d)] = true; });
    var cut = gridCutoff(grid);
    var body = tpl.items.filter(function (it) { return it.kind !== 'sign'; });
    var signItem = tpl.items.filter(function (it) { return it.kind === 'sign'; })[0];
    var out = [];
    function add(s, it, kind, detail, value) {
      out.push({ day: s ? s.day : '', shift: s ? s.shift : '', no: it ? it.no : '', item: it ? it.ko : '', value: value == null ? '' : value,
        kind: kind, level: GRID_KIND[kind].level, label: GRID_KIND[kind].label, detail: detail || '' });
    }
    if (tpl.sign === 'header' && !String(grid.keeper || '').trim()) add(null, null, 'missing_sign', '머리칸 보전인(保养人) 빈칸');
    var slots = gridSlots(grid, tpl);
    var prevVec = null, run = 0;
    var formalN = opts.formal_run === '' || opts.formal_run == null ? 3 : parseNum(opts.formal_run);
    slots.forEach(function (s) {
      var vals = body.map(function (it) { return normMark(cells[cellKey(it.no, s.day, s.shift)], it.kind); });
      var filled = vals.filter(Boolean).length;
      var signed = signItem ? !!normMark(cells[cellKey(signItem.no, s.day, s.shift)], 'sign') : true;
      if (filled && s.day > cut.photoDay && cut.photoDay) add(s, null, 'after_photo', slotLabel(s));
      if (!filled) {
        if (s.day <= cut.before && !off[s.day]) add(s, null, 'missed_day', slotLabel(s) + ' — 휴무면 그날을 「휴무」로 표시하십시오');
        prevVec = null; run = 0;
        return;
      }
      body.forEach(function (it, i) {
        var v = vals[i];
        if (!v) { add(s, it, 'blank_cell', slotLabel(s)); return; }
        if (it.kind === 'num') {
          var n = parseNum(v);
          if (n == null) { add(s, it, 'invalid_value', v, v); return; }
          var r = itemRange(grid, it);
          if (r.upper != null && n > r.upper) add(s, it, 'out_of_range', n + ' > 상한 ' + r.upper + (it.unit || ''), v);
          else if (r.lower != null && n < r.lower) add(s, it, 'out_of_range', n + ' < 하한 ' + r.lower + (it.unit || ''), v);
        } else if (v === '×') add(s, it, 'abnormal', slotLabel(s), v);
        else if (v !== '✓') add(s, it, 'invalid_mark', v, v);
      });
      if (signItem && !signed) add(s, signItem, 'missing_sign', slotLabel(s) + ' 서명 칸 빈칸');
      // 형식적 기록 의심: 모든 항목이 채워지고 ✓ 뿐이며, 숫자까지 앞 칸들과 똑같은 기록이 formalN 칸 이상 이어짐
      var hasNum = body.some(function (it) { return it.kind === 'num'; });
      var clean = filled === body.length && body.every(function (it, i) { return it.kind === 'num' ? parseNum(vals[i]) != null : vals[i] === '✓'; });
      var vec = clean && hasNum ? body.map(function (it, i) { return it.kind === 'num' ? String(parseNum(vals[i])) : vals[i]; }).join('|') : null;
      run = vec && vec === prevVec ? run + 1 : (vec ? 1 : 0);
      prevVec = vec;
      if (formalN && formalN >= 2 && run >= formalN) {
        add(s, null, 'formal_suspect', run + '칸 연속 모든 항목 ✓ + 숫자 ' + body.filter(function (it) { return it.kind === 'num'; }).map(function (it) { return vals[body.indexOf(it)] + (it.unit || ''); }).join(' · ') + ' 똑같음');
      }
    });
    return out;
  }
  function gridSummary(checks) {
    var c = { NOK: 0, CHECK: 0, missed: 0 };
    (checks || []).forEach(function (x) { c[x.level]++; if (x.kind === 'missed_day') c.missed++; });
    return c;
  }
  function newGrid(info, now) {
    now = now || new Date();
    seq++;
    var tpl = sheetTemplate(info.template) || SHEET_TEMPLATES[0];
    var ym = /^\d{4}-\d{2}$/.test(String(info.month || '')) ? info.month : toDateStr(now).slice(0, 7);
    return {
      id: 'G' + now.getTime().toString(36) + seq, template: tpl.id, vendor: info.vendor || '', equip: info.equip || '',
      equip_no: '', dept: '', keeper: '', month: ym, photo_date: info.photo_date || toDateStr(now),
      day_from: tpl.day_from, day_to: Math.min(tpl.day_to, daysInMonth(ym)), off_days: [], cells: {}, ranges: {}, note: '', photo: '', photo_hash: ''
    };
  }

  // AI 읽기 요청문 — 격자 전체를 JSON 으로. 중국어 양식을 그대로 읽게 하고, 이름은 옮기지 않게 합니다.
  function aiPromptGrid(grid) {
    var tpl = sheetTemplate(grid.template);
    if (!tpl) return '';
    var shiftTxt = tpl.shifts.length ? '날짜마다 교대 칸 ' + tpl.shifts.join('·') + ' 이 있어. shift 에 그 글자를 그대로 넣어 줘.' : '교대 칸은 없어. shift 는 빈 글자("")로 둬 줘.';
    return [
      '첨부한 사진은 설비 일일점검표(월간 격자)야. 양식이 중국어로 적혀 있어도 읽을 수 있어 — 점검항목은 아래 번호로 맞춰 줘.',
      '양식: ' + tpl.zh + ' (' + tpl.ko + ')',
      '가로는 날짜(' + (grid.day_from || tpl.day_from) + '~' + (grid.day_to || tpl.day_to) + '일), 세로는 점검항목이야. ' + shiftTxt,
      '규칙:',
      '1. 답은 JSON 객체 하나만 보내 줘. 설명 문장은 붙이지 말아 줘.',
      '2. 형식: {"cells": [{"item": "항목 번호", "day": 날짜숫자, "shift": "교대", "mark": "칸 내용", "unsure": true/false}], "abnormal_note": "异常情况记录 칸에 적힌 내용(없으면 빈칸)"}',
      '3. mark: 체크(√ ✓)는 "✓", ×는 "×", 无(없음)는 "无", 숫자는 적힌 그대로(단위 빼고). 빈칸은 넣지 말아 줘.',
      '4. 서명 칸은 이름을 옮기지 말고 서명이 있으면 "✓" 만 넣어 줘. 사람 이름·회사 이름은 어디에도 적지 말아 줘.',
      '5. 흐리거나 확실하지 않은 칸은 "unsure": true 로 표시해 줘. 추정해서 채우지 말아 줘.',
      '점검항목 번호표:',
      tpl.items.map(function (it) { return '- ' + it.no + ': ' + it.zh + ' / ' + it.ko + (it.kind === 'num' ? ' [숫자]' : it.kind === 'sign' ? ' [서명]' : ' [체크]'); }).join('\n')
    ].join('\n');
  }
  // AI 답(parseAiJson 의 rows = cells) → 격자에 채움. 반환: { filled, skipped, unsure: [칸 키] }
  function applyAiCells(grid, rows) {
    var tpl = sheetTemplate(grid.template);
    var res = { filled: 0, skipped: 0, unsure: [] };
    if (!tpl) return res;
    grid.cells = grid.cells || {};
    var slots = {}; gridSlots(grid, tpl).forEach(function (s) { slots[s.day + '|' + s.shift] = true; });
    (rows || []).forEach(function (r) {
      var it = tpl.items.filter(function (x) { return normKey(x.no) === normKey(r.item); })[0];
      var day = parseInt(r.day, 10), shift = tpl.shifts.length ? String(r.shift || '').trim() : '';
      var v = normMark(r.mark != null ? r.mark : r.value, it ? it.kind : 'check');
      if (!it || !slots[day + '|' + shift] || !v) { res.skipped++; return; }
      var k = cellKey(it.no, day, shift);
      grid.cells[k] = v; res.filled++;
      if (r.unsure) res.unsure.push(k);
    });
    return res;
  }

  // ── 백업(엑셀 시트) ─────────────────────────────────────────
  var INSP_FIELDS = ['id', 'part_no', 'rev', 'lot', 'insp_date', 'vendor', 'inspector', 'drawing_name'];
  var SPEC_COLS = ['no', 'name', 'type', 'nominal', 'tol_upper', 'tol_lower', 'unit', 'decimals', 'fit', 'tol_src', 'datum'];
  var GRID_COLS = ['id', 'template', 'vendor', 'equip', 'equip_no', 'dept', 'keeper', 'month', 'photo_date', 'day_from', 'day_to', 'off_days', 'ranges', 'note', 'photo', 'photo_hash'];
  var MEAS_COLS = ['no', 'name', 'value', 'unit', 'source', 'nominal', 'tol_upper', 'tol_lower', 'orig_no', 'matched', 'photo'];

  function dbToSheets(db) {
    var insp = [INSP_FIELDS.slice()], spec = [['insp_id'].concat(SPEC_COLS)], meas = [['insp_id'].concat(MEAS_COLS)], pins = [['insp_id', 'no', 'x', 'y']];
    (db.inspections || []).forEach(function (it) {
      insp.push(INSP_FIELDS.map(function (k) { return it[k] == null ? '' : it[k]; }));
      (it.spec || []).forEach(function (s) { spec.push([it.id].concat(SPEC_COLS.map(function (k) { return s[k] == null ? '' : s[k]; }))); });
      (it.meas || []).forEach(function (m) { meas.push([it.id].concat(MEAS_COLS.map(function (k) { return m[k] == null ? '' : m[k]; }))); });
      Object.keys(it.pins || {}).forEach(function (no) { pins.push([it.id, no, it.pins[no].x, it.pins[no].y]); });
    });
    var d = db.daily || {};
    return {
      '검사건': insp, '치수기준표': spec, '측정결과': meas, '핀좌표': pins,
      '설비목록': [['vendor', 'equip', 'order']].concat((d.equipment || []).map(function (e) { return [e.vendor, e.equip, e.order]; })),
      '일일점검': [['vendor', 'date', 'equip', 'item', 'result', 'value', 'photo', 'photo_hash']].concat((d.records || []).map(function (r) { return [r.vendor, r.date, r.equip, r.item, r.result, r.value, r.photo, r.photo_hash || '']; })),
      '점검기준값': [['item', 'lower', 'upper']].concat((d.limits || []).map(function (l) { return [l.item, l.lower, l.upper]; })),
      '월간점검표': [GRID_COLS.slice()].concat((d.grids || []).map(function (g) {
        return GRID_COLS.map(function (k) {
          if (k === 'off_days') return (g.off_days || []).join(',');
          if (k === 'ranges') return JSON.stringify(g.ranges || {});
          return g[k] == null ? '' : g[k];
        });
      })),
      '월간점검표_칸': [['grid_id', 'item', 'day', 'shift', 'value']].concat([].concat.apply([], (d.grids || []).map(function (g) {
        return Object.keys(g.cells || {}).filter(function (k) { return g.cells[k] !== ''; }).map(function (k) { var p = k.split('|'); return [g.id, p[0], Number(p[1]), p[2], g.cells[k]]; });
      })))
    };
  }
  function sheetObjs(rows) {
    if (!rows || !rows.length) return [];
    var head = rows[0].map(String);
    return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (k, i) { o[k] = r[i] == null ? '' : r[i]; }); return o; });
  }
  // sheets: { 시트명: 2차원 배열 } → db (다른 설정은 base 에서 유지)
  function sheetsToDb(sheets, base) {
    var db = emptyDb();
    if (base) { db.settings = base.settings; db.templates = base.templates; }
    var insp = sheetObjs(sheets['검사건']);
    var map = {};
    insp.forEach(function (o) {
      var it = newInspection({}); INSP_FIELDS.forEach(function (k) { if (o[k] !== '') it[k] = String(o[k]); });
      it.id = String(o.id || it.id); it.insp_date = toDateStr(o.insp_date);
      map[it.id] = it; db.inspections.push(it);
    });
    sheetObjs(sheets['치수기준표']).forEach(function (o) { var it = map[String(o.insp_id)]; if (it) { var s = {}; SPEC_COLS.forEach(function (k) { s[k] = o[k]; }); s.no = String(s.no); it.spec.push(s); } });
    sheetObjs(sheets['측정결과']).forEach(function (o) { var it = map[String(o.insp_id)]; if (it) { var m = {}; MEAS_COLS.forEach(function (k) { if (o[k] !== undefined && (o[k] !== '' || MEAS_COLS.indexOf(k) < 5)) m[k] = o[k]; }); m.no = String(m.no == null ? '' : m.no); it.meas.push(m); } });
    sheetObjs(sheets['핀좌표']).forEach(function (o) { var it = map[String(o.insp_id)]; if (it) it.pins[String(o.no)] = { x: Number(o.x), y: Number(o.y) }; });
    db.daily.equipment = sheetObjs(sheets['설비목록']);
    db.daily.records = sheetObjs(sheets['일일점검']).map(function (r) { r.date = toDateStr(r.date); return r; });
    db.daily.limits = sheetObjs(sheets['점검기준값']);
    var gmap = {};
    db.daily.grids = sheetObjs(sheets['월간점검표']).map(function (o) {
      var g = { cells: {} };
      GRID_COLS.forEach(function (k) { g[k] = o[k] == null ? '' : String(o[k]); });
      g.off_days = g.off_days ? g.off_days.split(',').map(Number).filter(function (n) { return n > 0; }) : [];
      try { g.ranges = g.ranges ? JSON.parse(g.ranges) : {}; } catch (e) { g.ranges = {}; }
      g.day_from = Number(g.day_from) || ''; g.day_to = Number(g.day_to) || '';
      g.photo_date = toDateStr(o.photo_date);
      gmap[g.id] = g; return g;
    });
    sheetObjs(sheets['월간점검표_칸']).forEach(function (o) { var g = gmap[String(o.grid_id)]; if (g) g.cells[cellKey(o.item, o.day, o.shift)] = String(o.value); });
    db.current = db.inspections.length ? db.inspections[0].id : null;
    return db;
  }

  function emptyDb() {
    return {
      inspections: [], current: null,
      // offline_mode: 폐쇄망 모드(기본 켬) — 켜져 있으면 「AI 읽기」를 숨기고 어떤 요청도 밖으로 보내지 않습니다
      settings: { match_by_name: true, round_before_judge: false, blank_unit_as_spec: true, offline_mode: true, ai_base_url: '', ai_model: 'gpt-4o-mini' },
      templates: [],
      daily: { equipment: [], records: [], limits: [], repeat_days: '', grids: [], formal_run: 3 }
    };
  }
  var seq = 0;
  function newInspection(info, now) {
    now = now || new Date();
    seq++;
    return {
      id: 'I' + now.getTime().toString(36) + seq, part_no: info.part_no || '', rev: info.rev || '', lot: info.lot || '',
      insp_date: info.insp_date || toDateStr(now), vendor: info.vendor || '', inspector: info.inspector || '',
      drawing_name: '', spec: [], meas: [], pins: {}
    };
  }

  // ══ 2026-09-29 메일 자료(과제 A) ═══════════════════════════════════════
  // ① CMM PDF 성적서(ZEISS CALYPSO 형식) 바로 읽기 ② 측정실 성적서 엑셀(보어별 내경·형상공차) ③ 도면 표기 읽기·끼워맞춤 공차

  // ── 각도: 도·분·초 ↔ 십진 도 ─────────────────────────────────
  // "3° 11' 5\"" → 3.184722…, "-0° 30' 0\"" → -0.5 (부호는 전체에 붙습니다). 초 단위 정수로도 돌려줍니다.
  function parseDms(text) {
    if (text == null) return null;
    var s = String(text).normalize ? String(text).normalize('NFKC') : String(text);
    s = s.replace(/[−–—]/g, '-').replace(/[’′]/g, "'").replace(/[”″]/g, '"').trim();
    var m = s.match(/^([+-]?)\s*(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*')?\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
    if (!m) {
      // 분만 있는 공차 표기(-30') 도 받습니다
      var mm = s.match(/^([+-]?)\s*(\d+(?:\.\d+)?)\s*'$/);
      if (!mm) return null;
      m = [s, mm[1], '0', mm[2], null];
    }
    var sec = Number(m[2]) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
    if (m[1] === '-') sec = -sec;
    return { deg: clean(sec / 3600), sec: sec };
  }
  function isDms(text) { return /°/.test(String(text || '')); }

  // ── pdf.js 글자 조각 → 줄·구절 ───────────────────────────────
  // items: [{ str, x, y, w, page }] (x·y 는 pt, y 는 위에서 아래로). 같은 쪽·같은 높이(±2pt)를 한 줄로 묶고,
  // 줄 안에서 간격이 gap(기본 6pt)보다 좁은 조각은 한 구절로 붙입니다(「캘리퍼」「거리」「1_Y」 → 「캘리퍼 거리1_Y」).
  function isWholeVal(s) {
    return /^([+-]?\d+(?:\.\d+)?\s*°(?:\s*\d+(?:\.\d+)?\s*')?(?:\s*\d+(?:\.\d+)?\s*")?|[+-]?\d[\d.,]*(?:\s*mm)?)$/.test(String(s).trim());
  }
  function itemsToLines(items, gap) {
    gap = gap == null ? 6 : gap;
    var list = (items || []).filter(function (t) { return String(t.str || '').trim() !== ''; })
      .map(function (t) { return { str: String(t.str), x: Number(t.x), y: Number(t.y), w: Number(t.w) || 0, page: Number(t.page) || 1 }; });
    // pdf.js 는 간격이 띄어쓰기 폭과 같으면 이웃 칸 글자를 한 조각으로 합칩니다(「0° 15' 0" -0° 15' 0" 0° 8' 20"」).
    // 조각이 값(숫자·각도)만으로 이뤄졌고 값이 둘 이상이면 글자 위치 비율로 나눠 다시 조각을 만듭니다.
    var VAL = /[+-]?\d+(?:\.\d+)?\s*°(?:\s*\d+(?:\.\d+)?\s*')?(?:\s*\d+(?:\.\d+)?\s*")?|[+-]?\d[\d.,]*(?:\s*mm\b)?/g;
    list = list.reduce(function (acc, t) {
      var s = t.str, toks = [], m;
      VAL.lastIndex = 0;
      while ((m = VAL.exec(s))) toks.push({ i: m.index, s: m[0] });
      var rest = s.replace(VAL, '').trim();
      // 값 사이가 띄어쓰기로 떨어진 경우만(999999-00001 같은 품번은 나누지 않음)
      var spaced = toks.every(function (tk, i) { return i === 0 || /\s/.test(s.slice(toks[i - 1].i + toks[i - 1].s.length, tk.i)); });
      if (toks.length < 2 || rest || !spaced) { acc.push(t); return acc; }
      var k = t.w / Math.max(1, s.length);
      toks.forEach(function (tk) { acc.push({ str: tk.s, x: t.x + tk.i * k, y: t.y, w: tk.s.length * k, page: t.page }); });
      return acc;
    }, []);
    list.sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; });
    var lines = [];
    list.forEach(function (t) {
      var ln = lines[lines.length - 1];
      if (!ln || ln.page !== t.page || Math.abs(ln.y - t.y) > 2) { ln = { page: t.page, y: t.y, items: [] }; lines.push(ln); }
      ln.items.push(t);
    });
    lines.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var ph = [];
      ln.items.forEach(function (t) {
        var str = t.str.replace(/\s+/g, ' ').trim();
        var p = ph[ph.length - 1];
        var d = p ? t.x - p.right : Infinity;
        // 앞 구절도 온전한 값이고 이 조각도 온전한 값이면 붙이지 않습니다(이웃한 두 칸의 숫자)
        var bothVal = p && isWholeVal(p.text) && isWholeVal(str);
        if (p && d < gap && !bothVal) { p.text += (d > 0.8 ? ' ' : '') + str; p.right = Math.max(p.right, t.x + t.w); }
        else ph.push({ text: str, x: t.x, right: t.x + t.w });
      });
      ln.phrases = ph;
      ln.text = ph.map(function (p) { return p.text; }).join('  ');
    });
    return lines;
  }

  // pdf.js getTextContent() 결과 → itemsToLines 입력 형식(y 를 위에서 아래로 바꿈)
  function pdfTextItems(textContent, page, pageHeight) {
    return (textContent.items || []).filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
      return { str: it.str, x: it.transform[4], y: pageHeight - it.transform[5], w: it.width, page: page };
    });
  }

  // ── CALYPSO 성적서 읽기 ──────────────────────────────────────
  // 머리(Part name·측정 시간·No. values: red …) + 측정표(Name | Measured value | Nominal value | 상한공차 | 하한공차 | 편차 | +/-).
  // 칸은 글자 위치로 나눕니다: 오른쪽 정렬된 숫자 구절의 오른쪽 끝을 모아 무리(열)를 만들고, 각 무리를 가장 가까운 머리글에 붙입니다.
  var CAL_LABELS = ['Part name', 'Drawing number', 'Order number', 'Variant', 'Company', 'Department', 'CMM 타입', 'CMM No.', 'Operator',
    'Text', 'Part ident', 'Time/Date', 'Run', 'No. measured values', 'No. values: red', '측정 시간'];
  var CAL_COLS = [
    { key: 'measured', re: /^measured/i }, { key: 'nominal', re: /^nominal/i }, { key: 'upper', re: /^상한|^upper/i },
    { key: 'lower', re: /^하한|^lower/i }, { key: 'dev', re: /^편차|^dev/i }, { key: 'exceed', re: /^\+\/-$/ }
  ];
  function calLabelKey(t) {
    var k = String(t).replace(/\s+/g, ' ').trim();
    for (var i = 0; i < CAL_LABELS.length; i++) if (k === CAL_LABELS[i]) return CAL_LABELS[i];
    return null;
  }
  // 값 글자 → { num, deg(각도면), unit }
  function calValue(text) {
    if (text == null || text === '') return null;
    var s = String(text).trim();
    if (isDms(s)) { var d = parseDms(s); return d ? { num: d.deg, sec: d.sec, unit: 'deg', text: s } : { bad: true, text: s }; }
    var m = s.match(/^([+-]?[\d.,]+)\s*(mm|µm|um|inch|in|°)?$/i);
    var n = m ? parseNum(m[1]) : null;
    return n == null ? { bad: true, text: s } : { num: n, unit: m[2] ? normUnit(m[2]) : '', text: s };
  }
  function parseCalypso(items) {
    var lines = itemsToLines(items);
    var header = {}, rows = [], sections = [], notes = [];
    var pages = {};
    lines.forEach(function (l) { pages[l.page] = true; });
    var inTable = false, curPage = 0, cols = null, nameRight = null, nameX = null, section = '';
    var pendingVals = [];   // 열 무리 만들기 전 값 구절 모음
    var rawRows = [];
    lines.forEach(function (ln) {
      if (ln.page !== curPage) { curPage = ln.page; inTable = false; }
      var ph = ln.phrases;
      // 머리글 줄: 조각 단위로 Name / Measured value / Nominal value …
      var names = ln.items.filter(function (t) { return /^name$/i.test(t.str.trim()); });
      var hasMeas = ln.items.some(function (t) { return /^measured/i.test(t.str.trim()); });
      if (names.length && hasMeas) {
        var hc = {};
        ln.items.forEach(function (t) {
          var s = t.str.trim();
          CAL_COLS.forEach(function (c) { if (hc[c.key] == null && c.re.test(s)) hc[c.key] = { x: t.x, right: t.x + t.w, center: t.x + t.w / 2 }; });
        });
        if (!cols) cols = hc;
        nameRight = hc.measured ? hc.measured.x : null; nameX = names[0].x;
        inTable = true; return;
      }
      if (!inTable) {
        // 머리 칸: 알려진 이름표 뒤의 구절이 값
        for (var i = 0; i < ph.length; i++) {
          var key = calLabelKey(ph[i].text);
          if (!key) continue;
          var nx = ph[i + 1];
          if (header[key] == null) header[key] = nx && !calLabelKey(nx.text) ? nx.text : '';
        }
        return;
      }
      // 표가 끝나는 줄(쪽 아래 Text/Event, 프로그램 표기, 쪽 번호)
      if (/^(Text|Event|n\.def\.|Page \d+ of \d+|\(\d)/.test(ln.text) || /Page \d+ of \d+/.test(ln.text)) { inTable = false; return; }
      var nameParts = ph.filter(function (p) { return nameRight == null || p.x < nameRight - 4; });
      var valParts = ph.filter(function (p) { return nameParts.indexOf(p) < 0; });
      // 구역 제목(Section View A-A): 값이 없고 이름 칸보다 왼쪽에서 시작
      if (!valParts.length) {
        var t = nameParts.map(function (p) { return p.text; }).join(' ');
        if (nameX != null && ph[0].x < nameX - 5) { section = t; sections.push({ title: t, page: ln.page }); return; }
      }
      var r = { page: ln.page, section: section, name: nameParts.map(function (p) { return p.text; }).join(' '), vals: valParts };
      rawRows.push(r);
      valParts.forEach(function (p) { pendingVals.push(p); });
    });
    // 열 무리: 값 구절 오른쪽 끝을 정렬해 12pt 넘게 벌어지면 새 무리
    var rights = pendingVals.map(function (p) { return p; }).sort(function (a, b) { return a.right - b.right; });
    var clusters = [];
    rights.forEach(function (p) {
      var c = clusters[clusters.length - 1];
      if (!c || p.right - c.maxRight > 12) { c = { maxRight: p.right, sumC: 0, n: 0, members: [] }; clusters.push(c); }
      c.maxRight = p.right; c.sumC += (p.x + p.right) / 2; c.n++; c.members.push(p);
    });
    var colKeys = CAL_COLS.map(function (c) { return c.key; }).filter(function (k) { return cols && cols[k]; });
    clusters.forEach(function (c) {
      var center = c.sumC / c.n, best = null, bd = Infinity;
      colKeys.forEach(function (k) { var d = Math.abs(cols[k].center - center); if (d < bd) { bd = d; best = k; } });
      c.key = best;
      c.members.forEach(function (p) { p.col = best; });
    });
    rawRows.forEach(function (r) {
      var o = { page: r.page, section: r.section, name: r.name };
      r.vals.forEach(function (p) {
        if (!p.col) return;
        if (o[p.col] != null) notes.push(r.name + ': ' + p.col + ' 칸에 값이 둘 — ' + o[p.col] + ' / ' + p.text);
        else o[p.col] = p.text;
      });
      rows.push(o);
    });
    var red = parseNum(header['No. values: red']), count = parseNum(header['No. measured values']);
    return {
      header: header, rows: rows, sections: sections, notes: notes, pages: Object.keys(pages).length,
      red: red, measured_count: count, columns: clusters.map(function (c) { return { key: c.key, right: Math.round(c.maxRight * 10) / 10, n: c.n }; })
    };
  }

  // 한 줄 판정. 공차 칸이 비면 「공차 없음 — 판정 제외」, 기준값이 비면 「기준값 없음 — 판정 제외」(위치도 요약 줄 등)
  var CAL_SKIP = { no_nominal: '기준값 없음 — 판정 제외', no_tol: '공차 없음 — 판정 제외', bad_value: '숫자로 읽을 수 없음 — 확인 필요', one_tol: '공차 한쪽만 있음 — 확인 필요' };
  function judgeCalypsoRow(r) {
    var mv = calValue(r.measured), nv = calValue(r.nominal), uv = calValue(r.upper), lv = calValue(r.lower);
    var out = { name: r.name, section: r.section || '', page: r.page, measured: r.measured || '', nominal: r.nominal || '', upper: r.upper || '', lower: r.lower || '',
      dev_text: r.dev || '', report_nok: !!(r.exceed && String(r.exceed).trim()), exceed_text: r.exceed || '',
      unit: mv && mv.unit ? mv.unit : (nv && nv.unit) || '', value: mv && !mv.bad ? mv.num : null, nominal_num: nv && !nv.bad ? nv.num : null,
      tol_upper: uv && !uv.bad ? uv.num : null, tol_lower: lv && !lv.bad ? lv.num : null, status: null, skip: null, deviation: null, over: null };
    if (!mv || mv.bad || (nv && nv.bad) || (uv && uv.bad) || (lv && lv.bad)) { out.status = STATUS.CHECK; out.skip = 'bad_value'; return out; }
    if (!nv) { out.status = 'SKIP'; out.skip = 'no_nominal'; return out; }
    if (!uv && !lv) { out.status = 'SKIP'; out.skip = 'no_tol'; out.deviation = clean(mv.num - nv.num); return out; }
    if (!uv || !lv) { out.status = STATUS.CHECK; out.skip = 'one_tol'; return out; }
    var dev, up, lo;
    if (mv.unit === 'deg' || nv.unit === 'deg') {
      // 각도는 초 단위 정수로 비교합니다(소수 오차 없음)
      var ms = mv.sec != null ? mv.sec : Math.round(mv.num * 3600), ns = nv.sec != null ? nv.sec : Math.round(nv.num * 3600);
      var us = uv.sec != null ? uv.sec : Math.round(uv.num * 3600), ls = lv.sec != null ? lv.sec : Math.round(lv.num * 3600);
      dev = ms - ns; up = us; lo = ls;
      out.deviation = clean(dev / 3600); out.unit = 'deg';
      out.status = dev > up || dev < lo ? STATUS.NOK : STATUS.OK;
      out.over = dev > up ? clean((dev - up) / 3600) : dev < lo ? clean((dev - lo) / 3600) : 0;
      return out;
    }
    dev = clean(mv.num - nv.num); up = uv.num; lo = lv.num;
    out.deviation = dev;
    if (dev > up + 1e-9) { out.status = STATUS.NOK; out.over = clean(dev - up); }
    else if (dev < lo - 1e-9) { out.status = STATUS.NOK; out.over = clean(dev - lo); }
    else { out.status = STATUS.OK; out.over = 0; }
    return out;
  }
  // 성적서 전체 판정 + 성적서 자체 숫자(No. values: red · No. measured values)와 맞대 보기
  function checkCalypso(parsed) {
    var rows = parsed.rows.map(judgeCalypsoRow);
    var c = { OK: 0, NOK: 0, CHECK: 0, SKIP: 0 };
    rows.forEach(function (r) { c[r.status]++; });
    var warn = [];
    if (parsed.red == null) warn.push('성적서에서 「No. values: red」를 찾지 못했습니다 — 불합격 수를 맞대 보지 못했습니다.');
    else if (parsed.red !== c.NOK) warn.push('불합격 수가 다릅니다: 성적서 red ' + parsed.red + '개 / 이 도구 NOK ' + c.NOK + '개. 성적서 원본과 줄마다 대조해 주십시오.');
    if (parsed.measured_count != null && parsed.measured_count !== rows.length)
      warn.push('측정 줄 수가 다릅니다: 성적서 ' + parsed.measured_count + '개 / 읽은 줄 ' + rows.length + '개. 빠지거나 더 읽힌 줄이 있는지 확인해 주십시오.');
    var disagree = rows.filter(function (r) { return (r.status === STATUS.NOK) !== r.report_nok && (r.status === STATUS.OK || r.status === STATUS.NOK); });
    disagree.forEach(function (r) { warn.push(r.name + ': 성적서 +/- 칸' + (r.report_nok ? '에 이탈량(' + r.exceed_text + ')이 있는데' : '이 비어 있는데') + ' 이 도구 판정은 ' + r.status + ' 입니다.'); });
    return { rows: rows, counts: c, warnings: warn, red_match: parsed.red != null && parsed.red === c.NOK, count_match: parsed.measured_count == null || parsed.measured_count === rows.length };
  }
  // 측정결과(표준 형식)로 옮기기. 기준값 없는 요약 줄은 뺍니다. 각도는 십진 도(deg)로 넣고 원래 표기는 항목명 옆에 남깁니다.
  function calypsoToMeas(checked) {
    return checked.rows.filter(function (r) { return r.nominal_num != null && r.value != null; }).map(function (r) {
      var o = { no: '', name: (r.section ? r.section + ' / ' : '') + r.name, value: r.value, unit: r.unit || 'mm', nominal: r.nominal_num };
      if (r.tol_upper != null) o.tol_upper = r.tol_upper;
      if (r.tol_lower != null) o.tol_lower = r.tol_lower;
      if (r.unit === 'deg') o.name += ' (' + r.measured + ')';
      return o;
    });
  }

  // ── 측정실 성적서 엑셀(보어별 내경 + 진원도·원통도·진직도) ──────────
  // 표준치 칸 「Ø28.186\n[+0.005/0]」 → { nominal: 28.186, upper: 0.005, lower: 0 }
  function parseStdText(text) {
    if (text == null) return null;
    if (typeof text === 'number') return { nominal: text, upper: null, lower: null, limit: text };
    var s = String(text).normalize ? String(text).normalize('NFKC') : String(text);
    s = s.replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
    var m = s.match(/^[Øø⌀φΦ]?\s*([+-]?\d*\.?\d+)\s*(?:[\[(]\s*([^\])]+)\s*[\])])?$/);
    if (!m) return null;
    var nom = parseNum(m[1]);
    if (nom == null) return null;
    if (!m[2]) return { nominal: nom, upper: null, lower: null, limit: nom, dia: /^[Øø⌀φΦ]/.test(s) };
    var t = parseTolerance(m[2]);
    return t ? { nominal: nom, upper: t.upper, lower: t.lower, dia: /^[Øø⌀φΦ]/.test(s) } : null;
  }
  var FORM_ITEMS = ['진원도', '원통도', '진직도', '평면도', '동심도', '직각도', '평행도', '위치도', '흔들림'];
  function normLabel(v) { return String(v == null ? '' : v).replace(/\s+/g, '').trim(); }
  // sheets: [{ name, rows(2차원 배열) }]. 머리행(구분 | 항목 | 측정위치 …)에서 칸 위치를 찾고,
  // 「표준치」·「측정위치 ⇒」 줄에서 측정 위치(mm)를 읽은 뒤 아래 줄을 보어별로 모읍니다.
  function parseLabReport(sheets) {
    var out = { part: '', blocks: [], anomalies: [], notes: [] };
    (sheets || []).forEach(function (sh) {
      var rows = sh.rows || [];
      var cBore = null, cItem = null, cStd = null, positions = null, block = null, lastBore = '';
      rows.forEach(function (row, ri) {
        var cells = (row || []).map(function (v) { return v == null ? '' : v; });
        var labels = cells.map(normLabel);
        var iPart = labels.indexOf('품명');
        if (iPart >= 0 && !out.part) { for (var k = iPart + 1; k < cells.length; k++) if (normLabel(cells[k])) { out.part = String(cells[k]).trim(); break; } }
        var iB = labels.indexOf('구분'), iI = labels.indexOf('항목');
        if (iB >= 0 && iI >= 0) { cBore = iB; cItem = iI; cStd = iI + 1; return; }
        if (cItem == null) return;
        var posHead = labels.some(function (l) { return l === '표준치' || /^측정위치/.test(l); });
        if (posHead && !normLabel(cells[cItem])) {
          positions = [];
          for (var c = cStd + 1; c < cells.length; c++) { var p = parseNum(cells[c]); if (p != null) positions.push({ col: c, pos: p }); }
          block = null; return;
        }
        var item = normLabel(cells[cItem]);
        if (!item) return;
        if (/^의견/.test(item)) { positions = null; return; }
        var bore = normLabel(cells[cBore]) || '';
        var std = cells[cStd];
        var vals = [];
        for (var c2 = cStd + 1; c2 < cells.length; c2++) {
          var v = parseNum(cells[c2]);
          if (v == null) continue;
          var pp = (positions || []).filter(function (x) { return x.col === c2; })[0];
          vals.push({ pos: pp ? pp.pos : null, value: v });
        }
        // 원통도·진직도처럼 보어 전체에 값 하나인 줄은 측정 위치가 없습니다
        if (vals.length === 1 && positions && positions.length > 1) vals[0].pos = null;
        if (!vals.length) return;
        if (bore) {
          lastBore = bore;
          block = { sheet: sh.name, bore: bore, row: ri + 1, lines: [] };
          out.blocks.push(block);
        } else if (!block) { out.notes.push(sh.name + ' ' + (ri + 1) + '행: 보어 이름 없이 값이 있습니다(' + item + ')'); return; }
        var sp = parseStdText(std);
        block.lines.push({ label: item, std_text: std == null ? '' : String(std), std: sp, values: vals, row: ri + 1, sheet: sh.name });
      });
    });
    // 항목명 이상: 같은 줄 수의 블록끼리 항목 순서를 비교해 다수와 다른 자리를 찾습니다(예: 다른 블록은 진직도인 자리에 진원도)
    var byLen = {};
    out.blocks.forEach(function (b) { var sig = b.lines.map(function (l) { return l.label; }).join('|'); var n = b.lines.length; (byLen[n] = byLen[n] || {})[sig] = ((byLen[n] || {})[sig] || 0) + 1; });
    out.blocks.forEach(function (b) {
      var n = b.lines.length, sigs = byLen[n], best = null, bn = 0;
      Object.keys(sigs).forEach(function (s) { if (sigs[s] > bn) { bn = sigs[s]; best = s; } });
      if (!best || bn < 2) return;
      var exp = best.split('|');
      b.lines.forEach(function (l, i) {
        if (l.label !== exp[i]) {
          l.expected = exp[i];
          out.anomalies.push({ sheet: l.sheet, row: l.row, bore: b.bore, label: l.label, expected: exp[i],
            text: b.bore + ' ' + l.sheet + '시트 ' + l.row + '행: 「' + l.label + '」 — 다른 ' + bn + '개 블록은 이 자리가 「' + exp[i] + '」입니다. 항목명 확인' });
        }
      });
      // 한 블록 안에 같은 항목명이 두 번(위치별 값이 아닌 한 값짜리) 나오는 것도 표시
    });
    return out;
  }
  // 판정 + 보어 × 항목 행렬. 내경은 기준 + 상·하한 공차, 형상공차(진원도 등)는 값 ≤ 한계(표준치 칸의 숫자)
  function labMatrix(parsed) {
    var bores = [], cells = {}, items = [];
    function key(b, it) { return b + '|' + it; }
    parsed.blocks.forEach(function (b) {
      if (bores.indexOf(b.bore) < 0) bores.push(b.bore);
      b.lines.forEach(function (l) {
        var it = l.expected || l.label;
        if (items.indexOf(it) < 0) items.push(it);
        var c = cells[key(b.bore, it)] || (cells[key(b.bore, it)] = { bore: b.bore, item: it, values: [], status: null, worst: null, margin: null, limit_text: '', flags: [] });
        if (l.expected) c.flags.push('항목명 확인(원문 「' + l.label + '」)');
        var sp = l.std;
        l.values.forEach(function (v) {
          var r = { pos: v.pos, value: v.value, status: STATUS.CHECK, margin: null, sheet: l.sheet, row: l.row };
          if (!sp) { c.flags.push('기준을 읽지 못함: ' + l.std_text); }
          else if (FORM_ITEMS.indexOf(it) >= 0 || (sp.upper == null && sp.lower == null)) {
            r.margin = clean(sp.limit - v.value); r.status = v.value > sp.limit + 1e-9 ? STATUS.NOK : STATUS.OK;
            c.limit_text = '≤ ' + sp.limit;
          } else {
            var up = clean(sp.nominal + sp.upper), lo = clean(sp.nominal + sp.lower);
            r.margin = clean(Math.min(up - v.value, v.value - lo));
            r.status = v.value > up + 1e-9 || v.value < lo - 1e-9 ? STATUS.NOK : STATUS.OK;
            c.limit_text = lo + ' ~ ' + up;
          }
          c.values.push(r);
        });
      });
    });
    var nok = [];
    Object.keys(cells).forEach(function (k) {
      var c = cells[k];
      var judged = c.values.filter(function (r) { return r.margin != null; });
      judged.forEach(function (r) { if (c.worst == null || r.margin < c.worst.margin) c.worst = r; });
      c.margin = c.worst ? c.worst.margin : null;
      c.status = !judged.length ? STATUS.CHECK : judged.some(function (r) { return r.status === STATUS.NOK; }) ? STATUS.NOK : c.flags.length ? STATUS.CHECK : STATUS.OK;
      if (c.flags.length && c.status === STATUS.OK) c.status = STATUS.CHECK;
      c.values.filter(function (r) { return r.status === STATUS.NOK; }).forEach(function (r) { nok.push({ bore: c.bore, item: c.item, pos: r.pos, value: r.value, limit: c.limit_text, over: clean(-r.margin), flags: c.flags.slice() }); });
    });
    var counts = { OK: 0, NOK: 0, CHECK: 0 };
    Object.keys(cells).forEach(function (k) { counts[cells[k].status]++; });
    return { bores: bores, items: items, cells: cells, nok: nok, counts: counts };
  }

  // ── 도면 표기 읽기 · 끼워맞춤 공차 ───────────────────────────
  // ISO 286-2 참고값(µm). 크기 구간: 초과 ~ 이하. 축 f·g·h 의 윗치수허용차(es), 구멍 F·G·H 는 EI = -es.
  // 표에 없는 등급·크기는 null — 사용자가 직접 넣습니다.
  var ISO_SIZE = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
  var ISO_IT = {
    5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
    6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
    7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
    8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97]
  };
  var ISO_FD = {
    f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
    g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
    h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
  function isoFit(size, fit) {
    var m = String(fit || '').trim().match(/^([a-zA-Z])(\d{1,2})$/);
    var d = parseNum(size);
    if (!m || d == null || d <= 0 || d > 500) return null;
    var letter = m[1], it = Number(m[2]);
    var fd = ISO_FD[letter.toLowerCase()], itv = ISO_IT[it];
    if (!fd || !itv) return null;
    var i = 0; while (ISO_SIZE[i] < d) i++;
    var T = itv[i], es = fd[i];
    var z = function (v) { return clean(v / 1000) || 0; };   // -0 을 0 으로
    if (letter === letter.toLowerCase()) return { upper: z(es), lower: z(es - T), source: 'ISO 286 ' + fit };
    return { upper: z(-es + T), lower: z(-es), source: 'ISO 286 ' + fit };
  }
  // 끼워맞춤 문자로 본 공차 방향: 축 a~h 는 위·아래 모두 0 이하, 구멍 A~H 는 모두 0 이상
  function fitSignOk(fit, up, lo) {
    var m = String(fit || '').match(/^([a-zA-Z])/);
    if (!m || up == null || lo == null) return null;
    var c = m[1];
    if (/[a-h]/.test(c)) return up <= 1e-12 && lo <= 1e-12;
    if (/[A-H]/.test(c)) return up >= -1e-12 && lo >= -1e-12;
    return null;
  }
  var GDT_SYM = { '◎': '동심도', '⌭': '원통도', '○': '진원도', '⏥': '평면도', '⌖': '위치도', '⊥': '직각도', '∥': '평행도', '//': '평행도', '↗': '흔들림', '⌰': '흔들림', '⌯': '대칭도', '⏤': '진직도' };
  var GDT_TYPES = ['동심도', '원통도', '진원도', '평면도', '위치도', '직각도', '평행도', '흔들림', '대칭도', '진직도'];
  // 측정 항목명에서 종류 추정: 동심도_A → 동심도, 반경 방향 원주 흔들림2 → 흔들림, 대칭 점1 → 대칭도, 원2_직경 → 직경
  function typeFromName(name) {
    var s = String(name || '');
    for (var i = 0; i < GDT_TYPES.length; i++) if (s.indexOf(GDT_TYPES[i]) >= 0) return GDT_TYPES[i];
    if (/흔들림|runout/i.test(s)) return '흔들림';
    if (/대칭/.test(s)) return '대칭도';
    if (/직경|지름|dia/i.test(s)) return '직경';
    if (/반경|radius/i.test(s)) return '반경';
    if (/각도|반각|angle/i.test(s)) return '각도';
    return '';
  }
  // 도면에 적힌 그대로의 표기 → 기준 한 줄 값. 예: 「Ø145.8 g6」「Ø155.4 -0.05/-0.15」「◎Ø0.08 A B」「3.5° 0/-30'」「253 0/-0.3」
  function parseDimText(text) {
    if (text == null) return null;
    var s = String(text).normalize ? String(text).normalize('NFKC') : String(text);
    s = s.replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var sym = Object.keys(GDT_SYM).filter(function (k) { return s.indexOf(k) === 0; })[0];
    var word = GDT_TYPES.filter(function (k) { return s.indexOf(k) === 0; })[0];
    if (sym || word) {
      var rest = s.slice((sym || word).length).trim().replace(/^[Øø⌀φΦ]\s*/, '');
      var m = rest.match(/^(\d*\.?\d+)\s*(.*)$/);
      if (!m) return null;
      return { type: sym ? GDT_SYM[sym] : word, nominal: 0, tol_upper: Number(m[1]), tol_lower: 0, unit: 'mm', datum: m[2].replace(/[|]/g, ' ').trim(), fit: '' };
    }
    var type = '', unit = 'mm';
    if (/^[Øø⌀φΦ]/.test(s)) { type = '직경'; s = s.replace(/^[Øø⌀φΦ]\s*/, ''); }
    else if (/^R\s*\d/i.test(s)) { type = '반경'; s = s.replace(/^R\s*/i, ''); }
    var nm = s.match(/^(\d*\.?\d+)\s*°\s*(.*)$/);
    var nominal, tail;
    if (nm) { type = '각도'; unit = 'deg'; nominal = Number(nm[1]); tail = nm[2]; }
    else {
      nm = s.match(/^(\d*\.?\d+)\s*(.*)$/);
      if (!nm) return null;
      nominal = Number(nm[1]); tail = nm[2];
    }
    tail = tail.trim();
    var out = { type: type, nominal: nominal, tol_upper: '', tol_lower: '', unit: unit, fit: '', datum: '' };
    if (!tail) return out;
    var fm = tail.match(/^([a-zA-Z]{1,2}\d{1,2})$/);
    if (fm) { out.fit = fm[1]; var iso = isoFit(nominal, fm[1]); if (iso) { out.tol_upper = iso.upper; out.tol_lower = iso.lower; out.tol_src = iso.source; } return out; }
    if (unit === 'deg') {
      var parts = tail.split(/\s*\/\s*|\s+/).filter(Boolean).map(function (p) {
        if (/'$/.test(p) || /°/.test(p)) { var d = parseDms(p); return d ? d.deg : null; }
        return parseNum(p);
      });
      if (parts.length === 2 && parts[0] != null && parts[1] != null) { out.tol_upper = Math.max(parts[0], parts[1]); out.tol_lower = Math.min(parts[0], parts[1]); return out; }
      if (/^±/.test(tail)) { var pm = parseDms(tail.slice(1)) || { deg: parseNum(tail.slice(1)) }; if (pm.deg != null) { out.tol_upper = pm.deg; out.tol_lower = -pm.deg; return out; } }
      return null;
    }
    var t = parseTolerance(tail);
    if (!t) return null;
    out.tol_upper = t.upper; out.tol_lower = t.lower;
    return out;
  }

  var api = {
    STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, DIM_TYPES: DIM_TYPES, REASONS: REASONS, FIELDS: FIELDS, CHECK_KIND: CHECK_KIND,
    parseNum: parseNum, roundTo: roundTo, parseTolerance: parseTolerance, normUnit: normUnit, convertUnit: convertUnit,
    normKey: normKey, specLimits: specLimits, judgeValue: judgeValue, evaluate: evaluate, reasonText: reasonText,
    detectDelimiter: detectDelimiter, parseDelimited: parseDelimited, guessMapping: guessMapping, guessHeaderRow: guessHeaderRow, applyMapping: applyMapping,
    missingRequired: missingRequired, normalizeSpecRow: normalizeSpecRow, reportRows: reportRows, toCsv: toCsv,
    toDateStr: toDateStr, dailyBoard: dailyBoard, dailyChecks: dailyChecks,
    indexSpec: indexSpec, matchIndex: matchIndex, normalizeMeasRow: normalizeMeasRow, suggestMatches: suggestMatches, applyMatches: applyMatches,
    matchWhyText: matchWhyText, MATCH_LEVEL: MATCH_LEVEL, nextSpecNo: nextSpecNo, specFromMeas: specFromMeas, textToRows: textToRows,
    SHEET_TEMPLATES: SHEET_TEMPLATES, GRID_KIND: GRID_KIND, sheetTemplate: sheetTemplate, normMark: normMark, cellKey: cellKey, daysInMonth: daysInMonth,
    gridSlots: gridSlots, itemRange: itemRange, gridCutoff: gridCutoff, gridChecks: gridChecks, gridSummary: gridSummary, newGrid: newGrid,
    aiPromptGrid: aiPromptGrid, applyAiCells: applyAiCells,
    aiPromptMeasure: aiPromptMeasure, aiPromptDaily: aiPromptDaily, parseAiJson: parseAiJson, hashBytes: hashBytes,
    parseDms: parseDms, itemsToLines: itemsToLines, pdfTextItems: pdfTextItems, parseCalypso: parseCalypso, judgeCalypsoRow: judgeCalypsoRow, checkCalypso: checkCalypso,
    calypsoToMeas: calypsoToMeas, CAL_SKIP: CAL_SKIP, parseStdText: parseStdText, parseLabReport: parseLabReport, labMatrix: labMatrix,
    isoFit: isoFit, fitSignOk: fitSignOk, parseDimText: parseDimText, typeFromName: typeFromName, GDT_TYPES: GDT_TYPES,
    dbToSheets: dbToSheets, sheetsToDb: sheetsToDb, emptyDb: emptyDb, newInspection: newInspection
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCLogic = api;
})(typeof window !== 'undefined' ? window : this);
