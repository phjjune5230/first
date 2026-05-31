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

-- smalltalk 대화 목록 테이블
create table smalltalk_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,              -- 첫 메시지 기반 자동 생성 제목
  summary text,                     -- 누적 요약 (세션 간 기억용)
  last_messages jsonb default '[]', -- 최근 20개 메시지 (이어하기용)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
