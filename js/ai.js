/*
 * 사진 「AI 읽기」 — 이 도구에서 밖으로 요청을 보내는 유일한 곳입니다.
 *
 * - 폐쇄망 모드(설정 기본값 켬)에서는 부르지 않고, 불러도 여기서 막습니다(요청을 만들지도 않습니다).
 * - 보내는 곳은 사용자가 「설정·데이터」에 적은 **OpenAI 호환 주소**입니다(2026-09-29 수강생 질문 — 과제 B 를 다른 AI 로 돌려도 되는지).
 *   비워 두면 OpenAI(https://api.openai.com/v1). OpenAI 호환 주소를 제공하는 서비스나 사내 설치형 LLM 서버의 주소를 넣으면 그쪽으로 보냅니다.
 *   어느 서비스를 써도 되는지는 회사 보안 부서가 정할 일이며, 이 코드는 특정 서비스를 권하지 않습니다.
 * - API 키는 이 브라우저 저장소에만 두고 코드·리포에는 넣지 않습니다(공개 리포). 키가 필요 없는 사내 서버면 비워 둡니다.
 * - 보안 요구가 없는 협력사 점검표(과제 B)·연습용 사진에 쓰십시오. 도면·사내 측정표 사진에는 쓰지 마십시오.
 * - 브라우저에서는 window.QCAI, Node(테스트)에서는 module.exports 로 씁니다.
 */
(function (root) {
  'use strict';
  var DEFAULT_BASE = 'https://api.openai.com/v1';
  var DEFAULT_MODEL = 'gpt-4o-mini';
  var ENDPOINT = DEFAULT_BASE + '/chat/completions';

  // 설정의 주소 → 실제로 부를 chat/completions 주소. 잘못된 주소면 { error }.
  //   ''                                  → https://api.openai.com/v1/chat/completions
  //   https://llm.example.local/v1/        → https://llm.example.local/v1/chat/completions
  //   https://x.example/v1/chat/completions → 그대로
  function resolveEndpoint(base) {
    var b = String(base == null ? '' : base).trim();
    if (!b) return { url: ENDPOINT, isDefault: true };
    if (!/^https?:\/\/[^\s\/?#]+/i.test(b)) return { error: '주소는 http:// 또는 https:// 로 시작해야 합니다.' };
    if (/[?#\s]/.test(b)) return { error: '주소에 ?·#·띄어쓰기를 넣지 마십시오. 서비스 안내의 기본 주소(base URL)만 적습니다.' };
    b = b.replace(/\/+$/, '');
    var url = /\/chat\/completions$/i.test(b) ? b : b + '/chat/completions';
    return { url: url, isDefault: url === ENDPOINT, insecure: /^http:/i.test(url) };
  }

  // 요청 만들기(보내지 않음) — 테스트가 이 결과를 봅니다.
  // opts: { offline, baseUrl, key, model, prompt, dataUrl } → { url, init } 또는 예외
  function buildRequest(opts) {
    if (opts.offline !== false) throw new Error('폐쇄망 모드가 켜져 있어 보내지 않았습니다.');
    var ep = resolveEndpoint(opts.baseUrl);
    if (ep.error) throw new Error(ep.error);
    var key = String(opts.key || '').trim();
    var model = String(opts.model || '').trim();
    // OpenAI 기본 주소는 키가 꼭 필요합니다. 다른 주소는 키 없이 받는 사내 서버가 있어 비워 둘 수 있습니다.
    if (ep.isDefault && !key) throw new Error('API 키를 「설정·데이터」에 넣어 주십시오.');
    if (!model) {
      if (!ep.isDefault) throw new Error('다른 AI 주소를 쓸 때는 모델 이름을 「설정·데이터」에 적어 주십시오(서비스 안내에 있는 이름).');
      model = DEFAULT_MODEL;
    }
    if (!/^data:image\//.test(String(opts.dataUrl || ''))) throw new Error('사진이 없습니다.');
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    var body = {
      model: model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt },
          { type: 'image_url', image_url: { url: opts.dataUrl, detail: 'high' } }
        ]
      }]
    };
    return { url: ep.url, init: { method: 'POST', headers: headers, body: JSON.stringify(body) } };
  }

  // 답 JSON → 글자. OpenAI 호환 형식(choices[0].message.content). 내용이 조각 배열로 오는 서비스도 받습니다.
  function answerText(j) {
    var c = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    if (Array.isArray(c)) return c.map(function (p) { return p && typeof p.text === 'string' ? p.text : ''; }).join('');
    return c || '';
  }

  // opts: buildRequest 와 같음 → Promise(답 글자)
  function readPhoto(opts) {
    var req;
    try { req = buildRequest(opts); } catch (e) { return Promise.reject(e); }
    return fetch(req.url, req.init).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + res.status));
        return answerText(j);
      });
    });
  }

  var api = { readPhoto: readPhoto, buildRequest: buildRequest, resolveEndpoint: resolveEndpoint, answerText: answerText,
    ENDPOINT: ENDPOINT, DEFAULT_BASE: DEFAULT_BASE, DEFAULT_MODEL: DEFAULT_MODEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCAI = api;
})(typeof window !== 'undefined' ? window : this);
