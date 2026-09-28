/*
 * 예시 데이터 — 시연용 가상 데이터입니다. 실제 부품·도면·측정값·협력사가 아닙니다.
 * 과제 A: 가상 부품 EX-BRKT-100 (치수 12개, CMM + 수기 측정)
 * 과제 B: 가상 협력사 3곳의 설비 일일점검 7일치
 */
(function (root) {
  'use strict';

  // 치수 기준표 (가상)
  var SPEC = [
    ['1', '전장', '선형', 100, 0.2, -0.2, 'mm', 2],
    ['2', '폭', '선형', 40, 0.1, -0.1, 'mm', 2],
    ['3', '두께', '선형', 5, 0.05, -0.05, 'mm', 2],
    ['4', '구멍 A 직경', '직경', 8, 0.05, 0, 'mm', 2],
    ['5', '구멍 B 직경', '직경', 8, 0.05, 0, 'mm', 2],
    ['6', '구멍 중심 간 거리', '위치', 60, 0.1, -0.1, 'mm', 2],
    ['7', '구멍 중심 높이', '위치', 20, 0.1, -0.1, 'mm', 2],
    ['8', '모서리 반경', '반경', 5, 0.2, -0.2, 'mm', 1],
    ['9', '경사 각도', '각도', 30, 0.5, -0.5, 'deg', 1],
    ['10', '홈 깊이', '깊이', 3, 0.1, 0, 'mm', 2],
    ['11', '홈 폭', '선형', 12, 0.1, -0.1, 'mm', 2],
    ['12', '면취', '선형', 1, 0.2, -0.2, 'mm', 1]
  ];
  // 가상 CMM 출력 (앞 두 줄은 장비 출력 머리글을 흉내 낸 제목 줄)
  var CMM_ROWS = [
    ['예시 데이터 - 가상 CMM 출력 (실제 장비 파일 아님)'],
    ['Part', 'EX-BRKT-100', 'Rev', 'A'],
    ['Point', 'Feature', 'Nominal', 'Actual', 'Deviation', 'Unit'],
    ['1', 'LENGTH', 100, 100.12, 0.12, 'mm'],
    ['2', 'WIDTH', 40, 40.13, 0.13, 'mm'],
    ['3', 'THICK', 5, 5.02, 0.02, 'mm'],
    ['4', 'HOLE_A_DIA', 8, 8.03, 0.03, 'mm'],
    ['5', 'HOLE_B_DIA', 8, 7.98, -0.02, 'mm'],
    ['6', 'HOLE_PITCH', 60, 60.04, 0.04, 'mm'],
    ['7', 'HOLE_HEIGHT', 20, 19.95, -0.05, 'mm'],
    ['8', 'RADIUS', 5, 5.1, 0.1, 'mm'],
    ['10', 'SLOT_DEPTH', 3, 3.06, 0.06, 'mm'],
    ['13', 'EXTRA_POINT', 2.5, 2.5, 0, 'mm']
  ];
  // 가상 수기 측정 (종이 검사표를 사람이 옮겨 적은 값이라고 가정)
  var MANUAL = [
    ['9', '경사 각도', '30.2', 'deg'],
    ['12', '면취', '1.1', 'mm']
  ];
  // 도면 위 풍선 번호 위치 (그림 폭·높이에 대한 비율)
  var PINS = {
    1: [450, 482], 2: [842, 270], 3: [930, 118], 4: [214, 206], 5: [690, 206], 6: [450, 70],
    7: [58, 330], 8: [792, 120], 9: [150, 470], 10: [528, 190], 11: [372, 118], 12: [792, 432]
  };
  var W = 1000, H = 700;

  function drawingSvg() {
    var balloons = Object.keys(PINS).map(function (k) {
      var p = PINS[k];
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="17" fill="#fff" stroke="#1b2430" stroke-width="2"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] + 6) + '" font-size="17" text-anchor="middle" font-family="sans-serif">' + k + '</text>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="1000" height="700" fill="#ffffff"/>' +
      '<g fill="none" stroke="#1b2430" stroke-width="3">' +
      '<path d="M150 390 L150 190 L190 150 L414 150 L414 168 L486 168 L486 150 L720 150 Q750 150 750 180 L750 384 L744 390 Z"/>' +
      '<circle cx="270" cy="270" r="24"/><circle cx="630" cy="270" r="24"/>' +
      '<rect x="880" y="150" width="30" height="240"/></g>' +
      '<g stroke="#56616f" stroke-width="1.5" fill="none" stroke-dasharray="6 4">' +
      '<line x1="270" y1="230" x2="270" y2="310"/><line x1="630" y1="230" x2="630" y2="310"/><line x1="230" y1="270" x2="670" y2="270"/></g>' +
      '<g stroke="#56616f" stroke-width="1.5">' +
      '<line x1="150" y1="440" x2="750" y2="440"/><line x1="800" y1="150" x2="800" y2="390"/>' +
      '<line x1="270" y1="100" x2="630" y2="100"/><line x1="100" y1="270" x2="100" y2="390"/></g>' +
      '<g font-family="sans-serif" font-size="16" fill="#1b2430">' +
      '<text x="450" y="432" text-anchor="middle">100 ±0.2</text>' +
      '<text x="812" y="300">40 ±0.1</text>' +
      '<text x="450" y="94" text-anchor="middle">60 ±0.1</text>' +
      '<text x="108" y="360">20 ±0.1</text>' +
      '<text x="214" y="246" text-anchor="middle">Ø8 +0.05/0</text>' +
      '<text x="690" y="246" text-anchor="middle">Ø8 +0.05/0</text>' +
      '<text x="895" y="410" text-anchor="middle">5 ±0.05</text>' +
      '<text x="742" y="146" text-anchor="end">R5</text>' +
      '<text x="176" y="176">30°</text>' +
      '<text x="450" y="146" text-anchor="middle">12 ±0.1 / 깊이 3 +0.1/0</text>' +
      '<text x="740" y="412" text-anchor="end">C1</text></g>' +
      '<g font-family="sans-serif" fill="#8a4b00"><rect x="560" y="560" width="420" height="120" fill="#fff4d6" stroke="#8a4b00"/>' +
      '<text x="580" y="598" font-size="22" font-weight="700">예시 데이터 — 가상 도면</text>' +
      '<text x="580" y="630" font-size="17">품번 EX-BRKT-100 Rev A (가상 부품)</text>' +
      '<text x="580" y="660" font-size="17">실제 도면이 아닙니다. 시연용입니다.</text></g>' +
      balloons + '</svg>';
  }

  var EQUIP = [
    ['예시협력사-가', '1호기', 1], ['예시협력사-가', '2호기', 2],
    ['예시협력사-나', 'P-01', 1], ['예시협력사-나', 'P-02', 2], ['예시협력사-나', 'P-03', 3],
    ['예시협력사-다', '용접기-1', 1]
  ];
  var LIMITS = [['압력', 15, 20], ['온도', 40, 60], ['청소 상태', '', '']];
  var DAYS = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'];

  // 결정적(난수 없음) 가상 점검값
  function dailyRecords() {
    var out = [];
    DAYS.forEach(function (d, di) {
      EQUIP.forEach(function (e, ei) {
        if (d === '2026-09-28' && e[1] === 'P-02') return;          // 미등록
        if (d === '2026-09-25' && e[1] === '용접기-1') return;       // 미등록
        var photo = e[0].slice(-1) + '_' + e[1] + '_' + d.replace(/-/g, '') + '.jpg';
        var p = (16 + ((di * 3 + ei * 5) % 30) / 10).toFixed(1);
        if (e[1] === '1호기') p = '18.0';                             // 7일 내내 같은 값
        if (d === '2026-09-27' && e[1] === 'P-01') p = '21.4';        // 상한 이탈
        var t = String(45 + ((di + ei * 2) % 9));
        var tRes = '○';
        if (d === '2026-09-26' && e[1] === '2호기') { t = ''; }       // 측정값 미기입
        if (d === '2026-09-28' && e[1] === 'P-03') { tRes = ''; }     // 판정 빈칸
        out.push({ vendor: e[0], date: d, equip: e[1], item: '압력', result: '○', value: p, photo: photo });
        out.push({ vendor: e[0], date: d, equip: e[1], item: '온도', result: tRes, value: t, photo: photo });
        out.push({ vendor: e[0], date: d, equip: e[1], item: '청소 상태', result: (d === '2026-09-24' && e[1] === '용접기-1') ? '×' : '○', value: '', photo: photo });
      });
    });
    return out;
  }

  function build() {
    var spec = SPEC.map(function (r) { return { no: r[0], name: r[1], type: r[2], nominal: r[3], tol_upper: r[4], tol_lower: r[5], unit: r[6], decimals: r[7] }; });
    var meas = CMM_ROWS.slice(3).map(function (r) { return { no: String(r[0]), name: r[1], value: r[3], unit: r[5], source: 'CMM' }; })
      .concat(MANUAL.map(function (r) { return { no: r[0], name: r[1], value: r[2], unit: r[3], source: '수기' }; }));
    var pins = {};
    Object.keys(PINS).forEach(function (k) { pins[k] = { x: PINS[k][0] / W, y: PINS[k][1] / H }; });
    var insp = {
      id: 'SAMPLE-1', part_no: 'EX-BRKT-100', rev: 'A', lot: 'EX-LOT-001', insp_date: '2026-09-28',
      vendor: '예시협력사-가', inspector: '예시 검사자', drawing_name: '예시데이터_도면.svg',
      spec: spec, meas: meas, pins: pins
    };
    return {
      _sample: true,
      inspections: [insp], current: insp.id,
      settings: { match_by_name: true, round_before_judge: false, blank_unit_as_spec: true },
      templates: [{ name: '예시 CMM 출력(가상)', kind: 'meas', cols: { no: 'Point', name: 'Feature', value: 'Actual', unit: 'Unit' } }],
      daily: {
        equipment: EQUIP.map(function (e) { return { vendor: e[0], equip: e[1], order: e[2] }; }),
        records: dailyRecords(),
        limits: LIMITS.map(function (l) { return { item: l[0], lower: l[1], upper: l[2] }; }),
        repeat_days: 5
      }
    };
  }

  var api = { build: build, drawingSvg: drawingSvg, SPEC: SPEC, CMM_ROWS: CMM_ROWS, MANUAL: MANUAL, EQUIP: EQUIP, LIMITS: LIMITS, dailyRecords: dailyRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCSample = api;
})(typeof window !== 'undefined' ? window : this);
