/*
 * 사진 「AI 읽기」 — 이 도구에서 밖으로 요청을 보내는 유일한 곳입니다.
 *
 * - 폐쇄망 모드(설정 기본값 켬)에서는 부르지 않고, 불러도 여기서 막습니다.
 * - 사용자가 자기 OpenAI API 키를 넣었을 때만 브라우저에서 api.openai.com 으로 사진 한 장과 요청문을 보냅니다.
 *   키는 이 브라우저 저장소에만 두고 코드·리포에는 넣지 않습니다(공개 리포).
 * - 보안 요구가 없는 협력사 점검표(과제 B)·연습용 사진에 쓰십시오. 도면·사내 측정표 사진에는 쓰지 마십시오.
 * - index.html 의 Content-Security-Policy(connect-src) 도 api.openai.com 밖으로의 연결을 막습니다.
 */
(function (root) {
  'use strict';
  var ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  // opts: { offline, key, model, prompt, dataUrl } → Promise(답 글자)
  function readPhoto(opts) {
    if (opts.offline !== false) return Promise.reject(new Error('폐쇄망 모드가 켜져 있어 보내지 않았습니다.'));
    if (!opts.key) return Promise.reject(new Error('OpenAI API 키를 「설정·데이터」에 넣어 주십시오.'));
    var body = {
      model: opts.model || 'gpt-4o-mini',
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt },
          { type: 'image_url', image_url: { url: opts.dataUrl, detail: 'high' } }
        ]
      }]
    };
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.key },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + res.status));
        return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';
      });
    });
  }

  root.QCAI = { readPhoto: readPhoto, ENDPOINT: ENDPOINT };
})(window);
