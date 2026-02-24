-- ══════════════════════════════════════════════════
-- 도장검사 일정관리 DB 스키마
-- Supabase SQL Editor에 전체 복사 후 실행
-- ══════════════════════════════════════════════════

-- 협력사
CREATE TABLE IF NOT EXISTS companies (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  addr         VARCHAR(200),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 프로젝트
CREATE TABLE IF NOT EXISTS projects (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  ship_type  VARCHAR(100),
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hull No.
CREATE TABLE IF NOT EXISTS hulls (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  no         VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 검사항목
CREATE TABLE IF NOT EXISTS inspection_items (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 검사 일정
CREATE TABLE IF NOT EXISTS schedules (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  hull_id      INTEGER REFERENCES hulls(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  date         DATE NOT NULL,
  week_start   DATE NOT NULL,
  slot         SMALLINT DEFAULT 0,     -- 같은 날 같은 hull의 순서 (0,1,2)
  product_name VARCHAR(200),
  insp_item_id INTEGER REFERENCES inspection_items(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_schedules_company ON schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_schedules_project ON schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_schedules_week    ON schedules(week_start);
CREATE INDEX IF NOT EXISTS idx_schedules_date    ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_hulls_project     ON hulls(project_id);

-- ── 기본 검사항목 데이터 ──────────────────────────
INSERT INTO inspection_items (name, sort_order) VALUES
  ('1st Inspection',            1),
  ('Intermediate Inspection',   2),
  ('Pre-Final Inspection',      3),
  ('Final Inspection',          4),
  ('Touch-up Inspection',       5)
ON CONFLICT DO NOTHING;
