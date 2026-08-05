// api/programs.js  —  STARTUPMAP 추천 엔진
// 결과를 두 묶음으로 반환한다:
//   open     = 현재 접수 가능한 실시간 공고 5개 (전국/지역 구분)
//   flagship = 진단(단계+필요항목) 맞춤 대표 창업지원사업 3개 (큐레이션)
// data.go.kr 인증키는 서버(process.env)에만 존재.

const SERVICE_URL = 'https://apis.data.go.kr/B552735/kisedKstartupService01';
const KS = 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do';

// ── 진단 분야 → 공고 텍스트에서 찾을 키워드 ──
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

// ── ② 대표 창업지원사업 (큐레이션) : 단계 + 니즈 태그로 매칭 ──
// stages: 예비/초기/성장기/도약기, needs: fund자금/mentor멘토링/invest2투자/global글로벌/space공간/market마케팅
const FLAGSHIPS = [
  { title:'예비창업패키지',            org:'중소벤처기업부·창업진흥원', scale:'최대 1억원',  stages:['예비'],                 needs:['fund'],            desc:'예비창업자 사업화 자금·멘토링' },
  { title:'초기창업패키지',            org:'중소벤처기업부·창업진흥원', scale:'최대 1억원',  stages:['초기'],                 needs:['fund'],            desc:'3년 이내 창업기업 사업화 지원' },
  { title:'창업도약패키지',            org:'중소벤처기업부·창업진흥원', scale:'최대 3억원',  stages:['성장기','도약기'],       needs:['fund','market'],   desc:'3~7년 도약기 사업화·성장 지원' },
  { title:'창업성장기술개발사업(디딤돌)',org:'중소벤처기업부',           scale:'최대 1.2억원',stages:['예비','초기','성장기'],  needs:['fund'],            desc:'창업기업 R&D 자금 지원' },
  { title:'창업성장기술개발사업(전략형)',org:'중소벤처기업부',           scale:'최대 6억원',  stages:['성장기','도약기'],       needs:['fund'],            desc:'성장기 기업 전략형 R&D' },
  { title:'TIPS 프로그램',            org:'중소벤처기업부·TIPS 운영사', scale:'최대 5억원',  stages:['초기','성장기','도약기'], needs:['invest2'],         desc:'민간투자 주도형 기술창업 R&D' },
  { title:'창업사관학교',              org:'중소벤처기업부·창업진흥원', scale:'최대 1억원',  stages:['초기','성장기'],         needs:['mentor','space'],  desc:'유망 창업자 집중 보육·사업화' },
  { title:'IP나래 프로그램',           org:'특허청·한국발명진흥회',     scale:'IP 전략 컨설팅', stages:['예비','초기','성장기','도약기'], needs:['mentor'],   desc:'창업기업 지식재산 전략 컨설팅' },
  { title:'아기유니콘200',            org:'중소벤처기업부',           scale:'최대 3억원+', stages:['도약기'],               needs:['invest2','global'],desc:'유망 스타트업 스케일업·글로벌' },
  { title:'글로벌 창업사관학교',       org:'중소벤처기업부·창업진흥원', scale:'글로벌 진출 지원', stages:['초기','성장기'],     needs:['global'],          desc:'글로벌 지향 창업기업 육성' },
];

function pickFlagships(cond, topN = 3) {
  const scored = FLAGSHIPS.map(f => {
    let s = 0; const why = [];
    if (f.stages.includes(cond.stage)) { s += 10; why.push('단계 적합'); }
    const need = (cond.needs || []).filter(n => f.needs.includes(n));
    if (need.length) { s += need.length * 8; why.push('필요항목 적합'); }
    // 분야 힌트(설명/제목)로 소폭 가산
    let fh = 0; for (const fld of (cond.fields||[])) fh += hits(`${f.title} ${f.desc}`, FIELD_KEYWORDS[fld]||[fld]);
    if (fh) s += Math.min(6, fh*3);
    const fit = Math.max(60, Math.min(97, 60 + s * 2)); // 대표사업은 60~97% 범위
    return { ...f, _score: s, fit, why };
  });
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topN).map(f => ({
    title: f.title, org: f.org, scale: f.scale, desc: f.desc, fit: f.fit,
    reasons: f.why.length ? f.why : ['대표 사업'], url: KS,
  }));
}

// ── 순수 매칭 로직 (접수 공고용) ──
function pick(obj, keys) {
  for (const k of keys) if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  return '';
}
function normalize(raw) {
  return {
    title:  pick(raw, ['biz_pbanc_nm','intg_pbanc_biz_nm','pbanc_nm']),
    org:    pick(raw, ['pbanc_ntrp_nm','sprv_inst','excInsttNm']),
    target: pick(raw, ['aply_trgt_ctnt','aply_trgt']),
    field:  pick(raw, ['supt_biz_clsfc','biz_category_cd']),
    region: pick(raw, ['supt_regin']),
    open:   String(pick(raw, ['rcrt_prgs_yn'])).toUpperCase() === 'Y',
    endDt:  pick(raw, ['pbanc_rcpt_end_dt']),
    url:    pick(raw, ['detl_pg_url','biz_gdnc_url']),
  };
}
function parseDt(s){ const d=String(s||'').replace(/[^0-9]/g,''); return d.length>=8?new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)):null; }
function daysLeft(e,now=new Date()){ const d=parseDt(e); return d?Math.ceil((d-now)/86400000):null; }
function hits(t,ws){ t=(t||'').toLowerCase(); let n=0; for(const w of ws) if(t.includes(w.toLowerCase())) n++; return n; }

function scoreOpen(p, cond, now = new Date()) {
  const hay = `${p.title} ${p.target} ${p.field}`;
  let score = 0; const reasons = [];
  if (p.open) { score += 40; reasons.push('접수중'); }
  let fh = 0; for (const f of (cond.fields||[])) fh += hits(hay, FIELD_KEYWORDS[f]||[f]);
  if (fh) { score += Math.min(30, fh*12); reasons.push('분야 적합'); }
  const sh = hits(hay, STAGE_KEYWORDS[cond.stage]||[]);
  if (sh) { score += Math.min(20, sh*12); reasons.push('단계 적합'); }
  const dl = daysLeft(p.endDt, now);
  if (dl!=null && dl>=0 && dl<=14) { score += 10; reasons.push('마감 임박'); }
  const nationwide = !p.region || p.region.includes('전국');
  if (cond.region && p.region && p.region.includes(cond.region)) { score += 5; reasons.push('지역 적합'); }
  const fit = Math.max(35, Math.min(99, Math.round(score)));
  return { ...p, fit, daysLeft: dl, regionType: nationwide ? '전국' : '지역', reasons };
}

function buildOpen(announcements, cond, opts = {}) {
  const now = opts.now || new Date();
  const topN = opts.topN || 5;
  return announcements
    .map(normalize)
    .filter(p => { const dl = daysLeft(p.endDt, now); return dl == null || dl >= 0; })
    .filter(p => !cond.region || !p.region || p.region.includes('전국') || p.region.includes(cond.region))
    .map(p => scoreOpen(p, cond, now))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, topN)
    .map((p, i) => ({
      rank: i+1, title: p.title, org: p.org, fit: p.fit, daysLeft: p.daysLeft,
      endDt: p.endDt, region: p.region, regionType: p.regionType, reasons: p.reasons, url: p.url,
    }));
}

// ── 개발용 샘플 ──
const soon = (d)=>{ const x=new Date(Date.now()+d*86400000); return `${x.getFullYear()}${String(x.getMonth()+1).padStart(2,'0')}${String(x.getDate()).padStart(2,'0')}`; };
const MOCK = [
  { biz_pbanc_nm:'초기창업패키지 예비창업자 모집', pbanc_ntrp_nm:'창업진흥원', aply_trgt_ctnt:'예비·초기창업기업', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(10), detl_pg_url:KS },
  { biz_pbanc_nm:'푸드테크 스마트팜 창업 지원', pbanc_ntrp_nm:'농식품부', aply_trgt_ctnt:'푸드테크 창업기업', supt_biz_clsfc:'사업화', supt_regin:'서울', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(25), detl_pg_url:KS },
  { biz_pbanc_nm:'AI 소프트웨어 R&D 바우처', pbanc_ntrp_nm:'정보통신산업진흥원', aply_trgt_ctnt:'ICT·AI 창업기업', supt_biz_clsfc:'R&D', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(40), detl_pg_url:KS },
  { biz_pbanc_nm:'콘텐츠 창업 도약 프로그램', pbanc_ntrp_nm:'콘텐츠진흥원', aply_trgt_ctnt:'콘텐츠 도약기 기업', supt_biz_clsfc:'멘토링', supt_regin:'부산', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(6), detl_pg_url:KS },
  { biz_pbanc_nm:'제조 스마트공장 구축 지원', pbanc_ntrp_nm:'중기부', aply_trgt_ctnt:'제조 중소기업', supt_biz_clsfc:'시설', supt_regin:'경기', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(55), detl_pg_url:KS },
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
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`NOT_JSON: ${text.slice(0,200)}`); }
  if (json.resultCode && String(json.resultCode) !== '00') throw new Error(`UPSTREAM ${json.resultCode}: ${json.resultMsg||''}`);
  return Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const cond = {
    stage: q.stage || '',
    fields: (q.fields ? String(q.fields).split(',') : []).map(s=>s.trim()).filter(Boolean),
    needs:  (q.needs  ? String(q.needs).split(',')  : []).map(s=>s.trim()).filter(Boolean),
    region: q.region || '',
  };
  const flagship = pickFlagships(cond, 3);
  try {
    if (q.mock === '1' || (!process.env.DATA_GO_KR_API_KEY && q.live !== '1')) {
      return res.status(200).json({ source:'mock', cond, open: buildOpen(MOCK, cond, {topN:5}), flagship });
    }
    const ann = await callKStartup('getAnnouncementInformation01', { perPage: 200, extra: { rcrt_prgs_yn: 'Y' } });
    if (q.debug === '1') return res.status(200).json({ annSample: ann[0] || null });
    const open = buildOpen(ann, cond, { topN: 5 });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    return res.status(200).json({ source:'k-startup', cond, open, flagship });
  } catch (e) {
    const msg = String(e.message || e);
    const hint =
      msg === 'NO_KEY' ? 'Vercel 환경변수 DATA_GO_KR_API_KEY 를 설정하세요.' :
      msg.startsWith('UPSTREAM') ? '키/활용신청/IP/호출한도를 확인하세요.' :
      msg.startsWith('NOT_JSON') ? 'returnType/파라미터를 확인하세요.' : '';
    // 공고 호출이 실패해도 대표 사업은 항상 제공
    return res.status(200).json({ source:'flagship-only', cond, open: [], flagship, warn: msg, hint });
  }
};
