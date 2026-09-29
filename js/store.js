/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있거나 가득 차면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-08.db';
  var KEY_IMG = 'data09-08.img.';
  var memory = {};
  var ok = true;
  function get(k) {
    if (Object.prototype.hasOwnProperty.call(memory, k)) return memory[k];
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return null; }
  }
  // 저장 실패(용량 초과·차단) 시 메모리에 두고 false 를 돌려줍니다
  function set(k, v) {
    try { root.localStorage.setItem(k, v); delete memory[k]; return true; }
    catch (e) { ok = false; memory[k] = v; return false; }
  }
  function del(k) {
    delete memory[k];
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; }
  }
  function loadDb() {
    var db = root.QCLogic.emptyDb();
    var raw = get(KEY_DB);
    if (!raw) return db;
    try {
      var p = JSON.parse(raw);
      if (Array.isArray(p.inspections)) db.inspections = p.inspections;
      if (p.current) db.current = p.current;
      if (p.settings) Object.keys(db.settings).forEach(function (k) { if (k in p.settings) db.settings[k] = p.settings[k]; });
      if (Array.isArray(p.templates)) db.templates = p.templates;
      if (p.daily) Object.keys(db.daily).forEach(function (k) { if (k in p.daily) db.daily[k] = p.daily[k]; });
      if (p._sample) db._sample = true;
    } catch (e) { /* 깨진 값은 무시하고 빈 DB */ }
    return db;
  }
  function clearAll() {
    Object.keys(memory).forEach(function (k) { delete memory[k]; });
    try {
      var keys = [];
      for (var i = 0; i < root.localStorage.length; i++) { var k = root.localStorage.key(i); if (k && k.indexOf('data09-08.') === 0) keys.push(k); }
      keys.forEach(function (k) { root.localStorage.removeItem(k); });
    } catch (e) { ok = false; }
  }
  root.QCStore = {
    loadDb: loadDb,
    saveDb: function (db) { return set(KEY_DB, JSON.stringify(db)); },
    getImage: function (id) { return get(KEY_IMG + id); },
    setImage: function (id, dataUrl) { return set(KEY_IMG + id, dataUrl); },
    delImage: function (id) { del(KEY_IMG + id); },
    // OpenAI API 키 — 이 브라우저에만 둡니다. 엑셀 백업(dbToSheets)에는 들어가지 않습니다.
    getKey: function () { return get('data09-08.openai_key') || ''; },
    setKey: function (v) { if (v) set('data09-08.openai_key', v); else del('data09-08.openai_key'); },
    clearAll: clearAll,
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
