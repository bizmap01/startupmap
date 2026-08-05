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
// 지역(시·도) → 제목/기관명에서 지역색을 판별할 토큰 (시·군·구 포함)
const REGION_TOKENS = {
  '서울':['서울','종로구','중구 서울','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구','관악구','서초구','강남구','송파구','강동구'],
  '경기':['경기','수원','성남','의정부','안양','부천','광명','평택','동두천','안산','고양','과천','구리','남양주','오산','시흥','군포','의왕','하남','용인','파주','이천','안성','김포','화성','광주시','여주','양평','고양시','포천','연천','가평'],
  '인천':['인천','계양구','미추홀구','부평구','연수구','남동구','서구 인천','강화군','옹진군'],
  '부산':['부산','해운대','사상구','사하구','금정구','동래구','수영구','기장군','부산진구'],
  '대구':['대구','수성구','달서구','달성군','군위군'],
  '광주':['광주','광산구','북구 광주','서구 광주','남구 광주'],
  '대전':['대전','유성구','대덕구','서구 대전'],
  '울산':['울산','울주군'],
  '세종':['세종'],
  '강원':['강원','춘천','원주','강릉','동해','태백','속초','삼척','홍천','횡성','영월','평창','정선','철원','화천','양구','인제','고성 강원','양양'],
  '충북':['충북','청주','충주','제천','보은','옥천','영동','증평','진천','괴산','음성','단양','충청북'],
  '충남':['충남','천안','공주','보령','아산','서산','논산','계룡','당진','금산','부여','서천','청양','홍성','예산','태안','충청남'],
  '전북':['전북','전주','군산','익산','정읍','남원','김제','완주','진안','무주','장수','임실','순창','고창','부안','전라북'],
  '전남':['전남','목포','여수','순천','나주','광양','담양','곡성','구례','고흥','보성','화순','장흥','강진','해남','영암','무안','함평','영광','장성','완도','진도','신안','전라남'],
  '경북':['경북','포항','경주','김천','안동','구미','영주','영천','상주','문경','경산','군위','의성','청송','영양','영덕','청도','고령','성주','칠곡','예천','봉화','울진','울릉','경상북'],
  '경남':['경남','창원','진주','통영','사천','김해','밀양','거제','양산','의령','함안','창녕','고성 경남','남해','하동','산청','함양','거창','합천','경상남'],
  '제주':['제주','서귀포'],
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
    target: pick(raw,['aply_trgt_ctnt','aply_trgt']),
    content:pick(raw,['pbanc_ctnt']),
    field:  pick(raw,['supt_biz_clsfc','biz_category_cd']),
    enyy:   pick(raw,['biz_enyy']),
    region: pick(raw,['supt_regin']),
    open:   String(pick(raw,['rcrt_prgs_yn'])).toUpperCase()==='Y',
    endDt:  pick(raw,['pbanc_rcpt_end_dt']),
    url:    pick(raw,['detl_pg_url','biz_gdnc_url']),
  };
}
// A-1 창업단계 → 공고 대상 업력(biz_enyy) 기대값
const STAGE_ENYY = {
  '예비':['예비창업'], '초기':['1년미만','2년미만','3년미만'],
  '성장기':['3년미만','5년미만','7년미만'], '도약기':['7년미만','10년미만'],
};
// A-2 니즈 → 지원분야 코드(supt_biz_clsfc)
const NEED_CLSFC = {
  fund:['사업화','융자','자금'], invest2:['투자','기술개발','R&D'],
  mentor:['멘토','컨설팅','교육','보육'], global:['글로벌'],
  space:['시설','공간','보육'], market:['판로','마케팅','행사','네트워크'],
};
// A-4 창업자 대상이 아닌 공고(주관기관·운영사·평가위원 모집 등) 부정 키워드
const NEG_KEYWORDS = ['주관기관 모집','운영기관 모집','수행기관 모집','운영사 모집','주관기관을 모집','운영기관을 모집','평가위원','심사위원','멘토 모집','강사 모집','위탁운영','용역 입찰','참여기관 모집'];
function parseDt(s){ const d=String(s||'').replace(/[^0-9]/g,''); return d.length>=8?new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)):null; }
function daysLeft(e,now=new Date()){ const d=parseDt(e); return d?Math.ceil((d-now)/86400000):null; }
function hits(t,ws){ t=(t||'').toLowerCase(); let n=0; for(const w of (ws||[])) if(t.includes(w.toLowerCase())) n++; return n; }

function scoreItem(p, cond, now = new Date()) {
  const hay = `${p.title} ${p.target} ${p.field} ${p.content||''}`;
  let score = 0; const reasons = [];
  if (p.open) { score += 35; reasons.push('접수중'); }

  // 분야
  let fh=0; for(const f of (cond.fields||[])) fh += hits(hay, FIELD_KEYWORDS[f]||[f]);
  const fieldMatched = fh>0;
  if (fh) { score += Math.min(28, fh*11); reasons.push('분야 적합'); }

  // 단계(키워드)
  const sh = hits(hay, STAGE_KEYWORDS[cond.stage]||[]);
  if (sh) { score += Math.min(15, sh*10); reasons.push('단계 적합'); }

  // A-1 업력(연차) 매칭
  if (p.enyy) {
    const want = STAGE_ENYY[cond.stage] || [];
    if (want.some(function(w){ return p.enyy.includes(w); })) { score += 15; reasons.push('업력 적합'); }
    else if (want.length) { score -= 12; }
  }

  // 니즈(텍스트) — 흔한 행정용어는 이미 NEED_KEYWORDS에서 제외됨
  let nh=0; for(const n of (cond.needs||[])) nh += hits(hay, NEED_KEYWORDS[n]||[]);
  let ch=0; for(const n of (cond.needs||[])) ch += hits(p.field, NEED_CLSFC[n]||[]);
  if (nh || ch) { score += Math.min(24, nh*7 + ch*8); reasons.push('필요항목 적합'); }

  // 공간/입주형인데 '공간' 니즈 없으면 감점
  if (hits(hay, NEED_KEYWORDS.space) > 0 && !(cond.needs||[]).includes('space')) score -= 22;

  // B-5 아이템 소개 연관 — 가점 + 게이트
  if (cond.itemKw && cond.itemKw.length) {
    let ih=0; for(const k of cond.itemKw) if (hay.includes(k)) ih++;
    if (ih) { score += Math.min(18, ih*6); reasons.push('아이템 연관'); }
    // 게이트: 아이템 키워드가 하나도 안 겹치고 분야도 안 맞으면 신뢰도 급감
    else if (!fieldMatched) { score -= 30; }
  }

  // A-4 창업자 대상 아닌 공고 감점
  if (NEG_KEYWORDS.some(function(k){ return hay.includes(k); })) score -= 25;

  const dl = daysLeft(p.endDt, now);
  if (dl!=null && dl>=0 && dl<=14) { score += 8; reasons.push('마감 임박'); }
  const nationwide = !p.region || p.region.includes('전국');
  if (cond.region && p.region && p.region.includes(cond.region)) { score += 5; reasons.push('지역 적합'); }

  const fit = Math.max(20, Math.min(99, Math.round(score)));
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
    .filter(x => regionOK(x.p, cond))                     // 지역 필터 (내 지역 + 전국)
    .map(x => scoreItem({ ...x.p, open:false }, cond, now))
    .sort((a, b) => (b.fit - a.fit) || (parseDt(b.endDt)-parseDt(a.endDt))) // 적합도순, 동점이면 최근 마감
    .slice(0, opts.topN || 3)
    .map((p, i) => ({ rank:i+1, title:p.title, org:p.org, fit:p.fit, daysLeft:p.daysLeft,
      endDt:p.endDt, region:p.region, regionType:p.regionType, closed:true,
      reasons:['마감'].concat((p.reasons||[]).filter(r=>r!=='접수중')), url:p.url }));
}

// ── ③ 대표 창업지원사업 (큐레이션, 금액 포함) : 단계 + 니즈 매칭 ──
const KS_INTEGRATED = 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancClssCd=PBC010&schM=view&pbancSn=175783'; // 통합공고(안 튕기는 링크)
const FLAGSHIPS = [
  { title:'예비창업패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['예비'],                 needs:['fund'],            kw:['예비창업패키지'],     desc:'예비창업자 사업화 자금·멘토링' },
  { title:'초기창업패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['초기'],                 needs:['fund'],            kw:['초기창업패키지'],     desc:'3년 이내 창업기업 사업화 지원' },
  { title:'창업도약패키지',              org:'중소벤처기업부·창업진흥원', amount:'최대 3억원',  stages:['성장기','도약기'],       needs:['fund','market'],   kw:['창업도약패키지','도약패키지'], desc:'3~7년 도약기 사업화·성장 지원' },
  { title:'창업성장기술개발사업(디딤돌)',org:'중소벤처기업부',            amount:'최대 1.2억원',stages:['예비','초기','성장기'],  needs:['fund'],            kw:['디딤돌','창업성장기술개발'], desc:'창업기업 R&D 자금 지원' },
  { title:'창업성장기술개발사업(전략형)',org:'중소벤처기업부',            amount:'최대 6억원',  stages:['성장기','도약기'],       needs:['fund'],            kw:['전략형','창업성장기술개발'], desc:'성장기 기업 전략형 R&D' },
  { title:'TIPS 프로그램',              org:'중소벤처기업부·TIPS 운영사', amount:'최대 5억원',  stages:['초기','성장기','도약기'], needs:['invest2'],         kw:['TIPS','팁스'],        desc:'민간투자 주도형 기술창업 R&D' },
  { title:'창업사관학교',                org:'중소벤처기업부·창업진흥원', amount:'최대 1억원',  stages:['초기','성장기'],         needs:['mentor','space'],  kw:['창업사관학교','청년창업사관학교'], desc:'유망 창업자 집중 보육·사업화' },
  { title:'IP나래 프로그램',             org:'특허청·한국발명진흥회',      amount:'IP 전략 컨설팅', stages:['예비','초기','성장기','도약기'], needs:['mentor'],   kw:['IP나래','아이피나래'], desc:'창업기업 지식재산 전략 컨설팅' },
  { title:'아기유니콘200',              org:'중소벤처기업부',            amount:'최대 3억원+', stages:['도약기'],               needs:['invest2','global'],kw:['아기유니콘'],         desc:'유망 스타트업 스케일업·글로벌' },
  { title:'글로벌 창업사관학교',         org:'중소벤처기업부·창업진흥원', amount:'글로벌 진출 지원', stages:['초기','성장기'],     needs:['global'],          kw:['글로벌 창업사관학교','글로벌창업사관학교'], desc:'글로벌 지향 창업기업 육성' },
];
// 실시간 접수공고에서 대표사업을 찾아 접수상태/링크 판정
function matchOpenStatus(f, annOpen){
  for (const raw of (annOpen || [])) {
    const nm = String(raw.biz_pbanc_nm || raw.intg_pbanc_biz_nm || '');
    if (f.kw.some(function(k){ return nm.includes(k); })) {
      return { openNow:true, url: raw.detl_pg_url || KS_INTEGRATED, endDt: raw.pbanc_rcpt_end_dt || '' };
    }
  }
  return { openNow:false, url: KS_INTEGRATED, endDt:'' };
}
function pickFlagships(cond, annOpen, topN = 3) {
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
  return scored.slice(0, topN).map(f => {
    const st = matchOpenStatus(f, annOpen);
    return {
      title: f.title, org: f.org, amount: f.amount, desc: f.desc, fit: f.fit,
      status: st.openNow ? '접수중' : '접수마감/예정',
      openNow: st.openNow, endDt: st.endDt,
      reasons: f.why.length ? f.why : ['대표 사업'], url: st.url,
    };
  });
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
    itemDesc: q.item || '',
  };
  // B-5 아이템 소개 → 변별력 있는 키워드만 추출 (흔한 행정·비즈니스 용어 제거)
  var _stop = new Set(['그리고','기반','서비스','기술','사업','사업화','창업','기업','스타트업','통해','위한','있는','하는','및','등','저희','우리','관련','제공','개발','활용','지원','지원사업','지원금','관리','모집','운영','대상','선정','참여','프로그램','지역','국내','분야','확대','강화','육성','발굴','구축','플랫폼앱','솔루션','시스템','비즈니스','아이템']);
  cond.itemKw = String(cond.itemDesc||'').split(/[^가-힣A-Za-z0-9]+/).filter(function(w){ return w.length>=2 && !_stop.has(w); }).slice(0,12);
  try {
    if (q.mock === '1' || (!process.env.DATA_GO_KR_API_KEY && q.live !== '1')) {
      return res.status(200).json({ source:'mock', cond,
        open: buildOpen(MOCK_OPEN, cond, {topN:5}), closed: buildClosed(MOCK_CLOSED, cond, {topN:3}),
        flagship: pickFlagships(cond, MOCK_OPEN, 3) });
    }
    const [annOpen, annClosed] = await Promise.all([
      callKStartup('getAnnouncementInformation01', { perPage: 300, extra: { rcrt_prgs_yn: 'Y' } }),
      callKStartup('getAnnouncementInformation01', { perPage: 300, extra: { rcrt_prgs_yn: 'N' } }),
    ]);
    if (q.debug === '1') return res.status(200).json({ openSample: annOpen[0]||null, closedSample: annClosed[0]||null });
    const open = buildOpen(annOpen, cond, { topN: 5 });
    const closed = buildClosed(annClosed, cond, { topN: 3 });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    return res.status(200).json({ source:'k-startup', cond, open, closed, flagship: pickFlagships(cond, annOpen, 3) });
  } catch (e) {
    const msg = String(e.message || e);
    const hint =
      msg === 'NO_KEY' ? 'Vercel 환경변수 DATA_GO_KR_API_KEY 를 설정하세요.' :
      msg.startsWith('UPSTREAM') ? '키/활용신청/IP/호출한도를 확인하세요.' :
      msg.startsWith('NOT_JSON') ? 'returnType/파라미터를 확인하세요.' : '';
    return res.status(200).json({ source:'error', cond, open: [], closed: [], flagship: pickFlagships(cond, [], 3), warn: msg, hint });
  }
};
