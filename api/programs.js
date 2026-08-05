// api/programs.js  —  STARTUPMAP 추천 엔진
//   open   = 현재 접수 가능한 공고 5개 (단계+분야+니즈 매칭, 전국/지역 구분)
//   closed = 최근 마감된 공고 3개 (참고용, 적합도·선정가능성 포함)
// data.go.kr 인증키는 서버(process.env)에만 존재.

const SERVICE_URL = 'https://apis.data.go.kr/B552735/kisedKstartupService01';
const KS = 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do';

const FIELD_KEYWORDS = {
  'IT':    ['IT','정보통신','소프트웨어','ICT','플랫폼','앱','디지털','AI','인공지능','데이터','SaaS'],
  '제조':  ['제조','생산','스마트공장','하드웨어','소재','부품','장비','메이커'],
  '바이오':['바이오','의료','헬스케어','제약','진단','생명','디지털헬스'],
  '푸드테크':['푸드','식품','외식','농식품','푸드테크','스마트팜'],
  '콘텐츠':['콘텐츠','미디어','게임','문화','디자인','크리에이터','웹툰','영상'],
  '소셜':  ['소셜','사회적','로컬','임팩트','복지','ESG'],
};
const STAGE_KEYWORDS = {
  '예비':['예비창업','예비'], '초기':['초기창업','3년 이내','3년이내','창업기업','초기'],
  '성장기':['도약','성장','7년','스케일','재도전'], '도약기':['도약','스케일업','글로벌','성장','점프업'],
};
// 필요항목(니즈) → 공고 텍스트에서 찾을 키워드
const NEED_KEYWORDS = {
  fund:   ['자금','사업화','지원금','보조금','바우처','융자','R&D','기술개발'],
  invest2:['투자','IR','VC','액셀러','팁스','TIPS','펀드','민간투자','벤처투자'],
  global: ['글로벌','해외','수출','진출','국제'],
  mentor: ['멘토','컨설팅','교육','코칭','보육','액셀러'],
  market: ['마케팅','판로','홍보','유통','판매','브랜드'],
  space:  ['공간','입주','시설','오피스','사무','코워킹','메이커스페이스','보육실'],
};
// 지역(시·도) → 제목/기관명에서 지역색을 판별할 토큰
const REGION_TOKENS = {
  '서울':['서울','강남구','강동구','서초','송파','마포','성동','영등포','종로','용산'],
  '경기':['경기','수원','성남','용인','고양','부천','안양','화성','평택','안산','의정부','남양주','파주','김포','광명','군포','시흥','하남','이천','오산','구리','안성','포천','여주'],
  '인천':['인천'], '부산':['부산'], '대구':['대구'], '광주':['광주','북구 첨단','광산구'], '대전':['대전'],
  '울산':['울산'], '세종':['세종'], '강원':['강원','춘천','원주','강릉','속초','동해','원주','평창'],
  '충북':['충북','청주','충주','제천','충청북'], '충남':['충남','천안','아산','서산','당진','충청남'],
  '전북':['전북','전주','군산','익산','전라북'], '전남':['전남','여수','순천','목포','광양','나주','전라남'],
  '경북':['경북','포항','경주','구미','안동','경상북','칠곡'], '경남':['경남','창원','김해','진주','양산','거제','통영','경상남'],
  '제주':['제주'],
};
const NATIONWIDE_HINTS = ['전국','온라인','비대면','전지역','국내외'];
function detectRegions(text){
  const t = text || ''; const found = new Set();
  if (t.includes('수도권')) { found.add('서울'); found.add('경기'); found.add('인천'); }
  for (const [sido, toks] of Object.entries(REGION_TOKENS)) {
    for (const tk of toks) if (t.includes(tk)) { found.add(sido); break; }
  }
  return found;
}

function pick(obj, keys){ for(const k of keys) if(obj[k]!=null && String(obj[k]).trim()!=='') return obj[k]; return ''; }
function normalize(raw){
  return {
    title:  pick(raw,['biz_pbanc_nm','intg_pbanc_biz_nm','pbanc_nm']),
    org:    pick(raw,['pbanc_ntrp_nm','sprv_inst','excInsttNm']),
    target: pick(raw,['aply_trgt_ctnt','aply_trgt','pbanc_ctnt']),
    field:  pick(raw,['supt_biz_clsfc','biz_category_cd']),
    region: pick(raw,['supt_regin']),
    open:   String(pick(raw,['rcrt_prgs_yn'])).toUpperCase()==='Y',
    endDt:  pick(raw,['pbanc_rcpt_end_dt']),
    url:    pick(raw,['detl_pg_url','biz_gdnc_url']),
  };
}
function parseDt(s){ const d=String(s||'').replace(/[^0-9]/g,''); return d.length>=8?new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)):null; }
function daysLeft(e,now=new Date()){ const d=parseDt(e); return d?Math.ceil((d-now)/86400000):null; }
function hits(t,ws){ t=(t||'').toLowerCase(); let n=0; for(const w of (ws||[])) if(t.includes(w.toLowerCase())) n++; return n; }

function scoreItem(p, cond, now = new Date()) {
  const hay = `${p.title} ${p.target} ${p.field}`;
  let score = 0; const reasons = [];
  if (p.open) { score += 40; reasons.push('접수중'); }
  let fh=0; for(const f of (cond.fields||[])) fh += hits(hay, FIELD_KEYWORDS[f]||[f]);
  if (fh) { score += Math.min(30, fh*12); reasons.push('분야 적합'); }
  const sh = hits(hay, STAGE_KEYWORDS[cond.stage]||[]);
  if (sh) { score += Math.min(20, sh*12); reasons.push('단계 적합'); }
  // 필요항목(니즈) 매칭
  let nh=0; for(const n of (cond.needs||[])) nh += hits(hay, NEED_KEYWORDS[n]||[]);
  if (nh) { score += Math.min(24, nh*10); reasons.push('필요항목 적합'); }
  // 공간/입주형 공고인데 사용자가 '공간'을 원하지 않으면 감점
  if (hits(hay, NEED_KEYWORDS.space) > 0 && !(cond.needs||[]).includes('space')) score -= 22;
  const dl = daysLeft(p.endDt, now);
  if (dl!=null && dl>=0 && dl<=14) { score += 10; reasons.push('마감 임박'); }
  const nationwide = !p.region || p.region.includes('전국');
  if (cond.region && p.region && p.region.includes(cond.region)) { score += 5; reasons.push('지역 적합'); }
  const fit = Math.max(30, Math.min(99, Math.round(score)));
  return { ...p, fit, daysLeft: dl, regionType: nationwide ? '전국' : '지역', reasons };
}

// 지역 필터: 특정지역 데이터면 내 지역만, '전국'이라도 제목·기관명에 다른 지역이 박혀 있으면 제외
function regionOK(p, cond){
  if (!cond.region) return true;
  if (p.region && !p.region.includes('전국')) return p.region.includes(cond.region);
  const hay = `${p.title} ${p.org} ${p.target}`;
  if (NATIONWIDE_HINTS.some(function(h){ return hay.includes(h); })) return true; // 전국/온라인 명시 → 통과
  const found = detectRegions(hay);
  if (found.size === 0) return true;          // 지역색 없음 → 전국으로 인정
  return found.has(cond.region);              // 특정 지역색 있으면 내 지역 포함 시만
}

function buildOpen(list, cond, opts = {}) {
  const now = opts.now || new Date();
  return list.map(normalize)
    .filter(p => { const dl = daysLeft(p.endDt, now); return dl == null || dl >= 0; })
    .filter(p => regionOK(p, cond))
    .map(p => scoreItem(p, cond, now))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, opts.topN || 5)
    .map((p, i) => ({ rank:i+1, title:p.title, org:p.org, fit:p.fit, daysLeft:p.daysLeft,
      endDt:p.endDt, region:p.region, regionType:p.regionType, reasons:p.reasons, url:p.url }));
}

function buildClosed(list, cond, opts = {}) {
  const now = opts.now || new Date();
  return list.map(normalize)
    .map(p => ({ p, dl: daysLeft(p.endDt, now) }))
    .filter(x => x.dl != null && x.dl < 0 && x.dl >= -31) // 최근 1개월(31일) 이내 마감
    .map(x => scoreItem({ ...x.p, open:false }, cond, now))
    .sort((a, b) => (b.fit - a.fit) || (parseDt(b.endDt)-parseDt(a.endDt))) // 적합도순, 동점이면 최근 마감
    .slice(0, opts.topN || 3)
    .map((p, i) => ({ rank:i+1, title:p.title, org:p.org, fit:p.fit, daysLeft:p.daysLeft,
      endDt:p.endDt, region:p.region, regionType:p.regionType, closed:true,
      reasons:['마감'].concat((p.reasons||[]).filter(r=>r!=='접수중')), url:p.url }));
}

// ── ③ 대표 창업지원사업 (큐레이션, 금액 포함) : 단계 + 니즈 매칭 ──
const FLAGSHIPS = [
  { title:'예비창업패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['예비'],                 needs:['fund'],            desc:'예비창업자 사업화 자금·멘토링' },
  { title:'초기창업패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['초기'],                 needs:['fund'],            desc:'3년 이내 창업기업 사업화 지원' },
  { title:'창업도약패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 3억원',  stages:['성장기','도약기'],       needs:['fund','market'],   desc:'3~7년 도약기 사업화·성장 지원' },
  { title:'창업성장기술개발사업(디딤돌)',org:'중소벤처기업부',            amount:'최대 1.2억원',stages:['예비','초기','성장기'],  needs:['fund'],            desc:'창업기업 R&D 자금 지원' },
  { title:'창업성장기술개발사업(전략형)',org:'중소벤처기업부',            amount:'최대 6억원',  stages:['성장기','도약기'],       needs:['fund'],            desc:'성장기 기업 전략형 R&D' },
  { title:'TIPS 프로그램',              org:'중소벤처기업부·TIPS 운영사', amount:'최대 5억원',  stages:['초기','성장기','도약기'], needs:['invest2'],         desc:'민간투자 주도형 기술창업 R&D' },
  { title:'창업사관학교',                org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['초기','성장기'],         needs:['mentor','space'],  desc:'유망 창업자 집중 보육·사업화' },
  { title:'IP나래 프로그램',             org:'특허청·한국발명진흥회',      amount:'IP 전략 컨설팅', stages:['예비','초기','성장기','도약기'], needs:['mentor'],   desc:'창업기업 지식재산 전략 컨설팅' },
  { title:'아기유니콘200',              org:'중소벤처기업부',            amount:'최대 3억원+', stages:['도약기'],               needs:['invest2','global'],desc:'유망 스타트업 스케일업·글로벌' },
  { title:'글로벌 창업사관학교',         org:'중소벤처기업부·창업진흥원', amount:'글로벌 진출 지원', stages:['초기','성장기'],     needs:['global'],          desc:'글로벌 지향 창업기업 육성' },
];
function pickFlagships(cond, topN = 3) {
  const scored = FLAGSHIPS.map(f => {
    let s = 0; const why = [];
    if (f.stages.includes(cond.stage)) { s += 10; why.push('단계 적합'); }
    const need = (cond.needs || []).filter(n => f.needs.includes(n));
    if (need.length) { s += need.length * 8; why.push('필요항목 적합'); }
    let fh = 0; for (const fld of (cond.fields||[])) fh += hits(`${f.title} ${f.desc}`, FIELD_KEYWORDS[fld]||[fld]);
    if (fh) s += Math.min(6, fh*3);
    const fit = Math.max(60, Math.min(97, 60 + s * 2));
    return { ...f, _score: s, fit, why };
  });
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topN).map(f => ({
    title: f.title, org: f.org, amount: f.amount, desc: f.desc, fit: f.fit,
    reasons: f.why.length ? f.why : ['대표 사업'], url: KS,
  }));
}

// ── 개발용 샘플 ──
const soon = (d)=>{ const x=new Date(Date.now()+d*86400000); return `${x.getFullYear()}${String(x.getMonth()+1).padStart(2,'0')}${String(x.getDate()).padStart(2,'0')}`; };
const MOCK_OPEN = [
  { biz_pbanc_nm:'초기창업패키지 사업화 자금 지원', pbanc_ntrp_nm:'창업진흥원', aply_trgt_ctnt:'예비·초기창업기업 사업화 자금', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(10), detl_pg_url:KS },
  { biz_pbanc_nm:'TIPS 민간투자 주도형 기술창업', pbanc_ntrp_nm:'중기부', aply_trgt_ctnt:'투자 유치 창업기업', supt_biz_clsfc:'투자', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(20), detl_pg_url:KS },
  { biz_pbanc_nm:'용인시 창업보육센터 입주기업 모집', pbanc_ntrp_nm:'용인산업진흥원', aply_trgt_ctnt:'입주 공간 지원', supt_biz_clsfc:'시설', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(15), detl_pg_url:KS },
  { biz_pbanc_nm:'제조 스마트공장 R&D 지원', pbanc_ntrp_nm:'중기부', aply_trgt_ctnt:'제조 창업기업 기술개발', supt_biz_clsfc:'R&D', supt_regin:'전국', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(40), detl_pg_url:KS },
  { biz_pbanc_nm:'부산 스타트업 투자연계 지원', pbanc_ntrp_nm:'부산창조경제혁신센터', aply_trgt_ctnt:'부산 창업기업 투자', supt_biz_clsfc:'투자', supt_regin:'부산', rcrt_prgs_yn:'Y', pbanc_rcpt_end_dt:soon(12), detl_pg_url:KS },
];
const MOCK_CLOSED = [
  { biz_pbanc_nm:'2026 예비창업패키지 (마감)', pbanc_ntrp_nm:'창업진흥원', aply_trgt_ctnt:'예비창업자 사업화', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'N', pbanc_rcpt_end_dt:soon(-5), detl_pg_url:KS },
  { biz_pbanc_nm:'창업도약패키지 (마감)', pbanc_ntrp_nm:'창업진흥원', aply_trgt_ctnt:'도약기 사업화 자금', supt_biz_clsfc:'사업화', supt_regin:'전국', rcrt_prgs_yn:'N', pbanc_rcpt_end_dt:soon(-18), detl_pg_url:KS },
  { biz_pbanc_nm:'창업성장기술개발 디딤돌 (마감)', pbanc_ntrp_nm:'중기부', aply_trgt_ctnt:'창업기업 R&D 자금', supt_biz_clsfc:'R&D', supt_regin:'전국', rcrt_prgs_yn:'N', pbanc_rcpt_end_dt:soon(-30), detl_pg_url:KS },
];

async function callKStartup(op, params = {}) {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error('NO_KEY');
  const url = new URL(`${SERVICE_URL}/${op}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('page', String(params.page || 1));
  url.searchParams.set('perPage', String(params.perPage || 100));
  for (const [k, v] of Object.entries(params.extra || {})) if (v!=null && v!=='') url.searchParams.set(k, String(v));
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
  try {
    if (q.mock === '1' || (!process.env.DATA_GO_KR_API_KEY && q.live !== '1')) {
      return res.status(200).json({ source:'mock', cond,
        open: buildOpen(MOCK_OPEN, cond, {topN:5}), closed: buildClosed(MOCK_CLOSED, cond, {topN:3}),
        flagship: pickFlagships(cond, 3) });
    }
    const [annOpen, annClosed] = await Promise.all([
      callKStartup('getAnnouncementInformation01', { perPage: 300, extra: { rcrt_prgs_yn: 'Y' } }),
      callKStartup('getAnnouncementInformation01', { perPage: 300, extra: { rcrt_prgs_yn: 'N' } }),
    ]);
    if (q.debug === '1') return res.status(200).json({ openSample: annOpen[0]||null, closedSample: annClosed[0]||null });
    const open = buildOpen(annOpen, cond, { topN: 5 });
    const closed = buildClosed(annClosed, cond, { topN: 3 });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    return res.status(200).json({ source:'k-startup', cond, open, closed, flagship: pickFlagships(cond, 3) });
  } catch (e) {
    const msg = String(e.message || e);
    const hint =
      msg === 'NO_KEY' ? 'Vercel 환경변수 DATA_GO_KR_API_KEY 를 설정하세요.' :
      msg.startsWith('UPSTREAM') ? '키/활용신청/IP/호출한도를 확인하세요.' :
      msg.startsWith('NOT_JSON') ? 'returnType/파라미터를 확인하세요.' : '';
    return res.status(200).json({ source:'error', cond, open: [], closed: [], flagship: pickFlagships(cond, 3), warn: msg, hint });
  }
};
