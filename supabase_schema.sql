-- 커리큘럼 및 학습 state 테이블
create table study_state (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),

  -- 커리큘럼
  curriculum jsonb,         -- { goal, level, duration, weekly_plan[] }
  current_week int default 1,
  current_day int default 1,

  -- 학습 로그
  daily_logs jsonb default '[]',  -- [{ date, summary, notes, weak_points[] }]

  -- 반복 약점 누적
  weak_points jsonb default '[]'
);

-- 단일 row로 관리 (개인용)
insert into study_state (id) values ('00000000-0000-0000-0000-000000000001');
