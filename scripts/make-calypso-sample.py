# 예시 CMM PDF 성적서 만들기 (가상 데이터 — 실제 부품·회사·사람 아님)
#   python3 scripts/make-calypso-sample.py    (reportlab 필요: pip install reportlab)
# ZEISS CALYPSO 성적서의 칸 배치(Name | Measured value | Nominal value | 상한공차 | 하한공차 | 편차 | +/-)를
# 흉내 내 「CMM PDF 바로 읽기」를 시험하는 용도입니다. 각도 줄 1, 공차 없는 줄 1, 불합격 2(red 2), 2쪽·구역 제목 포함.
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_CANDIDATES = [
    os.path.expanduser('~/Library/Fonts/NanumGothicCoding.ttf'),
    '/Library/Fonts/NanumGothicCoding.ttf',
    '/usr/share/fonts/truetype/nanum/NanumGothicCoding.ttf',
    'C:/Windows/Fonts/NanumGothicCoding.ttf',
]
font = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)
if not font:
    sys.exit('한글 TTF 글꼴(NanumGothicCoding.ttf, OFL)을 찾지 못했습니다.')
pdfmetrics.registerFont(TTFont('KR', font))

W, H = A4
# 칸 오른쪽 끝(pt) — 실제 성적서처럼 숫자는 오른쪽 정렬
COL_R = {'measured': 272, 'nominal': 323, 'upper': 374, 'lower': 425, 'dev': 473, 'exceed': 564}
HEAD = [('Name', 50.5), ('Measured value', 196.4), ('Nominal value', 266.9), ('상한공차', 335.4), ('하한공차', 386.4), ('편차', 469.9), ('+/-', 502)]

ROWS1 = [
    # 이름, 측정값, 기준값, 상한, 하한, 편차, +/-(이탈량, 불합격만)
    ('외경_A', '49.962 mm', '50.000', '-0.025', '-0.050', '-0.038', ''),
    ('동심도_A', '0.012 mm', '0.000', '0.050', '0.000', '0.012', ''),
    ('캘리퍼 거리1_Z', '119.874 mm', '120.000', '0.000', '-0.200', '-0.126', ''),
    ('원1_직경', '32.031 mm', '32.000', '0.025', '0.000', '0.031', '0.006'),
    ('원통도1', '0.004 mm', '0.000', '0.010', '0.000', '0.004', ''),
    ('원추 반각1', '5° 8\' 20"', '5° 0\' 0"', '0° 15\' 0"', '-0° 15\' 0"', '0° 8\' 20"', ''),
    ('원2_직경', '20.041 mm', '20.000', '', '', '0.041', ''),
    ('위치도1', '0.137 mm', '0.000', '0.100', '0.000', '0.137', '0.037'),
]
ROWS2 = [
    ('원3_직경', '39.982 mm', '40.000', '-0.009', '-0.025', '-0.018', ''),
    ('평면도1', '0.008 mm', '0.000', '0.020', '0.000', '0.008', ''),
]

def y(top):  # 위에서 잰 거리 → PDF 좌표
    return H - top

def header_block(c):
    c.setFont('KR', 14); c.drawString(82, y(61), 'ZEISS CALYPSO (예시)')
    c.setFont('KR', 8); c.drawString(82, y(71), '7.4 예시 양식')
    c.setFont('KR', 9)
    left = [('Part name', '999999-00001'), ('Drawing number', ''), ('Order number', ''), ('Variant', ''), ('Company', ''), ('Department', ''),
            ('CMM 타입', 'DEMO_CMM'), ('CMM No.', '000000'), ('Operator', 'Demo'), ('Text', '')]
    right = [('Part ident', '1'), ('Time/Date', '2026-09-29 오전 9:00'), ('Run', '모든 특성 측정'), ('No. measured values', '10'),
             ('No. values: red', '2'), ('측정 시간', '00:00:01.0')]
    for i, (k, v) in enumerate(left):
        c.drawString(36.9, y(106 + i * 12.1), k)
        if v: c.drawString(140.4, y(106 + i * 12.1), v)
    for i, (k, v) in enumerate(right):
        c.drawString(323.5, y(154.5 + i * 12.1), k)
        c.drawString(462.2, y(154.5 + i * 12.1), v)

def table_head(c, top):
    c.setFont('KR', 9)
    for t, x in HEAD:
        c.drawString(x, y(top), t)

def rows(c, top, data):
    for r in data:
        c.drawString(50.5, y(top), r[0])
        for key, val in zip(['measured', 'nominal', 'upper', 'lower', 'dev', 'exceed'], r[1:]):
            if val: c.drawRightString(COL_R[key], y(top), val)
        top += 22.7
    return top

out = os.path.join(os.path.dirname(__file__), '..', 'samples', '예시데이터_CMM성적서_CALYPSO형식.pdf')
c = canvas.Canvas(out, pagesize=A4, invariant=1)
c.setTitle('예시 데이터 - 가상 CMM 성적서'); c.setAuthor('예시')
header_block(c)
table_head(c, 244.4)
top = rows(c, 263.3, ROWS1)
c.setFont('KR', 9); c.drawString(31.2, y(top + 20), 'Text'); c.drawString(265.3, y(top + 22), 'Event')
c.drawString(16.5, y(817), '(예시) StandardProtocol'); c.drawString(272, y(836.8), 'Page 1 of 2')
c.showPage()
c.setFont('KR', 9)
for i, (k, v) in enumerate([('Part name', '999999-00001'), ('Order number', ''), ('Part ident', '1'), ('Operator', 'Demo'), ('Time/Date', '2026-09-29 오전 9:00')]):
    c.drawString(289.1, y(37 + i * 11.5), k)
    if v: c.drawString(364.6, y(37 + i * 11.5), v)
table_head(c, 111.4)
c.drawString(28.3, y(132), 'Section View B-B')
rows(c, 153, ROWS2)
c.drawString(31.2, y(260), 'Text'); c.drawString(265.3, y(262), 'Event')
c.drawString(272, y(836.8), 'Page 2 of 2')
c.showPage(); c.save()
print(os.path.normpath(out))
