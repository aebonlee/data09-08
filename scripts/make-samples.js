// 예시 파일 만들기: node scripts/make-samples.js
// samples/ 의 파일은 모두 가상 데이터입니다(js/sample-data.js 와 같은 값).
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const Sample = require('../js/sample-data.js');
const L = require('../js/logic.js');
const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const csv = rows => L.toCsv(rows);

// 치수 기준표: 공차를 한 칸(±) 표기와 상·하한 두 칸 표기를 섞지 않고, 실제 양식이 두 가지일 수 있어 둘 다 만듭니다.
const specHead = ['항목번호', '항목명', '치수 종류', '기준값', '상한공차', '하한공차', '단위', '소수점 자리수'];
const specRows = [['예시 데이터 - 가상 부품 EX-BRKT-100 치수 기준표 (실제 도면 아님)'], specHead].concat(Sample.SPEC.map(r => r.slice()));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(specRows), '치수기준표');
const tolText = r => (r[4] === -r[5] ? '±' + r[4] : '+' + r[4] + '/' + (r[5] === 0 ? '0' : r[5]));
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['예시 데이터 - 공차 한 칸 표기 형식'], ['No', '항목명', '기준값', '공차', '단위']].concat(Sample.SPEC.map(r => [r[0], r[1], r[3], tolText(r), r[6]]))), '공차한칸표기');
fs.writeFileSync(path.join(out, '예시데이터_치수기준표.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

fs.writeFileSync(path.join(out, '예시데이터_CMM결과.csv'), csv(Sample.CMM_ROWS));
fs.writeFileSync(path.join(out, '예시데이터_CMM결과_번호없음.csv'), csv(Sample.CMM_NONUM));
// PDF 성적서에서 표를 드래그해 복사하면 나오는 글자 모양(공백 구분). 측정번호 P1… 은 장비 번호라 도면 번호와 다릅니다 — 「PDF 성적서 글자 붙여넣기」·짝 제안 시연용
fs.writeFileSync(path.join(out, '예시데이터_CMM_PDF복사본.txt'), ['예시 데이터 - PDF 성적서에서 복사한 글자를 흉내 낸 가상 파일', 'Point Feature Nominal +Tol -Tol Actual']
  .concat(Sample.CMM_NONUM.slice(2).map((r, i) => ['P' + (i + 1), r[0].replace(/_/g, ' '), r[1].toFixed(3), r[2].toFixed(3), r[3].toFixed(3), r[4].toFixed(3)].join(' '))).join('\n') + '\n');
fs.writeFileSync(path.join(out, '예시데이터_수기측정.csv'), csv([['항목번호', '항목명', '측정값', '단위']].concat(Sample.MANUAL)));
fs.writeFileSync(path.join(out, '예시데이터_도면.svg'), Sample.drawingSvg());
fs.writeFileSync(path.join(out, '예시데이터_설비목록.csv'), csv([['협력사', '설비', '순서']].concat(Sample.EQUIP)));
fs.writeFileSync(path.join(out, '예시데이터_일일점검.csv'), csv([['협력사', '점검일', '설비', '점검항목', '판정', '측정값', '원본사진']].concat(
  Sample.dailyRecords().map(r => [r.vendor, r.date, r.equip, r.item, r.result, r.value, r.photo]))));
fs.writeFileSync(path.join(out, '예시데이터_점검기준값.csv'), csv([['점검항목', '하한', '상한']].concat(Sample.LIMITS)));
// ── 2026-09-29 메일 자료(과제 A) 예시 — 모두 가상 값 ─────────────────────
// 측정실 성적서(보어별 내경 + 진원도·원통도·진직도) 모양을 흉내 낸 가상 부품. 불합격 3칸 + 항목명 오기 1곳(H4 마지막 줄)
(function () {
  const STD = 'Ø20.000\n[+0.006/0]';
  const bores = [
    // 보어, 앞 위치 5곳 내경, 진원도 / 뒤 위치 3곳 내경, 진원도, 원통도, 진직도(마지막 줄 항목명)
    ['H1', [20.0021, 20.0025, 20.0031, 20.0028, 20.0024], [0.0021, 0.0025, 0.0022, 0.0030, 0.0026], [20.0030, 20.0027, 20.0022], [0.0024, 0.0028, 0.0023], 0.0061, 0.0030, '진직도'],
    ['H2', [20.0018, 20.0026, 20.0033, 20.0029, 20.0022], [0.0027, 0.0024, 0.0031, 0.0028, 0.0022], [20.0029, 20.0024, 20.0019], [0.0026, 0.0021, 0.0025], 0.0095, 0.0033, '진직도'],
    ['H3', [20.0023, 20.0028, 20.0035, 20.0031, 20.0026], [0.0025, 0.0045, 0.0029, 0.0026, 0.0024], [20.0032, 20.0028, 20.0021], [0.0023, 0.0027, 0.0022], 0.0072, 0.0029, '진직도'],
    ['H4', [20.0025, 20.0030, 20.0068, 20.0033, 20.0027], [0.0022, 0.0026, 0.0028, 0.0024, 0.0023], [20.0031, 20.0026, 20.0020], [0.0025, 0.0022, 0.0026], 0.0068, 0.0031, '진원도']
  ];
  const sheets = [[0, 1], [2, 3]];
  const wb = XLSX.utils.book_new();
  sheets.forEach((idx, si) => {
    const rows = [[], ['', '의 뢰 부 서', '', '예시 품질팀(가상)', '', '접 수 번 호', '', 'EX-0001(' + (si + 1) + '/2)'],
      ['', '품        명', '', 'Housing 예시 EX-HSG-200', '', '도 면 번 호', '', '-'], [], ['', ' ', '', '', '측   정   결   과'],
      ['', '구분', '항 목', '측정위치', '측정값 ', '', '', '', '(단위: ㎜)']];
    idx.forEach((bi, k) => {
      const b = bores[bi];
      rows.push(['', '', '', k === 0 ? '표준치' : '측정위치 ⇒', 10, 30.5, 55, 80.5, 105]);
      rows.push(['', b[0], '내경', STD].concat(b[1]));
      rows.push(['', '', '진원도', 0.004].concat(b[2]));
      rows.push(['', '', '', '측정위치 ⇒', 130, 155.5, 180]);
      rows.push(['', b[0], '내경', STD].concat(b[3]));
      rows.push(['', '', '진원도', 0.004].concat(b[4]));
      rows.push(['', '', '원통도', 0.008, b[5]]);
      rows.push(['', '', b[7], 0.004, b[6]]);
    });
    rows.push([], ['', '', '의    견'], ['', '예시 양식(가상) — 실제 양식 번호·회사명 아님']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), String(si + 1));
  });
  fs.writeFileSync(path.join(out, '예시데이터_측정실성적서_보어.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
})();

// 예시 도면: samples/예시데이터_CMM성적서_CALYPSO형식.pdf 의 기준값과 같은 치수를 적은 가상 부품 도면(번호 풍선 없음)
fs.writeFileSync(path.join(out, '예시데이터_도면_번호없음.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" font-family="sans-serif">
<rect width="1200" height="800" fill="#fff"/>
<text x="30" y="40" font-size="20" fill="#555">예시 데이터 — 가상 부품 999999-00001 (실제 도면 아님, 번호 풍선 없음)</text>
<g fill="none" stroke="#222" stroke-width="3">
  <rect x="300" y="200" width="520" height="360"/>
  <line x1="300" y1="380" x2="820" y2="380" stroke-dasharray="20 8" stroke-width="1.5"/>
  <circle cx="560" cy="380" r="70"/><circle cx="700" cy="300" r="45"/><circle cx="420" cy="470" r="30"/>
  <path d="M820 230 L940 260 L940 500 L820 530"/>
</g>
<g font-size="22" fill="#000">
  <text x="440" y="180">Ø50 -0.025/-0.050</text>
  <text x="850" y="170">◎ Ø0.05 A</text>
  <text x="480" y="620">120 0/-0.2</text>
  <text x="600" y="420">Ø32 +0.025/0</text>
  <text x="170" y="300">⌭ 0.01</text>
  <text x="960" y="390">5° ±15'</text>
  <text x="740" y="260">Ø20</text>
  <text x="330" y="520">⌖ Ø0.1 A B</text>
  <text x="330" y="690">Ø40 g6</text>
  <text x="860" y="620">⏥ 0.02</text>
</g>
<g fill="none" stroke="#333" stroke-width="1.5">
  <line x1="300" y1="190" x2="820" y2="190"/><line x1="300" y1="600" x2="940" y2="600"/>
</g>
</svg>
`);
console.log(fs.readdirSync(out).join('\n'));
