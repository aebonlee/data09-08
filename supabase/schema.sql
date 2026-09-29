-- ============================================================================
-- data09-08 — 초도품 치수검사 판정(과제 A) · 협력사 일일점검 현황(과제 B)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-08.db' 한 덩어리 + 도면 이미지
--             'data09-08.img.<검사건id>')에 두는 자료를 DB 로 옮길 때 쓸 표 구조입니다.
--             앱 연결은 다음 단계입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 표 이름에 접두사를 붙이지 않았습니다.
--  회사 Supabase 주소·키는 이 파일 어디에도 없습니다.
--
--  표 목록 (← localStorage 'data09-08.db' 안의 키)
--    app_settings     판정 설정·반복 검사 기준·마지막 검사 건 (사용자당 1행)
--                     ← db.settings, db.daily.repeat_days, db.current
--    import_template  열 지정 템플릿 (장비·양식별)          ← db.templates[]
--    inspection       검사 건 (품번·Rev·LOT·검사일·업체·검사자) ← db.inspections[]
--    dim_spec         치수 기준표                            ← inspections[].spec[]
--    measurement      측정결과 (CMM·수기)                    ← inspections[].meas[]
--    drawing_pin      도면 위 항목 핀 좌표                   ← inspections[].pins{}
--    equipment        협력사 설비 목록                       ← db.daily.equipment[]
--    daily_check      일일점검 데이터                        ← db.daily.records[]
--    check_limit      점검항목 관리 기준값                   ← db.daily.limits[]
--    check_sheet      월간 점검표 격자(날짜×항목×교대, 2026-09-29) ← db.daily.grids[]
--
--  도면 이미지는 표에 넣지 않습니다. 몇 MB 짜리 이미지를 행에 담으면 조회가 무거워지므로
--  앱 연결 단계에서 Supabase Storage(비공개 버킷)에 올리고, inspection.drawing_image_path 에
--  그 경로만 적습니다.
--
--  보안
--    모든 표 RLS 켬. 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--    도구에 로그인·역할 구분과 기록성(로그·이력) 자료가 없어 관리자 표·로그 표를 두지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 설정 — js/logic.js emptyDb().settings + daily.repeat_days + current
create table if not exists public.app_settings (
  id                  bigint generated always as identity primary key,
  owner_id            uuid not null default auth.uid(),
  match_by_name       boolean not null default true,   -- 항목번호가 없으면 항목명으로 매칭
  round_before_judge  boolean not null default false,  -- 판정 전에 소수점 자리수로 반올림
  blank_unit_as_spec  boolean not null default true,   -- 측정 단위가 비면 기준표 단위로 봄
  repeat_days         int check (repeat_days is null or repeat_days >= 2), -- 같은 값 N회 연속이면 확인필요(비우면 검사 안 함)
  current_inspection  text not null default '',        -- 마지막으로 연 검사 건(insp_key)
  offline_mode        boolean not null default true,   -- 폐쇄망 모드(켜면 AI 읽기 숨김). OpenAI 키는 DB 에 두지 않습니다
  ai_model            text not null default 'gpt-4o-mini',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- ⚠ 프런트에서 upsert 할 때 onConflict: 'owner_id'
  constraint app_settings_owner_key unique (owner_id)
);

-- 열 지정 템플릿 — { 필드키: 머리행 이름 }. 앱은 같은 종류·같은 이름이면 덮어씁니다.
create table if not exists public.import_template (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  name        text not null check (length(btrim(name)) > 0),
  kind        text not null check (kind in ('spec', 'meas', 'equip', 'daily', 'limits')),
  cols        jsonb not null default '{}'::jsonb check (jsonb_typeof(cols) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,kind,name'
  constraint import_template_owner_kind_name_key unique (owner_id, kind, name)
);

-- 검사 건
create table if not exists public.inspection (
  id                  bigint generated always as identity primary key,
  owner_id            uuid not null default auth.uid(),
  insp_key            text not null,                     -- 앱 id ('I' + 시각 36진수 + 순번)
  part_no             text not null default '',
  rev                 text not null default '',
  lot                 text not null default '',
  insp_date           date not null default current_date,
  vendor              text not null default '',
  inspector           text not null default '',
  drawing_name        text not null default '',          -- 올린 도면 파일 이름
  drawing_image_path  text not null default '',          -- Storage 경로(앱 연결 단계에서 사용)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint inspection_owner_key_key unique (owner_id, insp_key)
);
create index if not exists inspection_part_idx on public.inspection (owner_id, part_no, rev);

-- 치수 기준표
-- 기준값·공차는 **입력된 글자 그대로** 둡니다(text). 도구는 숫자로 읽지 못한 값을
-- 버리지 않고 「확인필요(기준값이 숫자가 아님)」로 드러내는 것이 설계 의도라,
-- numeric 으로 두면 그런 행을 DB 가 받아 주지 못합니다.
-- 같은 항목번호가 두 번 있으면 도구가 「확인필요(중복)」로 판정하므로 항목번호에 UNIQUE 를
-- 걸지 않고, 화면 순서(line_no)에 겁니다.
create table if not exists public.dim_spec (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  inspection_id  bigint not null references public.inspection(id) on delete cascade,
  line_no        int not null check (line_no >= 1),
  no             text not null check (length(btrim(no)) > 0),   -- 항목번호(풍선 번호)
  name           text not null default '',
  type           text not null default ''
                 check (type in ('', '선형', '직경', '반경', '각도', '깊이', '위치',
                                 '동심도', '원통도', '진원도', '평면도', '위치도', '직각도', '평행도', '흔들림', '대칭도', '진직도')),
  nominal        text not null default '',                       -- 기준값
  tol_upper      text not null default '',                       -- 상한공차(+)
  tol_lower      text not null default '',                       -- 하한공차(-)
  unit           text not null default '',
  decimals       int check (decimals is null or decimals between 0 and 10), -- 소수점 자리수
  fit            text not null default '',                       -- 끼워맞춤 등급(g6·f6·H7 …)
  tol_src        text not null default '',                       -- 공차 출처('ISO 286 g6' = 표에서 채움 — 확인 필요)
  datum          text not null default '',                       -- 형상·위치공차 데이텀(A B)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint dim_spec_insp_line_key unique (inspection_id, line_no)
);

-- 측정결과 — 한 항목에 여러 측정값이 올 수 있습니다(OK·NOK 혼재 시 확인필요).
create table if not exists public.measurement (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  inspection_id  bigint not null references public.inspection(id) on delete cascade,
  line_no        int not null check (line_no >= 1),
  no             text not null default '',                       -- 측정번호(항목번호). 번호 없는 CMM 출력은 빈칸(2026-09-29)
  name           text not null default '',
  value          text not null default '',                       -- 측정값(글자 그대로 — 위 기준값과 같은 이유)
  unit           text not null default '',
  source         text not null default '',                       -- 'CMM' · '수기' · 파일 이름 등
  nominal        text not null default '',                       -- CMM 출력에 있던 기준값(선택) — 번호 없는 측정의 짝 제안에 씀
  tol_upper      text not null default '',
  tol_lower      text not null default '',
  orig_no        text not null default '',                       -- 짝 제안·자동 번호로 바뀌기 전의 원래 측정번호
  matched        text not null default '' check (matched in ('', 'suggest', 'auto_no')),
  photo          text not null default '',                       -- 수기 측정을 옮겨 적은 사진 파일 이름(사진 자체는 저장 안 함)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint measurement_insp_line_key unique (inspection_id, line_no)
);

-- 도면 핀 — 도면 이미지 폭·높이에 대한 비율 좌표(0~1). 항목번호당 1개.
create table if not exists public.drawing_pin (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  inspection_id  bigint not null references public.inspection(id) on delete cascade,
  no             text not null check (length(btrim(no)) > 0),
  x              numeric not null check (x between 0 and 1),
  y              numeric not null check (y between 0 and 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'inspection_id,no'
  constraint drawing_pin_insp_no_key unique (inspection_id, no)
);

-- 협력사 설비 목록 (과제 B)
create table if not exists public.equipment (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  vendor      text not null check (length(btrim(vendor)) > 0),
  equip       text not null check (length(btrim(equip)) > 0),
  "order"     numeric,                                            -- 촬영 순서 (order 는 예약어라 따옴표)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint equipment_owner_vendor_equip_key unique (owner_id, vendor, equip)
);

-- 일일점검 데이터 (과제 B)
-- 앱은 「덧붙이기」로 같은 줄이 두 번 들어갈 수 있습니다. DB 에서는 협력사·점검일·설비·항목을
-- 자연 키로 두어 중복을 막습니다(덧붙이기는 upsert 로 바꿉니다).
create table if not exists public.daily_check (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  vendor      text not null check (length(btrim(vendor)) > 0),
  date        date not null,                                      -- 점검일
  equip       text not null check (length(btrim(equip)) > 0),
  item        text not null check (length(btrim(item)) > 0),     -- 점검항목
  result      text not null default '',                           -- 판정(√ ○ × NG … 빈칸이면 규칙 검사에 걸림)
  value       text not null default '',                           -- 측정값(글자 그대로 — 미기입·숫자 아님을 도구가 검출)
  photo       text not null default '',                           -- 원본 사진 파일 이름
  photo_hash  text not null default '',                           -- 사진 파일 지문(같은 사진 재사용 확인용, 2026-09-29)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,vendor,date,equip,item'
  constraint daily_check_natural_key unique (owner_id, vendor, date, equip, item)
);
create index if not exists daily_check_date_idx on public.daily_check (owner_id, date);

-- 점검항목 관리 기준값 (과제 B)
create table if not exists public.check_limit (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  item        text not null check (length(btrim(item)) > 0),
  lower       numeric,                                            -- 하한(비우면 검사 안 함)
  upper       numeric,                                            -- 상한
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint check_limit_owner_item_key unique (owner_id, item),
  constraint check_limit_range check (lower is null or upper is null or lower <= upper)
);

-- 월간 점검표 격자 (과제 B, 2026-09-29 메일 샘플 반영)
-- 협력사 점검표 한 장 = 한 설비 한 달. 칸 값은 cells jsonb {"항목|날짜|교대": "✓"·"×"·"6.0"} 로 둡니다
-- (양식마다 항목·교대 수가 달라 칸을 행으로 펼치면 한 장에 수백 행이 되기 때문). 서명 칸은 이름 대신 "✓".
create table if not exists public.check_sheet (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  sheet_key   text not null,                                      -- 앱의 grid.id
  template    text not null check (template in ('cnc_monthly', 'hob_daily')),
  vendor      text not null check (length(btrim(vendor)) > 0),
  equip       text not null check (length(btrim(equip)) > 0),
  equip_no    text not null default '',
  dept        text not null default '',
  keeper      text not null default '',                           -- 보전자 — 가명·사번(실명 넣지 않기)
  month       text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  photo_date  date,                                               -- 사진 찍은 날(누락 검사 기준)
  day_from    smallint not null default 1  check (day_from between 1 and 31),
  day_to      smallint not null default 31 check (day_to between 1 and 31),
  off_days    smallint[] not null default '{}',                   -- 휴무일
  ranges      jsonb not null default '{}' check (jsonb_typeof(ranges) = 'object'),  -- 설비별 관리 범위 {"1": {"lower": "5", "upper": "7"}}
  cells       jsonb not null default '{}' check (jsonb_typeof(cells) = 'object'),
  note        text not null default '',                           -- 이상 상황 기록(异常情况记录)
  photo       text not null default '',
  photo_hash  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint check_sheet_days check (day_from <= day_to),
  -- ⚠ upsert 시 onConflict: 'owner_id,sheet_key'
  constraint check_sheet_owner_key unique (owner_id, sheet_key),
  -- 같은 설비·같은 달·같은 장(1~16 / 17~말일)은 한 번만
  constraint check_sheet_natural_key unique (owner_id, vendor, equip, month, day_from)
);

-- 1-1. 2026-09-29 추가 칸 — 이미 표를 만든 프로젝트에 다시 실행해도 맞춰지도록
alter table public.measurement drop constraint if exists measurement_no_check;
alter table public.measurement alter column no set default '';
alter table public.measurement add column if not exists nominal   text not null default '';
alter table public.measurement add column if not exists tol_upper text not null default '';
alter table public.measurement add column if not exists tol_lower text not null default '';
alter table public.measurement add column if not exists orig_no   text not null default '';
alter table public.measurement add column if not exists matched   text not null default '';
alter table public.measurement add column if not exists photo     text not null default '';
alter table public.measurement drop constraint if exists measurement_matched_check;
alter table public.measurement add constraint measurement_matched_check check (matched in ('', 'suggest', 'auto_no'));
alter table public.daily_check add column if not exists photo_hash text not null default '';
alter table public.app_settings add column if not exists offline_mode boolean not null default true;
alter table public.app_settings add column if not exists ai_model text not null default 'gpt-4o-mini';
alter table public.app_settings add column if not exists formal_run smallint not null default 3;   -- 형식적 기록 의심 기준 칸 수(0 이면 끔)
alter table public.app_settings drop constraint if exists app_settings_formal_run_check;
alter table public.app_settings add constraint app_settings_formal_run_check check (formal_run between 0 and 62);
-- 2026-09-29 메일 자료(과제 A): 형상·위치공차 종류, 끼워맞춤·공차 출처·데이텀, 측정실 성적서(보어별 판정 원자료)
alter table public.dim_spec drop constraint if exists dim_spec_type_check;
alter table public.dim_spec add constraint dim_spec_type_check check (type in ('', '선형', '직경', '반경', '각도', '깊이', '위치',
  '동심도', '원통도', '진원도', '평면도', '위치도', '직각도', '평행도', '흔들림', '대칭도', '진직도'));
alter table public.dim_spec add column if not exists fit     text not null default '';
alter table public.dim_spec add column if not exists tol_src text not null default '';
alter table public.dim_spec add column if not exists datum   text not null default '';
alter table public.inspection add column if not exists lab_report jsonb;   -- 측정실 성적서 엑셀을 읽은 결과(파일 이름 + 보어 블록). 판정은 도구가 다시 계산

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거 (search_path 고정)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['app_settings','import_template','inspection','dim_spec','measurement',
                           'drawing_pin','equipment','daily_check','check_limit','check_sheet']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
-- ----------------------------------------------------------------------------

alter table public.app_settings    enable row level security;
alter table public.import_template enable row level security;
alter table public.inspection      enable row level security;
alter table public.dim_spec        enable row level security;
alter table public.measurement     enable row level security;
alter table public.drawing_pin     enable row level security;
alter table public.equipment       enable row level security;
alter table public.daily_check     enable row level security;
alter table public.check_limit     enable row level security;
alter table public.check_sheet     enable row level security;

-- 부모가 없는 표
do $rls$
declare t text;
begin
  foreach t in array array['app_settings','import_template','inspection','equipment','daily_check','check_limit','check_sheet']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
  end loop;
end;
$rls$;

-- 검사 건에 딸린 표: 본인 행이면서, 붙는 검사 건도 본인 것이어야 한다
do $rls$
declare t text;
  v_own text := 'owner_id = auth.uid()';
  v_par text := 'owner_id = auth.uid() and exists (select 1 from public.inspection i where i.id = inspection_id and i.owner_id = auth.uid())';
begin
  foreach t in array array['dim_spec','measurement','drawing_pin']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, v_own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, v_par);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, v_own, v_par);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete', t, v_own);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않습니다. PostgreSQL 이 PUBLIC 에, Supabase 가
--  ALTER DEFAULT PRIVILEGES 로 anon 에 EXECUTE 를 미리 붙이므로 둘 다 끊습니다.
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수는 authenticated 를 남깁니다(트리거 발화 시 호출자 권한 검사 대비).
grant execute on function public.set_updated_at() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
