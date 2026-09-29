// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 모두 손으로 계산한 값입니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('숫자 읽기');
test('보통 숫자', () => assert.equal(L.parseNum(' 12.50 '), 12.5));
test('전각 숫자·유니코드 마이너스', () => assert.equal(L.parseNum('−０.０５'), -0.05));
test('소수점 콤마 하나(12,5)는 12.5 로 읽음(가정)', () => assert.equal(L.parseNum('12,5'), 12.5));
test('글자 섞이면 null', () => assert.equal(L.parseNum('12.5mm'), null));
test('빈값 null', () => assert.equal(L.parseNum(''), null));

console.log('공차 표기');
test('±0.1', () => assert.deepEqual(L.parseTolerance('±0.1'), { upper: 0.1, lower: -0.1 }));
test('+0.2/-0.1', () => assert.deepEqual(L.parseTolerance('+0.2/-0.1'), { upper: 0.2, lower: -0.1 }));
test('단측 0/-0.05 (순서 뒤집혀도 상·하 구분)', () => assert.deepEqual(L.parseTolerance('0/-0.05'), { upper: 0, lower: -0.05 }));
test('부호 하나 +0.3 → 0 ~ +0.3', () => assert.deepEqual(L.parseTolerance('+0.3'), { upper: 0.3, lower: 0 }));
test('부호 없는 숫자 하나는 읽지 않음', () => assert.equal(L.parseTolerance('0.1'), null));

console.log('항목번호·단위');
test('항목번호 정규화: 007 = 7, #7 = 7, " a1 " = A1', () => {
  assert.equal(L.normKey('007'), '7'); assert.equal(L.normKey('#7'), '7'); assert.equal(L.normKey(' a1 '), 'A1');
});
test('엑셀 숫자 7.0 도 7', () => assert.equal(L.normKey('7.0'), '7'));
test('µm → mm 변환: 25 µm = 0.025 mm', () => assert.deepEqual(L.convertUnit(25, 'um', 'mm'), { value: 0.025 }));
test('inch → mm: 1 in = 25.4 mm', () => assert.deepEqual(L.convertUnit(1, 'inch', 'mm'), { value: 25.4 }));
test('길이 ↔ 각도는 변환 불가', () => assert.equal(L.convertUnit(1, 'deg', 'mm').error, 'unit_mismatch'));

console.log('공차 판정');
const s = { no: '1', nominal: '10', tol_upper: '0.1', tol_lower: '-0.1', unit: 'mm', decimals: 2 };
test('상·하한 = 9.9 ~ 10.1', () => { const l = L.specLimits(s); assert.equal(l.lower, 9.9); assert.equal(l.upper, 10.1); });
test('경계값 10.1 은 OK(포함) — 부동소수 오차 없이', () => assert.equal(L.judgeValue(s, { value: '10.1' }).status, 'OK'));
test('10.12 는 NOK, 편차 +0.12, 이탈량 +0.02', () => {
  const r = L.judgeValue(s, { value: '10.12' });
  assert.equal(r.status, 'NOK'); assert.equal(r.deviation, 0.12); assert.equal(r.over, 0.02);
});
test('9.85 는 NOK, 이탈량 -0.05', () => { const r = L.judgeValue(s, { value: 9.85 }); assert.equal(r.status, 'NOK'); assert.equal(r.over, -0.05); });
test('반올림 설정 켜면 10.104 → 10.10 → OK', () => {
  assert.equal(L.judgeValue(s, { value: '10.104' }).status, 'NOK');
  assert.equal(L.judgeValue(s, { value: '10.104' }, { round_before_judge: true }).status, 'OK');
});
test('단측공차 +0/-0.05: 20.00 OK, 20.01 NOK', () => {
  const s2 = { nominal: 20, tol_upper: 0, tol_lower: -0.05, unit: 'mm' };
  assert.equal(L.judgeValue(s2, { value: 20 }).status, 'OK');
  assert.equal(L.judgeValue(s2, { value: 20.01 }).status, 'NOK');
});
test('측정 단위 µm 이면 mm 로 바꿔 판정: 10050 µm = 10.05 mm → OK', () => {
  const r = L.judgeValue(s, { value: 10050, unit: 'µm' });
  assert.equal(r.status, 'OK'); assert.equal(r.value, 10.05);
});
test('단위 불일치(deg vs mm) → 확인필요', () => {
  const r = L.judgeValue(s, { value: 10, unit: 'deg' });
  assert.equal(r.status, 'CHECK'); assert.equal(r.reason, 'unit_mismatch');
});
test('측정 단위 빈칸 → 설정 켜면 기준표 단위, 끄면 그대로 비교', () => {
  assert.equal(L.judgeValue(s, { value: 10 }).status, 'OK');
  assert.equal(L.judgeValue(s, { value: 10 }, { blank_unit_as_spec: false }).reason, 'unit_unknown');
});
test('공차 빈칸 → 확인필요(no_tolerance)', () => assert.equal(L.judgeValue({ nominal: 5 }, { value: 5 }).reason, 'no_tolerance'));
test('상한 < 하한 → 확인필요(tol_reversed)', () => assert.equal(L.judgeValue({ nominal: 5, tol_upper: -0.1, tol_lower: 0.1 }, { value: 5 }).reason, 'tol_reversed'));
test('측정값이 글자 → 확인필요(invalid_value)', () => assert.equal(L.judgeValue(s, { value: 'N/A' }).reason, 'invalid_value'));

console.log('매칭 + 전체 평가');
const insp = {
  spec: [
    { no: '1', name: '전장', nominal: 100, tol_upper: 0.2, tol_lower: -0.2, unit: 'mm' },
    { no: '2', name: '구멍 직경', nominal: 8, tol_upper: 0.05, tol_lower: 0, unit: 'mm' },
    { no: '3', name: '각도', nominal: 90, tol_upper: 0.5, tol_lower: -0.5, unit: 'deg' },
    { no: '4', name: '두께', nominal: 5, tol_upper: 0.1, tol_lower: -0.1, unit: 'mm' },
    { no: '5', name: '폭', nominal: 40, tol_upper: 0.1, tol_lower: -0.1, unit: 'mm' }
  ],
  meas: [
    { no: '001', value: '100.15', source: 'CMM' },           // 1 OK
    { no: '2', value: '7.99', source: 'CMM' },               // 2 NOK (하한 8.00)
    { no: '', name: '각도', value: '90.3', source: '수기' },  // 3 이름 매칭 OK
    { no: '5', value: '40.05', source: 'CMM' },              // 5 OK
    { no: '5', value: '40.2', source: '수기' },              // 5 NOK → 혼재 → 확인필요
    { no: '9', value: '1.0', source: 'CMM' }                 // 기준표에 없음
  ]
};
const ev = L.evaluate(insp);
test('1번 OK, 2번 NOK, 3번(이름 매칭) OK', () => assert.deepEqual(ev.rows.slice(0, 3).map(r => r.status), ['OK', 'NOK', 'OK']));
test('4번 측정값 없음 → 확인필요', () => assert.deepEqual([ev.rows[3].status, ev.rows[3].reasons], ['CHECK', ['no_measurement']]));
test('5번 CMM OK + 수기 NOK → 확인필요(conflict), 대표값은 편차 큰 40.2', () => {
  assert.equal(ev.rows[4].status, 'CHECK'); assert.deepEqual(ev.rows[4].reasons, ['conflict']); assert.equal(ev.rows[4].value, 40.2);
});
test('기준표에 없는 9번은 추가 확인필요 1건', () => { assert.equal(ev.extra.length, 1); assert.equal(ev.extra[0].no, '9'); });
test('집계 OK 2 · NOK 1 · 확인필요 3 · 전체 6', () => assert.deepEqual(ev.counts, { OK: 2, NOK: 1, CHECK: 3, total: 6 }));
test('이름 매칭 끄면 3번도 확인필요', () => {
  const e2 = L.evaluate(insp, { match_by_name: false });
  assert.equal(e2.rows[2].status, 'CHECK'); assert.equal(e2.extra.length, 2);
});
test('기준표 항목번호 중복 → 두 줄 다 확인필요', () => {
  const e3 = L.evaluate({ spec: [{ no: '1', nominal: 1, tol_upper: 0.1, tol_lower: -0.1 }, { no: '01', nominal: 2, tol_upper: 0.1, tol_lower: -0.1 }], meas: [{ no: '1', value: 1 }] });
  assert.ok(e3.rows[0].reasons.includes('dup_spec'));
  assert.equal(e3.rows[0].status, 'CHECK');
});
test('성적서 표: 머리행 + 6행, NOK 줄 이탈량 -0.01', () => {
  const rows = L.reportRows(ev);
  assert.equal(rows.length, 7);
  assert.equal(rows[2][13], 'NOK'); assert.equal(rows[2][12], -0.01);
});

console.log('표 읽기·열 지정');
test('CSV 따옴표·쉼표', () => assert.deepEqual(L.parseDelimited('a,b\n"x,1","say ""hi"""\n'), [['a', 'b'], ['x,1', 'say "hi"']]));
test('탭 구분(엑셀 붙여넣기)', () => assert.deepEqual(L.parseDelimited('1\t10\t±0.1\r\n2\t8\t+0.05/0'), [['1', '10', '±0.1'], ['2', '8', '+0.05/0']]));
test('CMM 머리행 추정: 측정번호·항목명·측정값·단위 (+ 기준값 선택 칸)', () => {
  const m = L.guessMapping(['Point', 'Feature', 'Nominal', 'Actual', 'Unit'], 'meas');
  assert.deepEqual(m, { no: 0, name: 1, value: 3, unit: 4, nominal: 2 });
});
test('기준표 머리행 추정: "no" 가 Nominal 에 잘못 붙지 않음', () => {
  const m = L.guessMapping(['Nominal', 'No', '공차'], 'spec');
  assert.equal(m.no, 1); assert.equal(m.nominal, 0); assert.equal(m.tol_text, 2);
});
test('열 지정 적용 + 공차 한 칸 표기 풀기', () => {
  const rows = [['번호', '기준', '공차'], ['1', '10', '±0.1'], ['', '', '']];
  const out = L.applyMapping(rows, 0, { no: 0, nominal: 1, tol_text: 2 }, 'spec');
  assert.equal(out.length, 1); assert.equal(out[0].tol_upper, 0.1); assert.equal(out[0].tol_lower, -0.1);
});
test('머리행 추정: 제목 두 줄 건너뛰고 3번째 줄', () => assert.equal(L.guessHeaderRow([['제목'], ['Part', 'X'], ['Point', 'Feature', 'Actual'], ['1', 'a', '2']]), 2));
test('필수 열 빠짐 알림', () => assert.deepEqual(L.missingRequired({ no: 0 }, 'meas'), ['측정값']));

console.log('과제 B 일일점검');
const equip = [{ vendor: '가', equip: '1호기', order: 1 }, { vendor: '가', equip: '2호기', order: 2 }, { vendor: '나', equip: 'P-1', order: 1 }];
const recs = [
  { vendor: '가', date: '2026-09-25', equip: '1호기', item: '압력', result: '○', value: '18.0' },
  { vendor: '가', date: '2026-09-26', equip: '1호기', item: '압력', result: '○', value: '18.0' },
  { vendor: '가', date: '2026-09-27', equip: '1호기', item: '압력', result: '○', value: '18.0' },
  { vendor: '가', date: '2026/9/28', equip: '1호기', item: '압력', result: '', value: '25' },
  { vendor: '나', date: '2026-09-28', equip: 'P-1', item: '압력', result: '×', value: '' }
];
const lim = [{ item: '압력', lower: 15, upper: 20 }];
test('9/28 현황판: 가 1/2, 나 1/1, 2호기 미등록', () => {
  const b = L.dailyBoard(equip, recs, '2026-09-28');
  assert.deepEqual(b.vendors, [{ vendor: '가', total: 2, registered: 1 }, { vendor: '나', total: 1, registered: 1 }]);
  assert.equal(b.rows[1].registered, false);
});
test('규칙 검사(반복 검사 끔): 판정 빈칸·기준 이탈·판정 ×·측정값 미기입', () => {
  const c = L.dailyChecks(recs, lim, {});
  assert.deepEqual(c.map(x => x.kind), ['missing_result', 'out_of_limit', 'result_ng', 'missing_value']);
});
test('반복 3회 기준: 9/27 한 건만 표시(18.0 이 3번째)', () => {
  const c = L.dailyChecks(recs, lim, { repeat_days: 3 }).filter(x => x.kind === 'repeat');
  assert.equal(c.length, 1); assert.equal(c[0].date, '2026-09-27');
});
test('엑셀 날짜 일련번호 46293 = 2026-09-28', () => assert.equal(L.toDateStr(46293), '2026-09-28'));

console.log('예시 데이터·백업 왕복');
const sdb = Sample.build();
test('예시 데이터는 _sample 표시', () => assert.equal(sdb._sample, true));
test('예시 검사 건 판정: OK 9 · NOK 2 · 확인필요 2', () => {
  const e = L.evaluate(sdb.inspections[0], sdb.settings);
  assert.deepEqual([e.counts.OK, e.counts.NOK, e.counts.CHECK], [9, 2, 2]);
});
test('엑셀 시트로 내보냈다 다시 읽어도 판정 동일', () => {
  const back = L.sheetsToDb(L.dbToSheets(sdb), sdb);
  const a = L.evaluate(sdb.inspections[0], sdb.settings).counts, b = L.evaluate(back.inspections[0], sdb.settings).counts;
  assert.deepEqual(a, b);
  assert.equal(Object.keys(back.inspections[0].pins).length, Object.keys(sdb.inspections[0].pins).length);
  assert.equal(back.daily.records.length, sdb.daily.records.length);
});


console.log('2026-09-29 — 번호 없는 측정 ↔ 도면 항목 짝 제안');
const mkSpec = () => [
  { no: '1', name: '전장', nominal: 100, tol_upper: 0.2, tol_lower: -0.2, unit: 'mm' },
  { no: '2', name: '폭', nominal: 40, tol_upper: 0.1, tol_lower: -0.1, unit: 'mm' },
  { no: '3', name: '구멍 A', nominal: 8, tol_upper: 0.05, tol_lower: 0, unit: 'mm' },
  { no: '4', name: '구멍 B', nominal: 8, tol_upper: 0.05, tol_lower: 0, unit: 'mm' },
  { no: '5', name: '두께', nominal: 8, tol_upper: 0.1, tol_lower: -0.1, unit: 'mm' }
];
test('기준값+공차가 하나뿐이면 신뢰도 높음으로 그 항목 제안', () => {
  const insp = { spec: mkSpec(), meas: [{ no: '', name: 'LEN', value: 100.1, nominal: 100, tol_upper: 0.2, tol_lower: -0.2, unit: 'mm', source: 'CMM' }] };
  const r = L.suggestMatches(insp, {});
  assert.equal(r.length, 1); assert.equal(r[0].no, '1'); assert.equal(r[0].level, 'high'); assert.equal(r[0].score, 90);
});
test('같은 기준·공차 항목이 둘(Ø8 +0.05/0 구멍 2개)이면 측정 순서대로 3→4, 신뢰도 보통', () => {
  const m = (v) => ({ no: '', name: 'HOLE', value: v, nominal: 8, tol_upper: 0.05, tol_lower: 0, unit: 'mm', source: 'CMM' });
  const r = L.suggestMatches({ spec: mkSpec(), meas: [m(8.01), m(8.02)] }, {});
  assert.deepEqual(r.map(x => x.no), ['3', '4']);
  assert.deepEqual(r.map(x => x.level), ['mid', 'mid']);
  assert.ok(r[0].why.includes('order'));
});
test('기준값은 같고 공차가 다르면 공차까지 같은 항목이 이김(8 ±0.1 → 5번)', () => {
  const r = L.suggestMatches({ spec: mkSpec(), meas: [{ no: '', value: 8.05, nominal: 8, tol_upper: 0.1, tol_lower: -0.1, source: 'CMM' }] }, {});
  assert.equal(r[0].no, '5'); assert.equal(r[0].level, 'high');
});
test('단위가 달라도 변환해 비교(8000 µm = 8 mm)', () => {
  const r = L.suggestMatches({ spec: mkSpec(), meas: [{ no: '', value: 8050, nominal: 8000, tol_upper: 100, tol_lower: -100, unit: 'um', source: 'CMM' }] }, {});
  assert.equal(r[0].no, '5');
});
test('이미 번호로 짝지어진 측정은 제안 대상이 아님', () => {
  const r = L.suggestMatches({ spec: mkSpec(), meas: [{ no: '2', value: 40, source: 'CMM' }] }, {});
  assert.equal(r.length, 0);
});
test('기준값 정보가 없으면 측정값이 공차 안에 드는 항목을 낮음으로만 제안', () => {
  const r = L.suggestMatches({ spec: mkSpec(), meas: [{ no: '', value: 39.95, source: '수기' }] }, {});
  assert.equal(r[0].no, '2'); assert.equal(r[0].level, 'low');
});
test('맞는 기준값이 없으면 제안 없음(no=null)', () => {
  const r = L.suggestMatches({ spec: mkSpec(), meas: [{ no: '', value: 2.5, nominal: 2.5, source: 'CMM' }] }, {});
  assert.equal(r[0].no, null);
});
test('이미 같은 출처 측정이 붙은 항목은 뒤로 밀림 — 전장 CMM 이 있으면 두 번째 100 은 제안 점수 하락', () => {
  const insp = { spec: mkSpec(), meas: [{ no: '1', value: 100, source: 'CMM' }, { no: '', value: 100.1, nominal: 100, tol_upper: 0.2, tol_lower: -0.2, source: 'CMM' }] };
  const r = L.suggestMatches(insp, {});
  assert.equal(r[0].no, '1'); assert.equal(r[0].score, 65); assert.equal(r[0].level, 'mid'); assert.ok(r[0].why.includes('taken'));
});
test('제안 반영: 측정 번호가 바뀌고 원래 번호는 orig_no 로 남음 → 판정에 들어감', () => {
  const insp = { spec: mkSpec(), meas: [{ no: 'P17', value: 100.3, nominal: 100, tol_upper: 0.2, tol_lower: -0.2, source: 'CMM' }] };
  const r = L.suggestMatches(insp, {});
  assert.equal(r[0].no, '1');
  assert.equal(L.applyMatches(insp, [{ meas: 0, no: r[0].no }]), 1);
  assert.equal(insp.meas[0].no, '1'); assert.equal(insp.meas[0].orig_no, 'P17'); assert.equal(insp.meas[0].matched, 'suggest');
  const e = L.evaluate(insp, {}); assert.equal(e.rows[0].status, 'NOK'); assert.equal(e.extra.length, 0);
});
test('도면에 번호가 없을 때: 측정 결과로 기준표를 만들고 1, 2, 3… 자동 번호', () => {
  const insp = { spec: [], meas: [
    { no: '', name: 'A', value: 10.05, nominal: 10, tol_upper: 0.1, tol_lower: -0.1, unit: 'mm', source: 'CMM' },
    { no: '', name: 'B', value: 20.3, nominal: 20, tol_upper: 0.2, tol_lower: -0.2, unit: 'mm', source: 'CMM' },
    { no: '', name: 'C', value: 5 }] };
  assert.equal(L.specFromMeas(insp, {}), 2);
  assert.deepEqual(insp.spec.map(s => s.no), ['1', '2']);
  assert.deepEqual(insp.meas.map(m => m.no), ['1', '2', '']);
  const e = L.evaluate(insp, {}); assert.deepEqual([e.counts.OK, e.counts.NOK, e.counts.CHECK], [1, 1, 1]);
});
test('기준표에 있는 번호 다음부터 매김(nextSpecNo) — 숫자 아닌 번호는 무시', () => {
  assert.equal(L.nextSpecNo([{ no: '3' }, { no: 'A1' }, { no: '007' }]), 8);
  assert.equal(L.nextSpecNo([]), 1);
});
test('CMM 열 지정: 공차 한 칸 표기를 상·하한으로 풀고 빈 선택 칸은 뺌', () => {
  const rows = [['No', 'Nominal', 'Tol', 'Actual'], ['', '8', '+0.05/0', '8.02'], ['3', '', '', '5.1']];
  const out = L.applyMapping(rows, 0, L.guessMapping(rows[0], 'meas'), 'meas');
  assert.equal(out[0].nominal, '8'); assert.equal(out[0].tol_upper, 0.05); assert.equal(out[0].tol_lower, 0);
  assert.ok(!('nominal' in out[1]));
});

console.log('PDF 성적서 글자 붙여넣기');
test('공백으로만 나뉜 글자: 띄어 쓴 항목명은 한 칸, 머리행은 낱말마다', () => {
  const rows = L.textToRows('No Feature Nominal Actual\n1 HOLE A DIA 8.000 8.030\n2 LENGTH 100.000 99.950\n');
  assert.deepEqual(rows[1], ['1', 'HOLE A DIA', '8.000', '8.030']);
  assert.deepEqual(rows[2], ['1'.replace('1', '2'), 'LENGTH', '100.000', '99.950']);
  assert.deepEqual(rows[0], ['No', 'Feature', 'Nominal', 'Actual']);
});
test('두 칸 이상 공백·탭이 있으면 그것으로 나눔', () => {
  assert.deepEqual(L.textToRows('1   HOLE A   8.0')[0], ['1', 'HOLE A', '8.0']);
  assert.deepEqual(L.textToRows('1\tHOLE A\t8.0')[0], ['1', 'HOLE A', '8.0']);
});
test('붙여넣은 글자 → 열 지정 → 판정까지', () => {
  const rows = L.textToRows('Point Feature Nominal +Tol -Tol Actual\n1 LENGTH 100 0.2 -0.2 100.25');
  const map = L.guessMapping(rows[0], 'meas');
  assert.equal(map.value, 5); assert.equal(map.tol_upper, 3); assert.equal(map.tol_lower, 4);
  const m = L.applyMapping(rows, 0, map, 'meas');
  const e = L.evaluate({ spec: mkSpec(), meas: m }, {}); assert.equal(e.rows[0].status, 'NOK');
});

console.log('사진 판독(AI) 답 읽기 · 사진 지문');
test('```json 울타리와 앞뒤 설명이 있어도 배열을 읽음', () => {
  const r = L.parseAiJson('다음과 같습니다.\n```json\n[{"no":"9","value":"30.2","unsure":false},{"no":12,"value":1.1,"unsure":"true"}]\n```\n확인해 주세요');
  assert.equal(r.rows.length, 2); assert.equal(r.rows[1].no, '12'); assert.equal(r.rows[1].value, '1.1'); assert.equal(r.rows[1].unsure, true);
});
test('{rows:[...]} 형태도 받음, 배열이 없으면 error', () => {
  assert.equal(L.parseAiJson('{"rows":[{"item":"압력","result":"○","value":"18.2"}]}').rows[0].item, '압력');
  assert.ok(L.parseAiJson('읽을 수 없습니다').error);
});
test('요청문에 항목번호 목록이 들어가고 기준값·공차(도면 정보)는 들어가지 않음', () => {
  const p = L.aiPromptMeasure(mkSpec());
  assert.ok(p.includes('- 3 (구멍 A)')); assert.ok(!p.includes('0.05')); assert.ok(p.includes('해 줘'));
});
test('사진 지문: 같은 바이트면 같고, 한 바이트만 달라도 다름', () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]), b = new Uint8Array([1, 2, 3, 4, 6]);
  assert.equal(L.hashBytes(a), L.hashBytes(new Uint8Array([1, 2, 3, 4, 5]))); assert.notEqual(L.hashBytes(a), L.hashBytes(b));
});
test('같은 사진 파일이 다른 날·다른 설비에 다시 쓰이면 확인 필요, 같은 점검 안의 여러 항목은 한 번만', () => {
  const recs = [
    { vendor: 'A', date: '2026-09-28', equip: '1호기', item: '압력', result: '○', value: '18', photo_hash: 'h1' },
    { vendor: 'A', date: '2026-09-28', equip: '1호기', item: '온도', result: '○', value: '45', photo_hash: 'h1' },
    { vendor: 'A', date: '2026-09-29', equip: '1호기', item: '압력', result: '○', value: '18', photo_hash: 'h1' },
    { vendor: 'A', date: '2026-09-29', equip: '1호기', item: '온도', result: '○', value: '45', photo_hash: 'h1' },
    { vendor: 'A', date: '2026-09-29', equip: '2호기', item: '압력', result: '○', value: '17', photo_hash: 'h2' }];
  const c = L.dailyChecks(recs, [], {}).filter(x => x.kind === 'same_photo');
  assert.equal(c.length, 1); assert.equal(c[0].date, '2026-09-29');
});


console.log('2026-09-29 메일 — 과제 B 월간 점검표 격자(중국어 양식 2종)');
{
  const [g1, g2] = Sample.sampleGrids();
  const kinds = (g, o) => L.gridChecks(g, o || {}).map(c => [c.day, c.shift, c.no, c.kind].filter(x => x !== '').join(' '));
  test('양식 2종: CNC 9항목(1·8 숫자, 9 서명), 호빙기 13항목 × 日/中(9 숫자), 중국어·한국어 모두 있음', () => {
    const a = L.sheetTemplate('cnc_monthly'), b = L.sheetTemplate('hob_daily');
    assert.equal(a.items.length, 9); assert.equal(b.items.length, 13); assert.deepEqual(b.shifts, ['日', '中']);
    assert.deepEqual(a.items.filter(i => i.kind === 'num').map(i => [i.no, i.lower, i.upper]), [['1', 5, 7], ['8', 7, 12]]);
    assert.deepEqual(b.items.filter(i => i.kind === 'num').map(i => [i.no, i.lower, i.upper]), [['9', 4, 5]]);
    assert.equal(a.items[8].kind, 'sign');
    assert.ok([...a.items, ...b.items].every(i => /[一-鿿]/.test(i.zh) && /[가-힣]/.test(i.ko)));
  });
  test('칸 표시 정리: √·v·o·无 → ✓, x·NG·有 → ×, 숫자는 단위만 떼고 적힌 그대로, 서명은 이름 대신 ✓', () => {
    assert.deepEqual(['√', 'v', 'o', '无', '없음'].map(x => L.normMark(x, 'check')), ['✓', '✓', '✓', '✓', '✓']);
    assert.deepEqual(['x', 'NG', '有'].map(x => L.normMark(x, 'check')), ['×', '×', '×']);
    assert.equal(L.normMark(' 8.3% ', 'num'), '8.3'); assert.equal(L.normMark('6.0MPa', 'num'), '6.0');
    assert.equal(L.normMark('홍길동', 'sign'), '✓'); assert.equal(L.normMark('', 'check'), '');
  });
  test('CNC 예시(사진 9/12): 4일 형식적 기록 의심 · 8일 서명 없음 · 9일 누락 · 10일 유압 7.8 이탈 — 휴무 6일과 사진 찍은 12일은 누락 아님', () => {
    assert.deepEqual(kinds(g1), ['4 formal_suspect', '8 9 missing_sign', '9 missed_day', '10 1 out_of_range']);
  });
  test('호빙기 예시(사진 9/5): 2일 中 압력 5.5 이탈 · 3일 中 누락 · 4일 日 11번 ×', () => {
    assert.deepEqual(kinds(g2), ['2 中 9 out_of_range', '3 中 missed_day', '4 日 11 abnormal']);
  });
  test('관리 범위 경계 포함: 7.0 은 정상, 7.01 은 이탈 / 설비별 범위를 고치면 그 값으로', () => {
    const g = JSON.parse(JSON.stringify(g1));
    g.cells['1|10|'] = '7.0'; assert.ok(!kinds(g).includes('10 1 out_of_range'));
    g.cells['1|10|'] = '7.01'; assert.ok(kinds(g).includes('10 1 out_of_range'));
    g.ranges = { '1': { lower: '5', upper: '8' } }; assert.ok(!kinds(g).includes('10 1 out_of_range'));
    g.cells['8|11|'] = '6.9'; assert.ok(kinds(g).includes('11 8 out_of_range'));
  });
  test('휴무로 표시하면 누락 아님, 일부만 빈칸이면 「일부 항목 빈칸」, 숫자 칸에 ✓ 면 숫자 아님', () => {
    const g = JSON.parse(JSON.stringify(g1));
    g.off_days = [6, 9]; assert.ok(!kinds(g).some(k => k.endsWith('missed_day')));
    delete g.cells['3|7|']; assert.ok(kinds(g).includes('7 3 blank_cell'));
    g.cells['8|7|'] = '✓'; assert.ok(kinds(g).includes('7 8 invalid_value'));
  });
  test('사진 찍은 날 뒤에 적힌 기록은 확인 필요, 다음 달에 찍은 사진이면 말일까지 전부 누락 검사', () => {
    const g = JSON.parse(JSON.stringify(g1));
    g.cells['2|20|'] = '✓'; assert.ok(kinds(g).includes('20 after_photo'));
    const h = JSON.parse(JSON.stringify(g1)); h.photo_date = '2026-10-02';
    assert.equal(L.gridChecks(h, {}).filter(c => c.kind === 'missed_day').length, 1 + (30 - 11)); // 9일 + 12~30일
  });
  test('보전인(머리칸) 빈칸이면 호빙기 양식은 서명 누락 1건', () => {
    const g = JSON.parse(JSON.stringify(g2)); g.keeper = '';
    assert.equal(L.gridChecks(g, {}).filter(c => c.kind === 'missing_sign' && c.day === '').length, 1);
  });
  test('형식적 기록 의심: 기준 칸 수(3)부터, 숫자가 하나라도 다르거나 × 가 있으면 아님, 0 이면 끔', () => {
    const g = JSON.parse(JSON.stringify(g1));
    assert.equal(L.gridChecks(g, { formal_run: 2 }).filter(c => c.kind === 'formal_suspect').length, 2); // 3일·4일
    assert.equal(L.gridChecks(g, { formal_run: 0 }).filter(c => c.kind === 'formal_suspect').length, 0);
    g.cells['8|3|'] = '8.4'; assert.ok(!kinds(g).some(k => k.endsWith('formal_suspect')));
    const h = JSON.parse(JSON.stringify(g1)); h.cells['1|3|'] = '6'; // 6 과 6.0 은 같은 숫자
    assert.ok(kinds(h).includes('4 formal_suspect'));
  });
  test('AI 요청문: 중국어 양식을 읽는다고 밝히고, 항목 원문·교대·JSON 격자 형식·이름 금지가 들어감', () => {
    const p = L.aiPromptGrid(g2);
    assert.ok(p.includes('중국어')); assert.ok(p.includes('总系统压力')); assert.ok(p.includes('日·中'));
    assert.ok(p.includes('"cells"')); assert.ok(p.includes('이름')); assert.ok(p.includes('해 줘'));
  });
  test('AI 답(격자 JSON) → 칸 채우기: 없는 항목·범위 밖 날짜·빈 표시는 건너뛰고, 불확실 칸은 따로', () => {
    const g = L.newGrid({ template: 'hob_daily', vendor: 'V', equip: 'E', month: '2026-09', photo_date: '2026-09-03' });
    const ans = L.parseAiJson('```json\n{"cells":[{"item":"9","day":1,"shift":"日","mark":"4.5"},{"item":"1","day":1,"shift":"中","mark":"√","unsure":true},{"item":"99","day":1,"shift":"日","mark":"✓"},{"item":"2","day":20,"shift":"日","mark":"✓"},{"item":"3","day":2,"shift":"日","mark":""}],"abnormal_note":""}\n```');
    const r = L.applyAiCells(g, ans.rows);
    assert.deepEqual([r.filled, r.skipped], [2, 3]); assert.deepEqual(r.unsure, ['1|1|中']);
    assert.equal(g.cells['9|1|日'], '4.5'); assert.equal(g.cells['1|1|中'], '✓');
  });
  test('새 점검표: 9월 CNC 는 1~30일, 호빙기는 1~16일 × 2교대 = 32칸', () => {
    const a = L.newGrid({ template: 'cnc_monthly', month: '2026-09' }), b = L.newGrid({ template: 'hob_daily', month: '2026-09' });
    assert.equal(L.gridSlots(a, L.sheetTemplate(a.template)).length, 30); assert.equal(L.gridSlots(b, L.sheetTemplate(b.template)).length, 32);
    assert.equal(L.daysInMonth('2028-02'), 29);
  });
  test('엑셀 백업 왕복: 점검표 2장·칸·휴무·범위가 그대로, 검사 결과 동일', () => {
    const db = Sample.build(); db.daily.grids[0].ranges = { '1': { lower: '5', upper: '7.5' } };
    const back = L.sheetsToDb(L.dbToSheets(db), db);
    assert.equal(back.daily.grids.length, 2);
    back.daily.grids.forEach((g, i) => assert.deepEqual(kinds(g), kinds(db.daily.grids[i])));
    assert.deepEqual(back.daily.grids[0].off_days, [6]); assert.equal(back.daily.grids[1].cells['9|2|中'], '5.5');
  });
}

console.log('예시 파일로 짝 제안 끝까지 (samples/)');
{
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = new URL('../samples/', import.meta.url);
  const spec = Sample.build().inspections[0].spec;
  const expectNos = ['1', '2', '3', '4', '5', '6', '10'];
  test('번호 없는 CMM CSV → 열 지정 → 짝 제안 = 1·2·3·4·5·6·10번 (구멍 4·5 는 순서 짝, 보통)', () => {
    const rows = L.parseDelimited(fs.readFileSync(fileURLToPath(new URL('예시데이터_CMM결과_번호없음.csv', dir)), 'utf8'));
    const hr = L.guessHeaderRow(rows);
    const meas = L.applyMapping(rows, hr, L.guessMapping(rows[hr], 'meas'), 'meas').map(m => Object.assign(m, { source: 'CMM' }));
    const r = L.suggestMatches({ spec, meas }, {});
    assert.deepEqual(r.map(x => x.no), expectNos);
    assert.deepEqual(r.map(x => x.level), ['high', 'high', 'high', 'mid', 'mid', 'high', 'high']);
    const insp = { spec, meas }; L.applyMatches(insp, r.map(x => ({ meas: x.meas, no: x.no })));
    const e = L.evaluate(insp, {});
    assert.deepEqual([e.counts.OK, e.counts.NOK, e.extra.length], [5, 2, 0]); // 2번 폭 40.13·5번 구멍 7.98 NOK, 나머지 기준 5개는 측정 없음
  });
  test('PDF 복사 글자(P1… 장비 번호) → 칸 나누기 → 같은 짝 제안', () => {
    const rows = L.textToRows(fs.readFileSync(fileURLToPath(new URL('예시데이터_CMM_PDF복사본.txt', dir)), 'utf8'));
    const hr = rows.findIndex(r => r[0] === 'Point');
    const meas = L.applyMapping(rows, hr, L.guessMapping(rows[hr], 'meas'), 'meas').map(m => Object.assign(m, { source: 'CMM' }));
    assert.equal(meas[3].name, 'HOLE DIA');
    assert.deepEqual(L.suggestMatches({ spec, meas }, {}).map(x => x.no), expectNos);
  });
}

console.log('폐쇄망 — 외부로 나가는 요청 코드 검사');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = ['index.html', 'css/style.css', 'vendor/xlsx.full.min.js'].concat(fs.readdirSync(path.join(root, 'js')).map(f => 'js/' + f));
  // 네트워크로 나가는 브라우저 API·외부 자원 불러오기
  const NET = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|sendBeacon|importScripts|<script[^>]+src=["']?https?:|<link[^>]+href=["']?https?:|@import|url\(\s*["']?https?:|\.src\s*=\s*["']https?:/g;
  const hits = [];
  files.forEach(f => {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    let m; NET.lastIndex = 0;
    while ((m = NET.exec(t))) hits.push(f + ': ' + m[0]);
  });
  test('네트워크 요청 코드는 js/ai.js 의 fetch 한 곳뿐(AI 읽기, 폐쇄망 모드에서 막힘)', () => {
    assert.deepEqual(hits, ['js/ai.js: fetch(']);
  });
  test('ai.js 는 폐쇄망 모드가 꺼져 있을 때만 요청(가드 문구 존재)', () => {
    const t = fs.readFileSync(path.join(root, 'js/ai.js'), 'utf8');
    assert.ok(/if\s*\(\s*opts\.offline\s*!==\s*false\s*\)/.test(t));
  });
  test('기본 설정은 폐쇄망 모드 켬', () => assert.equal(L.emptyDb().settings.offline_mode, true));
}

console.log(process.exitCode ? '\n실패 있음' : '\n전부 통과 ' + passed + '건');
