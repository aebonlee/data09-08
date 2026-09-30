/*
 * 표지 그림 움직임 (2026-09-30 수강생 요청)
 *   탐침이 부품 세 곳을 찍고 → 잰 값이 AI 칩을 거쳐 판정표 칸으로 들어가 판정이 붙습니다.
 *   시간 막대(자동 매칭·판정)는 처음 보일 때 한 번만 줄어듭니다.
 *
 *   - 움직임 줄이기(prefers-reduced-motion) 설정이면 움직이지 않고 마지막 모습(세 칸 모두 판정)으로 둡니다.
 *   - 탭이 가려지거나 표지가 숨겨지면(다른 메뉴) 멈추고, 돌아오면 멈춘 자리에서 이어 갑니다.
 *   - 그림 크기는 viewBox 로 정해져 있고 움직임은 transform·글자만 바꾸므로 레이아웃이 밀리지 않습니다.
 *   - 외부로 나가는 요청 없음.
 * app.js 가 화면을 바꿀 때 QCCover.setVisible(표지 보일지) 를 부릅니다.
 */
(function () {
  'use strict';
  var root = document.getElementById('cover');
  if (!root) { window.QCCover = { setVisible: function () {} }; return; }
  function $(id) { return document.getElementById(id); }
  var carriage = $('cvCarriage'), ram = $('cvRam'), pulse = $('cvPulse'), token = $('cvToken'), tokenText = $('cvTokenText');
  var pathIn = $('cvPathIn'), pathOut = $('cvPathOut'), halo = $('cvHalo');
  var timeBox = root.querySelector('.cover-time');
  var start = $('coverStart');

  // 탐침이 찍는 세 곳(그림 좌표)과 판정표에 들어갈 값 — 가상 값
  var POINTS = [
    { x: 155, y: 206, v: '25.02', cell: [514, 142] },
    { x: 108, y: 226, v: '12.01', cell: [514, 172] },
    { x: 202, y: 226, v: '12.14', cell: [514, 202] }
  ];
  var BALL_BOTTOM = 180;          // 램이 올라가 있을 때 탐침 공 아래 끝
  var HOME_X = 155;
  var STEP = 2600, HOLD = 2400, CYCLE = STEP * POINTS.length + HOLD;
  var vals = POINTS.map(function (_, i) { return $('cvV' + i); });
  var judges = POINTS.map(function (_, i) { return $('cvJ' + i); });
  var lenIn = 0, lenOut = 0;          // 표지가 처음 보일 때 잽니다(숨긴 채로는 재지 않음)
  function measure() { if (!lenIn) { lenIn = pathIn.getTotalLength(); lenOut = pathOut.getTotalLength(); } }

  function ease(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function seg(t, a, b) { return (t - a) / (b - a); }

  function setCells(n) {
    for (var i = 0; i < POINTS.length; i++) {
      var on = i < n;
      if (vals[i].textContent !== (on ? POINTS[i].v : '')) vals[i].textContent = on ? POINTS[i].v : '';
      judges[i].setAttribute('opacity', on ? '1' : '0');
    }
  }
  function place(x, d) {
    carriage.setAttribute('transform', 'translate(' + x.toFixed(1) + ' 0)');
    ram.setAttribute('transform', 'translate(0 ' + d.toFixed(1) + ')');
  }

  // 한 바퀴 안의 시각 t(ms) → 그림 상태. 같은 t 면 언제나 같은 모습입니다.
  function draw(t) {
    var i = Math.min(Math.floor(t / STEP), POINTS.length);
    halo.setAttribute('transform', 'rotate(' + (t / 40 % 360).toFixed(1) + ' 350 180)');
    if (i >= POINTS.length) {           // 다 채우고 잠시 멈춤
      var last = POINTS[POINTS.length - 1];
      place(last.x, 0); setCells(POINTS.length);
      pulse.setAttribute('opacity', '0'); token.setAttribute('opacity', '0');
      return;
    }
    var p = POINTS[i], prevX = i === 0 ? POINTS[POINTS.length - 1].x : POINTS[i - 1].x;
    var s = t - i * STEP, depth = p.y - BALL_BOTTOM, x, d;
    if (s < 700) { x = lerp(prevX, p.x, ease(s / 700)); d = 0; }
    else if (s < 1100) { x = p.x; d = depth * ease(seg(s, 700, 1100)); }
    else if (s < 1250) { x = p.x; d = depth; }
    else if (s < 1650) { x = p.x; d = depth * (1 - ease(seg(s, 1250, 1650))); }
    else { x = p.x; d = 0; }
    place(x, d);
    // 닿은 자리 물결
    if (s >= 1100 && s < 1700) {
      var k = seg(s, 1100, 1700);
      pulse.setAttribute('cx', p.x); pulse.setAttribute('cy', p.y);
      pulse.setAttribute('r', (4 + 14 * k).toFixed(1)); pulse.setAttribute('opacity', (0.9 * (1 - k)).toFixed(2));
    } else pulse.setAttribute('opacity', '0');
    // 잰 값이 AI 를 거쳐 판정표로
    if (s >= 1250 && s < 2450) {
      measure();
      var q = seg(s, 1250, 2450), pt;
      if (q < .45) pt = pathIn.getPointAtLength(lenIn * ease(q / .45));
      else if (q < .75) pt = pathOut.getPointAtLength(lenOut * ease(seg(q, .45, .75)));
      else { var e = pathOut.getPointAtLength(lenOut), r = ease(seg(q, .75, 1)); pt = { x: lerp(e.x, p.cell[0], r), y: lerp(e.y, p.cell[1], r) }; }
      if (tokenText.textContent !== p.v) tokenText.textContent = p.v;
      token.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ')');
      token.setAttribute('opacity', q > .92 ? ((1 - q) / .08).toFixed(2) : '1');
    } else token.setAttribute('opacity', '0');
    setCells(s >= 2450 ? i + 1 : i);
  }
  function drawFinal() {                 // 움직임 줄이기: 세 칸 모두 판정된 마지막 모습
    var last = POINTS[POINTS.length - 1];
    place(last.x, 0); setCells(POINTS.length);
    pulse.setAttribute('opacity', '0'); token.setAttribute('opacity', '0');
    halo.removeAttribute('transform');
  }

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var visible = false, raf = 0, last = 0, clock = 0, barDone = false, barTimer = 0;
  function reduced() { return !!mq.matches; }
  function loop(ts) {
    raf = 0;
    if (!last) last = ts;
    clock = (clock + Math.min(ts - last, 100)) % CYCLE;   // 오래 멈췄다 와도 한 번에 건너뛰지 않음
    last = ts;
    draw(clock);
    raf = requestAnimationFrame(loop);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
  function update() {
    if (!visible || document.hidden || reduced()) {
      stop();
      if (reduced()) drawFinal();
    } else if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
    // 시간 막대 — 처음 보일 때 한 번
    if (visible && !barDone) {
      if (reduced()) { barDone = true; timeBox.classList.add('is-done'); }
      else if (!document.hidden && !barTimer) barTimer = setTimeout(function () { barTimer = 0; barDone = true; timeBox.classList.add('is-done'); }, 450);
    }
  }
  document.addEventListener('visibilitychange', update);
  if (mq.addEventListener) mq.addEventListener('change', update); else if (mq.addListener) mq.addListener(update);

  // 「검사 건 등록하기」: 표지 아래 등록 양식으로 내려가 품번 칸에 커서를 둡니다.
  if (start) start.addEventListener('click', function (e) {
    var input = document.querySelector('#main input[name="part_no"]');
    if (!input) return;                  // 양식이 없으면 주소(#/cases)로 그대로 이동
    e.preventDefault();
    var form = input.form || input;
    var header = document.querySelector('.site-header');   // 머리가 붙어 있으니 그만큼 덜 내려갑니다
    var top = form.getBoundingClientRect().top + window.pageYOffset - (header ? header.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
  });

  draw(reduced() ? CYCLE - 1 : 0);
  if (reduced()) drawFinal();
  window.QCCover = {
    setVisible: function (on) { visible = !!on; root.hidden = !visible; update(); }
  };
})();
