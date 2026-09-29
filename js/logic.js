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
  var DIM_TYPES = ['선형', '직경', '반경', '각도', '깊이', '위치'];

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
    range: '측정값이 이 항목 공차 안(기준값 정보 없음 — 참고용)', taken: '이미 같은 출처 측정이 붙은 항목', order: '같은 기준 항목이 여럿 — 순서대로 짝지음'
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
      spec.forEach(function (s, j) {
        if (!normKey(s.no)) return;               // 번호 없는 기준 줄에는 붙일 수 없습니다
        var sn = parseNum(s.nominal); if (sn == null) return;
        var score = 0, why = [];
        if (mn != null) {
          if (!sameNum(toSpecUnit(mn, m.unit, s.unit), sn)) return;
          score = 60; why.push('nominal');
          var su = parseNum(s.tol_upper), sl = parseNum(s.tol_lower);
          if (mu != null || ml != null) {
            var a = toSpecUnit(mu == null ? 0 : mu, m.unit, s.unit), b = toSpecUnit(ml == null ? 0 : ml, m.unit, s.unit);
            if (sameNum(a, su == null ? 0 : su) && sameNum(b, sl == null ? 0 : sl)) { score += 30; why.push('tol'); }
            else { score -= 20; why.push('tol_diff'); }
          }
        } else {
          var lim = specLimits(s), v = toSpecUnit(mv, m.unit, s.unit);
          if (lim.error || v == null || v < lim.lower || v > lim.upper) return;
          score = 15; why.push('range');
        }
        if (normKey(m.name) && normKey(m.name) === normKey(s.name)) { score += 10; why.push('name'); }
        cands.push({ j: j, score: score, why: why });
      });
      out.push({ meas: i, cands: cands });
    });
    // 측정 순서대로, 아직 이 출처로 짝지어지지 않은 항목 중 점수가 가장 높은 것
    return out.map(function (o) {
      var src = meas[o.meas].source || '';
      var live = o.cands.map(function (c) {
        var t = taken[c.j] && taken[c.j][src];
        return { j: c.j, score: c.score - (t ? 25 : 0), why: t ? c.why.concat('taken') : c.why };
      }).filter(function (c) { return c.score >= 15; });
      live.sort(function (a, b) { return b.score - a.score || a.j - b.j; });
      if (!live.length) return { meas: o.meas, no: null, level: null, score: 0, why: [], alts: [] };
      var pick = live[0];
      var level = pick.score >= 90 ? 'high' : pick.score >= 50 ? 'mid' : 'low';
      var why = pick.why.slice();
      // 원래 점수(이미 짝지은 것 빼기 전)로 같은 최고점 후보가 여럿이었으면 순서로 짝지은 것입니다
      var raw = o.cands.filter(function (c) { return c.j === pick.j; })[0].score;
      var rivals = o.cands.filter(function (c) { return c.score === raw; }).length;
      if (rivals > 1) { why.push('order'); if (level === 'high') level = 'mid'; }
      (taken[pick.j] = taken[pick.j] || {})[src] = true;
      return {
        meas: o.meas, no: spec[pick.j].no, name: spec[pick.j].name || '', level: level, score: pick.score, why: why,
        alts: live.slice(1).filter(function (c) { return c.score >= 50; }).map(function (c) { return spec[c.j].no; })
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

  // ── 백업(엑셀 시트) ─────────────────────────────────────────
  var INSP_FIELDS = ['id', 'part_no', 'rev', 'lot', 'insp_date', 'vendor', 'inspector', 'drawing_name'];
  var SPEC_COLS = ['no', 'name', 'type', 'nominal', 'tol_upper', 'tol_lower', 'unit', 'decimals'];
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
      '점검기준값': [['item', 'lower', 'upper']].concat((d.limits || []).map(function (l) { return [l.item, l.lower, l.upper]; }))
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
    db.current = db.inspections.length ? db.inspections[0].id : null;
    return db;
  }

  function emptyDb() {
    return {
      inspections: [], current: null,
      // offline_mode: 폐쇄망 모드(기본 켬) — 켜져 있으면 「AI 읽기」를 숨기고 어떤 요청도 밖으로 보내지 않습니다
      settings: { match_by_name: true, round_before_judge: false, blank_unit_as_spec: true, offline_mode: true, ai_model: 'gpt-4o-mini' },
      templates: [],
      daily: { equipment: [], records: [], limits: [], repeat_days: '' }
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

  var api = {
    STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, DIM_TYPES: DIM_TYPES, REASONS: REASONS, FIELDS: FIELDS, CHECK_KIND: CHECK_KIND,
    parseNum: parseNum, roundTo: roundTo, parseTolerance: parseTolerance, normUnit: normUnit, convertUnit: convertUnit,
    normKey: normKey, specLimits: specLimits, judgeValue: judgeValue, evaluate: evaluate, reasonText: reasonText,
    detectDelimiter: detectDelimiter, parseDelimited: parseDelimited, guessMapping: guessMapping, guessHeaderRow: guessHeaderRow, applyMapping: applyMapping,
    missingRequired: missingRequired, normalizeSpecRow: normalizeSpecRow, reportRows: reportRows, toCsv: toCsv,
    toDateStr: toDateStr, dailyBoard: dailyBoard, dailyChecks: dailyChecks,
    indexSpec: indexSpec, matchIndex: matchIndex, normalizeMeasRow: normalizeMeasRow, suggestMatches: suggestMatches, applyMatches: applyMatches,
    matchWhyText: matchWhyText, MATCH_LEVEL: MATCH_LEVEL, nextSpecNo: nextSpecNo, specFromMeas: specFromMeas, textToRows: textToRows,
    aiPromptMeasure: aiPromptMeasure, aiPromptDaily: aiPromptDaily, parseAiJson: parseAiJson, hashBytes: hashBytes,
    dbToSheets: dbToSheets, sheetsToDb: sheetsToDb, emptyDb: emptyDb, newInspection: newInspection
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCLogic = api;
})(typeof window !== 'undefined' ? window : this);
