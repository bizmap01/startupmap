// api/programs.js  —  STARTUPMAP 추천 엔진 (단일 파일)
// 프론트(진단 결과)는 이 함수 하나만 호출한다. data.go.kr 인증키는 서버에만 존재.

const SERVICE_URL = 'https://apis.data.go.kr/B552735/kisedKstartupService01';

// 진단 분야 → 공고 텍스트에서 찾을 키워드
const FIELD_KEYWORDS = {
  'IT':    ['IT','정보통신','소프트웨어','ICT','플랫폼','앱','디지털','AI','인공지능','데이터','SaaS'],
  '제조':  ['제조','생산','스마트공장','하드웨어','소재','부품','장비','메이커'],
  '바이오':['바이오','의료','헬스케어','제약','진단','생명','디지털헬스'],
  '푸드테크':['푸드','식품','외식','농식품','푸드테크','스마트팜'],
  '콘텐츠':['콘텐츠','미디어','게임','문화','디자인','크리에이터','웹툰','영상'],
  '소셜':  ['소셜','사회적','로컬','지역','임팩트','복지','ESG'],
};
const STAGE_KEYWORDS = {
  '예비':   ['예비창업','예비'],
  '초기':   ['초기창업','3년 이내','3년이내','창업기업','초기'],
  '성장기': ['도약','성장','7년','스케일','재도전'],
  '도약기': ['도약','스케일업','글로벌','성장','점프업'],
};

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}
function normalizeAnnouncement(raw) {
  return {
    title:   pick(raw, ['biz_pbanc_nm','intg_pbanc_biz_nm','pbanc_nm','title']),
    org:     pick(raw, ['pbanc_ntrp_nm','sprv_inst','excInsttNm','org']),
    target:  pick(raw, ['aply_trgt_ctnt','aply_trgt','target']),
    field:   pick(raw, ['supt_biz_clsfc','biz_category_cd','field']),
    region:  pick(raw, ['supt_regin','region']),
    open:    String(pick(raw, ['rcrt_prgs_yn','open'])).toUpperCase() === 'Y',
    startDt: pick(raw, ['pbanc_rcpt_bgng_dt','startDt']),
    endDt:   pick(raw, ['pbanc_rcpt_end_dt','endDt']),
    url:     pick(raw, ['detl_pg_url','biz_gdnc_url','url']),
    flagship: !!raw._flagship,
    _raw: raw,
  };
}
function parseDt(s) {
  if (!s) return null;
  const d = String(s).replace(/[^0-9]/g, '');
  if (d.length < 8) return null;
  return new Date(+d.slice(0,4), +d.slice(4,6)-1, +d.slice(6,8));
}
function daysLeft(endDt, now = new Date()) {
  const e = parseDt(endDt);
  if (!e) return null;
  return Math.ceil((e - now) / 86400000);
}
function countHits(text, words) {
  const t = (text || '').toLowerCase();
  let n = 0;
  for (const w of words) if (t.includes(w.toLowerCase())) n++;
  return n;
}
function scoreProgram(p, cond, now = new Date()) {
  const hay = `${p.title} ${p.target} ${p.field}`;
  let score = 0; const reasons = [];
  if (p.open) { score += 40; reasons.push('접수중'); }
  let fieldHits = 0;
  for (const f of (cond.fields || [])) fieldHits += countHits(hay, FIELD_KEYWORDS[f] || [f]);
  if (fieldHits > 0) { score += Math.min(30, fieldHits * 12); reasons.push('분야 적합'); }
  const stageHits = countHits(hay, STAGE_KEYWORDS[cond.stage] || []);
  if (stageHits > 0) { score += Math.min(20, stageHits * 12); reasons.push('단계 적합'); }
  const dl = daysLeft(p.endDt, now);
  if (dl !== null && dl >= 0 && dl <= 14) { score += 10; reasons.push('마감 임박'); }
  if (cond.region && p.region && p.region.includes(cond.region)) { score += 5; reasons.push('지역 적합'); }
  if (p.flagship) { score += 25; reasons.push('대표 사업'); }
  const fit = Math.max(35, Math.min(99, Math.round(score)));
  return { ...p, score, fit, daysLeft: dl, reasons };
}
function isNotClosed(p, now = new Date()) {
  const dl = daysLeft(p.endDt, now);
  return dl === null || dl >= 0;
}
function buildResult(announcements, flagships, cond, opts = {}) {
  const now = opts.now || new Date();
  const topN = opts.topN || 5;
  const scored = announcements
    .map(normalizeAnnouncement)
    .filter(p => isNotClosed(p, now))
    .filter(p => !cond.region || !p.region || p.region.includes('전국') || p.region.includes(cond.region))
    .map(p => scoreProgram(p, cond, now))
    .sort((a, b) => b.score - a.score);
  const flag = (flagships || [])
    .map(r => normalizeAnnouncement({ ...r, _flagship: true }))
    .map(p => scoreProgram(p, cond, now))
    .sort((a, b) => b.score - a.score);
  const picked = []; const seen = new Set();
  const push = (p) => { const k = p.title || p.url; if (!k || seen.has(k)) return; seen.add(k); picked.push(p); };
  scored.slice(0, topN - 1).forEach(push);
  flag.slice(0, 2).forEach(push);
  scored.slice(topN - 1).forEach(push);
  return picked.slice(0, topN).map((p, i) => ({
    rank: i + 1, title: p.title, org: p.org, fit: p.fit, daysLeft: p.daysLeft,
    endDt: p.endDt, region: p.region, open: p.open, flagship: p.flagship,
    reasons: p.reasons, url: p.url,
  }));
}

const soon = (d) => { const x = new Date(Date.now() + d*86400000); return `${x.getFullYear()}${String(x.getMonth()+1).padStart(2,'0')}${String(x.getDate()).padStart(2,'0')}`; };
const MOCK_ANNOUNCEMENTS = [
  { biz_pbanc_nm:'초기창업패키지 예비창업자 모집', pbanc_ntrp_nm:'창업진흥원', aply_trgt_ctnt:'예비창업자 및 3년 이내 초기창업기업', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(10), detl_pg_url:'https://www.k-startup.go.kr' },
  { biz_pbanc_nm:'푸드테크 스마트팜 창업 지원사업', pbanc_ntrp_nm:'농식품부', aply_trgt_ctnt:'푸드테크·농식품 초기창업기업', supt_biz_clsfc:'사업화', supt_regin:'서울', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(25), detl_pg_url:'https://www.k-startup.go.kr' },
  { biz_pbanc_nm:'AI 소프트웨어 R&D 바우처', pbanc_ntrp_nm:'정보통신산업진흥원', aply_trgt_ctnt:'ICT·인공지능 분야 창업기업', supt_biz_clsfc:'기술개발(R&D)', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(40), detl_pg_url:'https://www.k-startup.go.kr' },
  { biz_pbanc_nm:'콘텐츠 크리에이터 창업 도약 프로그램', pbanc_ntrp_nm:'콘텐츠진흥원', aply_trgt_ctnt:'콘텐츠·미디어 도약기 기업', supt_biz_clsfc:'멘토링', supt_regin:'부산', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(6), detl_pg_url:'https://www.k-startup.go.kr' },
  { biz_pbanc_nm:'제조 스마트공장 구축 지원', pbanc_ntrp_nm:'중기부', aply_trgt_ctnt:'제조·하드웨어 중소기업', supt_biz_clsfc:'시설', supt_regin:'경기', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(55), detl_pg_url:'https://www.k-startup.go.kr' },
];
const MOCK_FLAGSHIPS = [
  { biz_pbanc_nm:'예비창업패키지', pbanc_ntrp_nm:'중소벤처기업부', aply_trgt_ctnt:'예비창업자', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(30), detl_pg_url:'https://www.k-startup.go.kr' },
  { biz_pbanc_nm:'창업도약패키지', pbanc_ntrp_nm:'중소벤처기업부', aply_trgt_ctnt:'3~7년 도약기 창업기업', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(35), detl_pg_url:'https://www.k-startup.go.kr' },
];

async function callKStartup(op, params = {}) {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error('NO_KEY');
  const url = new URL(`${SERVICE_URL}/${op}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('page', String(params.page || 1));
  url.searchParams.set('perPage', String(params.perPage || 100));
  for (const [k, v] of Object.entries(params.extra || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`NOT_JSON: ${text.slice(0, 200)}`); }
  if (json.resultCode && String(json.resultCode) !== '00') {
    throw new Error(`UPSTREAM ${json.resultCode}: ${json.resultMsg || ''}`);
  }
  return Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const cond = {
    stage: q.stage || '',
    fields: (q.fields ? String(q.fields).split(',') : []).map(s => s.trim()).filter(Boolean),
    region: q.region || '',
  };
  const topN = Math.min(10, Math.max(1, parseInt(q.topN) || 5));
  try {
    if (q.mock === '1' || (!process.env.DATA_GO_KR_API_KEY && q.live !== '1')) {
      const result = buildResult(MOCK_ANNOUNCEMENTS, MOCK_FLAGSHIPS, cond, { topN });
      return res.status(200).json({ source: 'mock', cond, count: result.length, programs: result });
    }
    const [ann, flag] = await Promise.all([
      callKStartup('getAnnouncementInformation01', { perPage: 200, extra: { rcrt_prgs_yn: 'Y' } }),
      callKStartup('getBusinessInformation01',     { perPage: 60 }),
    ]);
    if (q.debug === '1') {
      return res.status(200).json({ annSample: ann[0] || null, flagSample: flag[0] || null });
    }
    const result = buildResult(ann, flag, cond, { topN });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    return res.status(200).json({ source: 'k-startup', cond, count: result.length, programs: result });
  } catch (e) {
    const msg = String(e.message || e);
    const hint =
      msg === 'NO_KEY' ? 'Vercel 환경변수 DATA_GO_KR_API_KEY 를 설정하세요.' :
      msg.startsWith('UPSTREAM') ? '키/활용신청/IP/호출한도를 확인하세요.' :
      msg.startsWith('NOT_JSON') ? 'returnType/파라미터를 확인하세요.' : '';
    return res.status(502).json({ error: msg, hint });
  }
};
