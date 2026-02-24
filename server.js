require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'paint-inspection-secret-2025';

// ── DB 연결 ──────────────────────────────────────
// --- DB 연결 ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 1) 환경변수 확인 로그 (pool 만든 다음에!)
console.log("DATABASE_URL exists?", !!process.env.DATABASE_URL);
console.log(
  "DATABASE_URL (masked):",
  process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/\/.*?:.*?@/, "//***:***@")
    : "MISSING"
);

// 2) DB 연결 테스트
pool.query("SELECT 1")
  .then(() => console.log("✅ DB connected"))
  .catch((err) => console.error("❌ DB connect failed", err));
// ── 미들웨어 ─────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// CORS: FRONTEND_URL이 비어있으면(설정 안 했으면) 모든 Origin 허용(권장: 운영에서는 FRONTEND_URL 지정)
const corsOptions = {
  origin: (origin, cb) => {
    // origin이 없는 경우(서버-서버 호출, curl 등)는 허용
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // Authorization 헤더 사용이라 쿠키 필요 없음
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight(OPTIONS) 처리
app.use(express.json());

// ── JWT 인증 미들웨어 ────────────────────────────
function auth(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '인증이 필요합니다' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '토큰이 유효하지 않습니다' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  next();
}

// ══════════════════════════════════════════════════
// 인증
// ══════════════════════════════════════════════════

// 로그인
app.post('/api/login', async (req, res) => {
  const { type, companyId, password } = req.body;
  try {
    if (type === 'admin') {
      if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: '관리자 비밀번호가 틀렸습니다' });
      }
      const token = jwt.sign({ role: 'admin', name: '관리자' }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, role: 'admin', name: '관리자' });
    }

    // 협력사 로그인
    const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (rows.length === 0) return res.status(401).json({ error: '협력사를 찾을 수 없습니다' });
    const company = rows[0];
    const valid = await bcrypt.compare(password, company.password_hash);
    if (!valid) return res.status(401).json({ error: '비밀번호가 틀렸습니다' });

    const token = jwt.sign(
      { role: 'company', companyId: company.id, name: company.name },
      JWT_SECRET, { expiresIn: '12h' }
    );
    res.json({ token, role: 'company', companyId: company.id, name: company.name, addr: company.addr });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ══════════════════════════════════════════════════
// 마스터 데이터 (읽기 — 모든 로그인 사용자)
// ══════════════════════════════════════════════════

app.get('/api/companies', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, addr FROM companies ORDER BY name');
  res.json(rows);
});

app.get('/api/projects', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(rows);
});

app.get('/api/hulls', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM hulls ORDER BY no');
  res.json(rows);
});

app.get('/api/inspection-items', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM inspection_items ORDER BY sort_order, name');
  res.json(rows);
});

// ══════════════════════════════════════════════════
// 마스터 데이터 관리 (관리자 전용)
// ══════════════════════════════════════════════════

// 협력사 등록
app.post('/api/companies', auth, adminOnly, async (req, res) => {
  const { name, password, addr } = req.body;
  if (!name || !password) return res.status(400).json({ error: '이름과 비밀번호 필수' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO companies (name, password_hash, addr) VALUES ($1, $2, $3) RETURNING id, name, addr',
    [name, hash, addr]
  );
  res.json(rows[0]);
});

// 협력사 수정
app.put('/api/companies/:id', auth, adminOnly, async (req, res) => {
  const { name, addr, password } = req.body;
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE companies SET name=$1, addr=$2, password_hash=$3 WHERE id=$4', [name, addr, hash, req.params.id]);
  } else {
    await pool.query('UPDATE companies SET name=$1, addr=$2 WHERE id=$3', [name, addr, req.params.id]);
  }
  res.json({ ok: true });
});

// 협력사 삭제
app.delete('/api/companies/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM companies WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// 프로젝트 등록
app.post('/api/projects', auth, adminOnly, async (req, res) => {
  const { name, ship_type, note } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO projects (name, ship_type, note) VALUES ($1, $2, $3) RETURNING *',
    [name, ship_type, note]
  );
  res.json(rows[0]);
});

// 프로젝트 수정
app.put('/api/projects/:id', auth, adminOnly, async (req, res) => {
  const { name, ship_type, note } = req.body;
  await pool.query('UPDATE projects SET name=$1, ship_type=$2, note=$3 WHERE id=$4', [name, ship_type, note, req.params.id]);
  res.json({ ok: true });
});

// 프로젝트 삭제
app.delete('/api/projects/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Hull No. 일괄 등록
app.post('/api/hulls/bulk', auth, adminOnly, async (req, res) => {
  const { project_id, nos } = req.body; // nos: string[]
  const added = [], skipped = [];
  for (const no of nos) {
    const exists = await pool.query('SELECT id FROM hulls WHERE project_id=$1 AND no=$2', [project_id, no]);
    if (exists.rows.length > 0) { skipped.push(no); continue; }
    await pool.query('INSERT INTO hulls (project_id, no) VALUES ($1, $2)', [project_id, no]);
    added.push(no);
  }
  res.json({ added, skipped });
});

// Hull No. 수정
app.put('/api/hulls/:id', auth, adminOnly, async (req, res) => {
  const { no } = req.body;
  await pool.query('UPDATE hulls SET no=$1 WHERE id=$2', [no, req.params.id]);
  res.json({ ok: true });
});

// Hull No. 삭제
app.delete('/api/hulls/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM hulls WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// 검사항목 등록
app.post('/api/inspection-items', auth, adminOnly, async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO inspection_items (name) VALUES ($1) RETURNING *', [name]
  );
  res.json(rows[0]);
});

// 검사항목 수정
app.put('/api/inspection-items/:id', auth, adminOnly, async (req, res) => {
  const { name } = req.body;
  await pool.query('UPDATE inspection_items SET name=$1 WHERE id=$2', [name, req.params.id]);
  res.json({ ok: true });
});

// 검사항목 삭제
app.delete('/api/inspection-items/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM inspection_items WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
// 일정 (Schedules)
// ══════════════════════════════════════════════════

// 일정 조회 — 협력사는 자신 것만, 관리자는 전체
app.get('/api/schedules', auth, async (req, res) => {
  const { project_id, week_start, company_id } = req.query;
  let q = 'SELECT s.*, c.name as company_name, c.addr as location, p.name as project_name, p.ship_type, h.no as hull_no, i.name as insp_item_name FROM schedules s LEFT JOIN companies c ON s.company_id=c.id LEFT JOIN projects p ON s.project_id=p.id LEFT JOIN hulls h ON s.hull_id=h.id LEFT JOIN inspection_items i ON s.insp_item_id=i.id WHERE 1=1';
  const params = [];

  if (req.user.role === 'company') {
    params.push(req.user.companyId);
    q += ` AND s.company_id=$${params.length}`;
  } else if (company_id) {
    params.push(company_id);
    q += ` AND s.company_id=$${params.length}`;
  }
  if (project_id) { params.push(project_id); q += ` AND s.project_id=$${params.length}`; }
  if (week_start) { params.push(week_start); q += ` AND s.week_start=$${params.length}`; }

  q += ' ORDER BY s.date, s.created_at';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// 일정 저장 (upsert — 같은 날 같은 hull 같은 순서(slot)로 덮어쓰기)
app.post('/api/schedules', auth, async (req, res) => {
  const companyId = req.user.role === 'company' ? req.user.companyId : req.body.company_id;
  const { hull_id, project_id, date, week_start, product_name, insp_item_id, note, slot } = req.body;

  // slot: 같은 날 같은 hull의 몇 번째 건인지 (0,1,2)
  const slotNum = slot || 0;

  // 기존 같은 slot 찾아서 upsert
  const existing = await pool.query(
    'SELECT id FROM schedules WHERE company_id=$1 AND hull_id=$2 AND date=$3 AND week_start=$4 AND slot=$5',
    [companyId, hull_id, date, week_start, slotNum]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE schedules SET project_id=$1, product_name=$2, insp_item_id=$3, note=$4 WHERE id=$5',
      [project_id, product_name, insp_item_id || null, note, existing.rows[0].id]
    );
    res.json({ id: existing.rows[0].id, updated: true });
  } else {
    const { rows } = await pool.query(
      'INSERT INTO schedules (company_id, hull_id, project_id, date, week_start, product_name, insp_item_id, note, slot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [companyId, hull_id, project_id, date, week_start, product_name, insp_item_id || null, note, slotNum]
    );
    res.json({ id: rows[0].id, updated: false });
  }
});

// 일정 삭제
app.delete('/api/schedules/:id', auth, async (req, res) => {
  // 협력사는 자신 것만 삭제 가능
  const q = req.user.role === 'company'
    ? 'DELETE FROM schedules WHERE id=$1 AND company_id=$2'
    : 'DELETE FROM schedules WHERE id=$1';
  const params = req.user.role === 'company'
    ? [req.params.id, req.user.companyId]
    : [req.params.id];
  await pool.query(q, params);
  res.json({ ok: true });
});

app.get('/api', (req, res) => res.json({ ok: true, name: 'paint-inspection-server' }));

// 프로젝트 목록 별칭 (프론트 호환용: /api/projects/list)
app.get('/api/projects/list', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(rows);
});

// 협력사 목록 (로그인 전 — 이름/id만 공개)
app.get('/api/companies/list', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM companies ORDER BY name');
  res.json(rows);
});

// 헬스체크
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.listen(PORT, () => console.log(`✅ 서버 실행중: PORT ${PORT}`));
