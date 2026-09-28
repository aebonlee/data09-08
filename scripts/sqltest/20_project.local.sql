-- ============================================================================
-- 로컬 검증 전용 — data09-08 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 흉내: set role authenticated + request.jwt.claim.sub 에 uuid 를 넣으면
--  스텁의 auth.uid() 가 그 값을 돌려줍니다. anon 은 set role anon.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 문장이 지정한 SQLSTATE 로 실패하는지 본다. (이름이 _assert 로 시작해 권한 검사에서 빠진다)
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not distinct from p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

-- 영향받은 행 수를 돌려준다 (RLS 로 가려진 UPDATE/DELETE 는 0 행)
create or replace function public._assert_rows(p_sql text, p_expected int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = p_expected then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 % 행, 실제 % 행)', p_label, p_expected, v_n;
  end if;
end;
$fn$;

do $t$ begin raise notice '[프로젝트] 재실행 안전 · 정책 수'; end $t$;

-- 두 번 적용한 뒤에도 정책이 표마다 정확히 4개(중복 생성 없음)
do $t$
declare v_bad text;
begin
  select string_agg(c.relname || '=' || n, ', ') into v_bad from (
    select c.relname, count(p.oid) as n
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where s.nspname = 'public' and c.relkind = 'r'
     group by c.relname) c
   where n <> 4;
  perform public._assert(v_bad is null, '두 번 적용 후 표마다 정책 4개 (발견: ' || coalesce(v_bad, '없음') || ')');
  perform public._assert_eq(
    (select count(*) from pg_trigger where tgname like '%\_updated\_at' and not tgisinternal),
    9::bigint, '두 번 적용 후 updated_at 트리거 9개');
end $t$;

do $t$ begin raise notice '[프로젝트] 함수 권한(proacl)'; end $t$;

do $t$
declare v_acl text;
begin
  select array_to_string(proacl, ',') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname = 'set_updated_at';
  perform public._assert(v_acl is not null and v_acl not like '=X/%' and v_acl not like '%,=X/%',
    'set_updated_at: PUBLIC EXECUTE 없음 (' || coalesce(v_acl, 'null') || ')');
  perform public._assert(v_acl not like '%anon=%', 'set_updated_at: anon EXECUTE 없음');
  perform public._assert(v_acl like '%authenticated=X%', 'set_updated_at: authenticated EXECUTE 있음');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 A 가 자료를 넣는다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 A — 자기 자료 쓰기·읽기'; end $t$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $t$
declare v_i bigint;
begin
  insert into public.app_settings (repeat_days) values (3);
  insert into public.import_template (name, kind, cols) values ('CMM-A', 'meas', '{"no":"POINT","value":"ACTUAL"}');
  insert into public.import_template (name, kind, cols) values ('CMM-A', 'meas', '{"no":"No","value":"Actual"}')
    on conflict (owner_id, kind, name) do update set cols = excluded.cols;
  perform public._assert_eq((select cols->>'no' from public.import_template), 'No'::text,
    '같은 종류·이름의 템플릿은 upsert 로 덮어쓴다 (앱과 같음)');

  insert into public.inspection (insp_key, part_no, rev, lot, vendor, inspector) values ('Imx1', 'P-100', 'A', 'L1', '예시업체', '검사자')
    returning id into v_i;
  -- 같은 항목번호가 두 번(도구가 「확인필요(중복)」로 드러냄), 숫자가 아닌 기준값도 받는다
  insert into public.dim_spec (inspection_id, line_no, no, type, nominal, tol_upper, tol_lower, unit) values
    (v_i, 1, '1', '선형', '10.0', '0.1', '-0.1', 'mm'),
    (v_i, 2, '1', '직경', '5',    '0.05', '0',   'mm'),
    (v_i, 3, '2', '',     '약 7', '',     '',    '');
  insert into public.measurement (inspection_id, line_no, no, value, unit, source) values
    (v_i, 1, '1', '10.05', 'mm', 'CMM'), (v_i, 2, '1', '10.2', 'mm', '수기'), (v_i, 3, '2', '', '', '수기');
  insert into public.drawing_pin (inspection_id, no, x, y) values (v_i, '1', 0.25, 0.4);

  insert into public.equipment (vendor, equip, "order") values ('A사', '1호기', 1), ('A사', '2호기', 2);
  insert into public.daily_check (vendor, date, equip, item, result, value) values
    ('A사', '2026-09-28', '1호기', '압력', '○', '18.2'), ('A사', '2026-09-28', '1호기', '온도', '', '');
  insert into public.daily_check (vendor, date, equip, item, result, value) values
    ('A사', '2026-09-28', '1호기', '압력', '×', '21.0')
    on conflict (owner_id, vendor, date, equip, item) do update set result = excluded.result, value = excluded.value;
  perform public._assert_eq((select count(*) from public.daily_check), 2::bigint,
    '같은 협력사·점검일·설비·항목은 upsert 로 한 줄만 남는다 (덧붙이기 중복 방지)');
  insert into public.check_limit (item, lower, upper) values ('압력', 15, 20);

  perform public._assert_eq((select count(*) from public.dim_spec where no = '1'), 2::bigint,
    '기준표의 같은 항목번호 두 줄을 받는다 (도구가 확인필요로 드러내는 경우)');
  perform public._assert_eq((select owner_id from public.inspection),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'owner_id 가 auth.uid() 로 채워진다');
end $t$;

-- 트리거는 now()(트랜잭션 시작 시각)를 쓰므로 INSERT 와 다른 문장에서 고쳐야 차이가 난다
update public.inspection set lot = 'L2';
do $t$ begin
  perform public._assert((select updated_at > created_at from public.inspection), 'UPDATE 하면 updated_at 이 갱신된다');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 B 는 A 의 자료를 못 본다 · 못 고친다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 B — A 와 격리'; end $t$;

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

do $t$
declare t text;
begin
  foreach t in array array['app_settings','import_template','inspection','dim_spec','measurement',
                           'drawing_pin','equipment','daily_check','check_limit']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
    perform public._assert_rows(format('update public.%I set updated_at = now()', t), 0, 'B 는 A 의 ' || t || ' 를 못 고친다');
    perform public._assert_rows(format('delete from public.%I', t), 0, 'B 는 A 의 ' || t || ' 를 못 지운다');
  end loop;
  perform public._assert_raises(
    $q$insert into public.inspection (owner_id, insp_key) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Ibad')$q$,
    '42501', 'B 가 owner_id 를 A 로 속여 넣으면 RLS 가 막는다');
  -- B 는 A 와 같은 협력사·설비 이름으로 자기 목록을 따로 둔다
  insert into public.equipment (vendor, equip) values ('A사', '1호기');
  perform public._assert_eq((select count(*) from public.equipment), 1::bigint, 'B 는 A 와 같은 설비 이름으로 자기 목록을 따로 둔다');
end $t$;

reset role;
do $t$
declare v_i bigint;
begin
  select id into v_i from public.inspection where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  execute 'set local role authenticated';
  perform public._assert_raises(
    format('insert into public.measurement (inspection_id, line_no, no, value) values (%s, 9, %L, %L)', v_i, '1', '99'),
    '42501', 'B 가 A 의 검사 건 id 를 알아도 측정값을 끼워 넣지 못한다');
end $t$;

-- ----------------------------------------------------------------------------
-- anon(비로그인)은 아무것도 못 보고 못 쓴다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] anon — 읽기·쓰기 불가'; end $t$;

set role anon;
set request.jwt.claim.sub = '';
do $t$
declare t text;
begin
  foreach t in array array['app_settings','import_template','inspection','dim_spec','measurement',
                           'drawing_pin','equipment','daily_check','check_limit']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises($q$insert into public.inspection (insp_key) values ('Ianon')$q$,
    '42501', 'anon 은 inspection 에 쓰지 못한다');
  perform public._assert_raises($q$insert into public.daily_check (vendor, date, equip, item) values ('X', '2026-09-28', 'Y', 'Z')$q$,
    '42501', 'anon 은 daily_check 에 쓰지 못한다 (협력사 업로드 링크도 로그인 뒤에만)');
  perform public._assert_raises('select public.set_updated_at()', '42501', 'anon 은 set_updated_at 을 실행하지 못한다');
end $t$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK · UNIQUE (postgres 로 — RLS 와 무관하게 제약만 본다)
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] CHECK · UNIQUE 제약'; end $t$;

do $t$
declare a uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v_i bigint;
begin
  select id into v_i from public.inspection where owner_id = a;
  perform public._assert_raises(format('insert into public.inspection (owner_id, insp_key) values (%L, %L)', a, 'Imx1'),
    '23505', '같은 사용자·같은 검사 건 id 는 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.drawing_pin (owner_id, inspection_id, no, x, y) values (%L, %s, %L, 0.1, 0.1)', a, v_i, '1'),
    '23505', '한 검사 건에서 항목번호당 핀은 하나');
  perform public._assert_raises(format('insert into public.dim_spec (owner_id, inspection_id, line_no, no) values (%L, %s, 1, %L)', a, v_i, '9'),
    '23505', '기준표 줄 번호(line_no)는 검사 건 안에서 한 번만');
  perform public._assert_raises(format('insert into public.equipment (owner_id, vendor, equip) values (%L, %L, %L)', a, 'A사', '1호기'),
    '23505', '같은 협력사·설비는 한 번만');
  perform public._assert_raises(format('insert into public.check_limit (owner_id, item) values (%L, %L)', a, '압력'),
    '23505', '같은 점검항목의 기준값은 한 행');
  perform public._assert_raises(format('insert into public.daily_check (owner_id, vendor, date, equip, item) values (%L, %L, %L, %L, %L)', a, 'A사', '2026-09-28', '1호기', '온도'),
    '23505', '같은 협력사·점검일·설비·항목은 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.app_settings (owner_id) values (%L)', a),
    '23505', '설정은 사용자당 1행');
  perform public._assert_raises(format('insert into public.dim_spec (owner_id, inspection_id, line_no, no, type) values (%L, %s, 7, %L, %L)', a, v_i, '5', '곡률'),
    '23514', '치수 종류는 선형·직경·반경·각도·깊이·위치(또는 빈칸)만');
  perform public._assert_raises(format('insert into public.dim_spec (owner_id, inspection_id, line_no, no) values (%L, %s, 8, %L)', a, v_i, ' '),
    '23514', '빈 항목번호는 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.dim_spec (owner_id, inspection_id, line_no, no, decimals) values (%L, %s, 9, %L, 11)', a, v_i, '6'),
    '23514', '소수점 자리수는 0~10');
  perform public._assert_raises(format('insert into public.drawing_pin (owner_id, inspection_id, no, x, y) values (%L, %s, %L, 1.2, 0.5)', a, v_i, '7'),
    '23514', '핀 좌표는 도면 안(0~1)만');
  perform public._assert_raises(format('insert into public.import_template (owner_id, name, kind) values (%L, %L, %L)', a, 't', 'photo'),
    '23514', '템플릿 종류는 spec·meas·equip·daily·limits 만');
  perform public._assert_raises(format('insert into public.check_limit (owner_id, item, lower, upper) values (%L, %L, 30, 20)', a, '유량'),
    '23514', '관리 기준값 하한 > 상한은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.app_settings (owner_id, repeat_days) values (%L, 1)', gen_random_uuid()),
    '23514', '반복 검사 기준은 2 이상(앱과 같음)');
  perform public._assert_raises(format('insert into public.daily_check (owner_id, vendor, date, equip, item) values (%L, %L, null, %L, %L)', a, 'A사', '1호기', '진동'),
    '23502', '점검일 없는 점검 데이터는 NOT NULL 이 막는다');

  -- 검사 건을 지우면 기준표·측정결과·핀도 함께 지워진다
  delete from public.inspection where id = v_i;
  perform public._assert_eq((select count(*) from public.measurement where inspection_id = v_i), 0::bigint,
    '검사 건을 지우면 딸린 측정결과도 지워진다 (on delete cascade)');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
