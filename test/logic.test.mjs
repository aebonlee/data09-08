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
test('CMM 머리행 추정: 측정번호·항목명·측정값·단위', () => {
  const m = L.guessMapping(['Point', 'Feature', 'Nominal', 'Actual', 'Unit'], 'meas');
  assert.deepEqual(m, { no: 0, name: 1, value: 3, unit: 4 });
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

console.log(process.exitCode ? '\n실패 있음' : '\n전부 통과 ' + passed + '건');
