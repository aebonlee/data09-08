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
  function evaluate(inspection, settings) {
    settings = settings || {};
    var spec = inspection.spec || [], meas = inspection.meas || [];
    var byNo = {}, byName = {}, dupNo = {};
    spec.forEach(function (s, i) {
      var k = normKey(s.no);
      if (k) { if (byNo[k] != null) dupNo[k] = true; else byNo[k] = i; }
      var nk = normKey(s.name);
      if (nk && byName[nk] == null) byName[nk] = i; else if (nk) byName[nk] = -1; // 이름이 겹치면 이름 매칭 안 함
    });
    var bucket = spec.map(function () { return []; });
    var extra = [];
    meas.forEach(function (m) {
      var k = normKey(m.no), idx = null;
      if (k && byNo[k] != null) idx = byNo[k];
      else if (!k && settings.match_by_name !== false) {
        var nk = normKey(m.name);
        if (nk && byName[nk] != null && byName[nk] >= 0) idx = byName[nk];
      }
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
      { key: 'no', label: '측정번호(항목번호)', need: true, kw: ['측정번호', '항목번호', '번호', 'no', 'item', 'id', 'point', '#'] },
      { key: 'name', label: '항목명', kw: ['항목명', '명칭', 'name', 'feature', 'description', 'label'] },
      { key: 'value', label: '측정값', need: true, kw: ['측정값', '실측값', '측정치', 'actual', 'measured', 'meas', 'value', '결과'] },
      { key: 'unit', label: '단위', kw: ['단위', 'unit'] }
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
    repeat: '같은 측정값이 연속 반복됨 — 확인 필요(부정행위로 판정하지 않음)'
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
  var MEAS_COLS = ['no', 'name', 'value', 'unit', 'source'];

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
      '일일점검': [['vendor', 'date', 'equip', 'item', 'result', 'value', 'photo']].concat((d.records || []).map(function (r) { return [r.vendor, r.date, r.equip, r.item, r.result, r.value, r.photo]; })),
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
    sheetObjs(sheets['측정결과']).forEach(function (o) { var it = map[String(o.insp_id)]; if (it) { var m = {}; MEAS_COLS.forEach(function (k) { m[k] = o[k]; }); m.no = String(m.no); it.meas.push(m); } });
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
      settings: { match_by_name: true, round_before_judge: false, blank_unit_as_spec: true },
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
    dbToSheets: dbToSheets, sheetsToDb: sheetsToDb, emptyDb: emptyDb, newInspection: newInspection
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCLogic = api;
})(typeof window !== 'undefined' ? window : this);
