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
console.log(fs.readdirSync(out).join('\n'));
