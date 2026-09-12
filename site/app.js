const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, digits = 1) => finite(v) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v) : '—';
const pct = (v) => finite(v) ? `${v > 0 ? '+' : ''}${num(v)}%` : '—';
const tone = (v) => finite(v) && v !== 0 ? v > 0 ? 'up' : 'down' : 'muted';
const compact = (v) => finite(v) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '—';
const safeURL = (v) => { try { const u = new URL(v); return u.protocol === 'https:' ? esc(u.href) : '#'; } catch { return '#'; } };
const dateText = (v) => { if (!v) return '—'; const normalized = typeof v === 'string' && /^\d{8}$/.test(v) ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6)}` : v; const d = new Date(typeof normalized === 'number' ? normalized * 1000 : normalized); return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); };
const link = (url, text, cls = 'external-link') => `<a class="${cls}" href="${safeURL(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Browser storage is unavailable. Changes last for this visit only.'); return false; } }
const saved = readStore('vector-watchlist', []);
const state = { data: null, history: [], country: 'US', view: 'screener', theme: '', cap: 1e9, setup: '', query: '', min: 0, preset: 'all', sort: 'score', direction: -1, page: 0, pageSize: 20, selected: null, detailTab: 'overview', watchlist: new Set(Array.isArray(saved) ? saved : []), filtered: [] };
const weights = { month:25, quarter:25, week:15, rvol:15, trend:10, nearHigh:10 };
const labels = { month:'1-month strength', quarter:'3-month strength', week:'1-week strength', rvol:'Relative volume', trend:'Trend alignment', nearHigh:'52-week high proximity' };
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function market() { return state.data?.markets?.[state.country] ?? { stocks: [], themes: [] }; }
function capUniverse() { return market().stocks.filter(s=>state.cap===0||(finite(s.marketCapUsd)&&s.marketCapUsd>=state.cap)); }
function industryGroups() {
  const buckets=new Map();
  for(const s of capUniverse()){if(!finite(s.score))continue;const name=s.industry||'Unclassified';if(!buckets.has(name))buckets.set(name,[]);buckets.get(name).push(s);}
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return [...buckets].map(([name,stocks])=>({name,count:stocks.length,score:mean(stocks.map(s=>s.score)),week:mean(stocks.map(s=>s.week).filter(finite)),breadth:Math.round(100*stocks.filter(s=>s.trend>=66.6).length/stocks.length),delta:mean(stocks.map(s=>s.scoreDelta).filter(finite)),leaders:[...stocks].sort((a,b)=>b.score-a.score).slice(0,4).map(s=>s.id)})).sort((a,b)=>b.score-a.score);
}
function currentStock() { return market().stocks.find(s => s.id === state.selected); }
function scoreBadge(score) { return `<span class="score-block ${score < 50 ? 'low' : score < 80 ? 'mid' : ''}">${num(score,0)}</span>`; }
function upcoming(s) { const days = finite(s.earnings) ? (s.earnings * 1000 - Date.now()) / 86400000 : null; return days !== null && days >= 0 && days <= 14; }
function renderMarket() {
  const m = market(), stocks = capUniverse();
  $$('.country-tabs button').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.country === state.country)));
  const age = m.asOf ? (Date.now()-new Date(m.asOf).valueOf())/3600000 : Infinity;
  $('#scan-status').textContent = m.asOf ? `Collected ${new Date(m.asOf).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}` : 'No successful snapshot';
  $('#market-note').textContent = `Market caps in USD · quotes in ${state.country === 'KR' ? 'KRW' : state.country === 'CA' ? 'CAD' : 'USD'}`;
  const warnings = [];
  if (m.status !== 'ok') warnings.push(m.error || 'This market is unavailable.');
  if (age > 36) warnings.push('Snapshot is over 36 hours old. Check the daily scan before relying on it.');
  if (m.truncated) warnings.push('Scanner universe exceeds the 20,000-record safety cap. Coverage is incomplete.');
  $('#notice').hidden = !warnings.length;
  $('#notice').textContent = warnings.join(' ');
  const strong = stocks.filter(s=>s.score>=80).length;
  const trendAvailable = stocks.filter(s=>finite(s.trend));
  const breadth = trendAvailable.length ? 100*trendAvailable.filter(s=>s.trend>=66.6).length/trendAvailable.length : null;
  const surges = stocks.filter(s=>s.rvol>=2).length;
  $('#metrics').innerHTML = [
    ['In your universe',compact(stocks.length),state.cap?`Market cap ≥ US$${compact(state.cap)}`:'All market caps · unknown included',`${compact(m.stocks.length)} scanned`],
    ['Strong momentum',compact(strong),'Score ≥ 80 · within this country',`${stocks.length ? num(strong/stocks.length*100,0) : '—'}% of universe`],
    ['Trend breadth',`${num(breadth,0)}%`,'Above at least 2 of 3 moving averages','20 / 50 / 200D'],
    ['Volume surges',compact(surges),'Trading at ≥ 2× relative volume','10-day baseline']
  ].map(([label,value,note,extra])=>`<div class="metric"><div class="metric-label">${esc(label)}<span aria-hidden="true">↗</span></div><div class="metric-value">${esc(value)}<small>${esc(extra)}</small></div><div class="metric-note">${esc(note)}</div></div>`).join('');
  $('#theme-strip').innerHTML = industryGroups().filter(t=>t.count>=3).slice(0,5).map(t=>`<button class="theme-card ${state.theme===t.name?'selected':''}" data-theme="${esc(t.name)}"><div class="theme-top">${esc(t.name)} <span class="muted">↗</span></div><div class="theme-number">${num(t.score,0)}<span class="${tone(t.week)}">${pct(t.week)} / 1W</span></div><div class="track"><i style="width:${t.breadth}%"></i></div><div class="theme-meta">${t.count} stocks · ${t.breadth}% in trend</div></button>`).join('');
  $('#theme-filter').innerHTML = '<option value="">All industries</option>' + industryGroups().map(t=>`<option value="${esc(t.name)}" ${state.theme===t.name?'selected':''}>${esc(t.name)} (${t.count})</option>`).join('');
  $('#footer-coverage').textContent = `Snapshot data · prices may be delayed · ${compact(m.turnoverFloor)} native-currency daily turnover floor · not investment advice`;
  renderView();
}
function filterStocks() {
  const q = state.query.toLocaleLowerCase().trim();
  const rows = capUniverse().filter(s=>{
    if (state.view==='watchlist'&&!state.watchlist.has(s.id)) return false;
    if (q&&!`${s.symbol} ${s.name} ${s.localName??''} ${s.industry} ${s.themes.join(' ')} ${s.news.map(n=>n.title).join(' ')}`.toLocaleLowerCase().includes(q)) return false;
    if (state.theme&&!s.themes.includes(state.theme)) return false;
    if (state.setup&&s.setup!==state.setup) return false;
    if (state.min>0&&(!finite(s.score)||s.score<state.min)) return false;
    if (state.preset==='leaders'&&(!finite(s.score)||s.score<80)) return false;
    if (state.preset==='volume'&&(!finite(s.rvol)||s.rvol<2)) return false;
    if (state.preset==='improving'&&(!finite(s.scoreDelta)||s.scoreDelta<3)) return false;
    if (state.preset==='earnings'&&!upcoming(s)) return false;
    return true;
  });
  rows.sort((a,b)=>{
    const av=a[state.sort],bv=b[state.sort];
    if (av==null&&bv==null) return a.id.localeCompare(b.id);
    if (av==null) return 1;
    if (bv==null) return -1;
    return (typeof av==='string'?av.localeCompare(bv):av-bv)*state.direction || a.id.localeCompare(b.id);
  });
  return rows;
}
function renderView() {
  $$('.topbar nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('#watch-count').textContent=state.watchlist.size;
  $('#screen-view').hidden=state.view==='themes';
  $('#radar-view').hidden=state.view!=='themes';
  $('#list-title').textContent=state.view==='watchlist'?'Your watchlist':state.theme||'Momentum leaders';
  if(state.view==='themes') renderRadar(); else renderTable();
}
function renderTable() {
  state.filtered=filterStocks();
  const pages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
  state.page=Math.max(0,Math.min(state.page,pages-1));
  const rows=state.filtered.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);

  $('#result-count').textContent=`${state.filtered.length.toLocaleString()} matches`;
  $$('.quick-filters button').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));
  const empty=state.view==='watchlist'?'Star a stock to save it here. Watchlists stay in this browser.':state.preset==='improving'&&!state.history.some(h=>h.date<state.data.generatedAt.slice(0,10))?'Acceleration appears after snapshots from two different days are available.':'No stocks match. Try clearing a filter.';
  $('#stocks-body').innerHTML=rows.length?rows.map(s=>`<tr class="${s.id===state.selected?'selected':''}" data-stock="${esc(s.id)}"><td><button class="star ${state.watchlist.has(s.id)?'on':''}" data-star="${esc(s.id)}" aria-label="${state.watchlist.has(s.id)?'Remove':'Add'} ${esc(s.symbol)} ${state.watchlist.has(s.id)?'from':'to'} watchlist" aria-pressed="${state.watchlist.has(s.id)}">${state.watchlist.has(s.id)?'★':'☆'}</button></td><td>${s.rank??'—'}</td><td class="company-cell"><button class="company-button" data-select="${esc(s.id)}">${esc(s.symbol)} <span class="row-open" aria-hidden="true">↗</span></button><span class="company-name" title="${esc(s.name)}">${esc(s.name)}</span></td><td><button class="industry-link" data-theme="${esc(s.industry||'Unclassified')}">${esc(s.industry||'Unclassified')}</button><span class="story-tag">${esc((s.narratives??[]).join(' · '))}</span></td><td class="cap-cell" data-cap="${s.marketCapUsd??''}" title="${finite(s.marketCapUsd)?'US$'+num(s.marketCapUsd,0):'USD market cap unavailable'}">${finite(s.marketCapUsd)?'$'+compact(s.marketCapUsd):'—'}</td><td><div class="score-cell">${scoreBadge(s.score)}<span class="score-delta ${tone(s.scoreDelta)}" title="Change since the previous daily snapshot">${finite(s.scoreDelta)?`${s.scoreDelta>0?'+':''}${num(s.scoreDelta,0)}`:'—'}</span></div></td><td><span class="currency">${esc(s.currency)}</span>${num(s.price,s.currency==='KRW'?0:2)}</td>${['day','week','month','quarter'].map(k=>`<td class="${tone(s[k])}">${pct(s[k])}</td>`).join('')}<td class="${s.rvol>=2?'up':''}">${num(s.rvol)}×</td><td><span class="setup ${s.setup==='Extended'?'extended':''}">${esc(s.setup)}${upcoming(s)?'<span class="earnings-flag">Earnings ≤ 14d</span>':''}</span></td></tr>`).join(''):`<tr><td colspan="13" class="empty">${esc(empty)}</td></tr>`;

  $('#pagination-label').textContent=state.filtered.length?`${state.page*state.pageSize+1}–${Math.min((state.page+1)*state.pageSize,state.filtered.length)} of ${state.filtered.length.toLocaleString()} · click a company to research`:'No matches';
  $('#prev-page').disabled=state.page===0;
  $('#next-page').disabled=state.page>=pages-1;
}
function selectStock(id) {
  state.selected=id;state.detailTab='overview';renderTable();
  const opener=$$('[data-select]').find(b=>b.dataset.select===id);if(opener)opener.focus();
  renderDetail();if(!$('#stock-dialog').open)$('#stock-dialog').showModal();
  mountChart(currentStock());
}
function renderDetail() {
  const s=currentStock();if(!s)return;
  $('#stock-detail').innerHTML=`<div class="detail-head"><div class="stock-identity"><div><h2 class="detail-symbol">${esc(s.symbol)} <span>${esc(s.exchange)}</span></h2><div class="detail-name">${esc(s.name)}</div><div class="detail-tags"><span class="pill">${esc(s.industry||'Unclassified')}</span>${(s.narratives??[]).map(t=>`<span class="pill narrative">${esc(t)}</span>`).join('')}</div></div><div class="stock-price-block"><div class="detail-price">${num(s.price,s.currency==='KRW'?0:2)} <span class="muted">${esc(s.currency)}</span><span class="${tone(s.day)}">${pct(s.day)}</span></div><div class="muted">Market cap ${finite(s.marketCapUsd)?'US$'+compact(s.marketCapUsd):'unavailable'}</div></div><button class="star ${state.watchlist.has(s.id)?'on':''}" data-star="${esc(s.id)}" aria-label="Toggle ${esc(s.symbol)} watchlist" aria-pressed="${state.watchlist.has(s.id)}">${state.watchlist.has(s.id)?'★':'☆'}</button></div></div><div class="stock-popup-layout"><section class="stock-chart-panel" aria-label="TradingView price chart"><div id="tradingview-chart" class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright">${link('https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s.id),s.symbol+' chart by TradingView ↗','text-button')}</div></div><p class="chart-disclosure">Interactive TradingView chart · exchange availability and delays apply. ${link('https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s.id),'Open full chart ↗','text-button')}</p></section><section class="stock-research-panel"><div class="detail-tabs" role="tablist" aria-label="Stock research tabs">${[['overview','Overview'],['story','Story & news'],['insider','Insiders']].map(([id,label])=>`<button role="tab" aria-selected="${state.detailTab===id}" class="${state.detailTab===id?'active':''}" data-detail-tab="${id}">${label}</button>`).join('')}</div><div class="detail-content"></div></section></div>`;
  renderResearch(s);
}
function renderResearch(s=currentStock()) {
  if(!s)return;
  $$('.detail-tabs button').forEach(b=>{b.classList.toggle('active',b.dataset.detailTab===state.detailTab);b.setAttribute('aria-selected',String(b.dataset.detailTab===state.detailTab));});
  $('#stock-detail .detail-content').innerHTML=state.detailTab==='overview'?overview(s):state.detailTab==='story'?story(s):insider(s);
  $('#stock-detail .stock-research-panel').scrollTop=0;
  const note=$('#stock-note');if(note){note.value=readStore('vector-notes',{})[s.id]??'';note.addEventListener('input',()=>{const all=readStore('vector-notes',{});all[s.id]=note.value;saveStore('vector-notes',all);});}
}
function mountChart(s) {
  if(!s)return;
  const host=$('#tradingview-chart');
  const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;
  script.textContent=JSON.stringify({autosize:true,symbol:s.id,interval:'D',timezone:'Etc/UTC',theme:'dark',style:'1',locale:'en',backgroundColor:'#111519',gridColor:'rgba(146,157,165,0.08)',allow_symbol_change:false,hide_side_toolbar:false,hide_top_toolbar:false,hide_volume:false,withdateranges:true,save_image:true,calendar:false,details:false,support_host:'https://www.tradingview.com'});
  script.onerror=()=>{if(host.isConnected)host.querySelector('.tradingview-widget-container__widget').innerHTML='<div class="empty">TradingView could not load. Use the full-chart link below.</div>';};
  host.appendChild(script);
}
function overview(s) {
  const stats=[['Market cap · USD',finite(s.marketCapUsd)?'$'+compact(s.marketCapUsd):'—'],['Revenue growth',pct(s.revenueGrowth)],['1-week return',pct(s.week)],['3-month return',pct(s.quarter)],['P/E (TTM)',num(s.pe)],['RSI (14)',num(s.rsi,0)],['From 52W high',finite(s.nearHigh)?pct((s.nearHigh-1)*100):'—'],['Earnings date',dateText(s.earnings)]];
  return `<div class="research-score"><div><div class="eyebrow">MOMENTUM</div><strong>${num(s.score,0)}<small>/ 100</small></strong></div><div><span class="pill">${esc(s.setup)}</span><p class="muted">Country rank #${s.rank??'—'}</p></div></div><dl class="data-grid">${stats.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="detail-section"><h3>What drives the score</h3>${Object.keys(weights).map(k=>`<div class="component"><span>${labels[k]} · ${weights[k]}%</span><div class="track"><i style="width:${s.components[k]??0}%"></i></div><b>${num(s.components[k],0)}</b></div>`).join('')}<p>${s.coverage}% input coverage. ${finite(s.scoreDelta)?`Change of ${num(s.scoreDelta)} points since the previous scan day.`:'Daily changes appear after a second scan day.'}</p>${finite(s.extension)&&s.extension>15?`<p class="down">Extended: ${num(s.extension)}% above the 20-day average.</p>`:''}</div>`;
}
function story(s) {
  const evidence=s.themeEvidence??[];
  const notes=state.history.filter(h=>h.stocks?.[s.id]).slice(-6);
  return `<h3>The narrative behind the ticker</h3><p>Industry membership uses the company’s reported FactSet industry. Curated narratives and headline signals are separate research leads; they never change industry membership.</p>${(s.catalysts??[]).length?'<div class="detail-section"><h3>Headline signals · unverified</h3><p>'+s.catalysts.map(c=>esc(c.name)+' ('+c.headlineCount+')').join(' · ')+'</p></div>':''}${evidence.map(e=>`<div class="detail-section"><h3>${esc(e.theme)}</h3><p>${esc(e.basis)}${e.keyword?` · matched “${esc(e.keyword)}”`:''}${e.headlines?` · ${e.headlines} matching headline${e.headlines>1?'s':''}`:''}</p></div>`).join('')}<div class="detail-section"><h3>Latest coverage <span class="muted">/ 7 days</span></h3><p>${esc(s.newsStatus)}</p>${s.news.length?s.news.map(n=>`<a href="${safeURL(n.url)}" class="article" target="_blank" rel="noopener noreferrer">${esc(n.title)}<small>${esc(n.source)} · ${dateText(n.published)} ↗</small></a>`).join(''):'<p>No headlines collected for this stock in this snapshot.</p>'}${link('https://news.google.com/search?q='+encodeURIComponent(s.name+' stock'),'Search current news ↗')}</div><div class="detail-section"><h3>Recent momentum</h3>${notes.length>1?notes.map(h=>`<div class="component"><span>${esc(h.date)}</span><span class="muted">rank ${h.stocks[s.id].rank??'—'}</span><b>${num(h.stocks[s.id].score,0)}</b></div>`).join(''):'<p>History builds with each successful daily scan. No backfilled scores are implied.</p>'}</div><label class="notes-label" for="stock-note">Your thesis <span class="muted">· private to this browser</span></label><textarea class="research-note" id="stock-note" placeholder="What is the catalyst? What would change your mind?"></textarea>`;
}
function insider(s) {
  const data=s.insider??{};
  const urls=s.country==='US'?[['https://www.sec.gov/edgar/search/#/q='+encodeURIComponent(s.name)+'&filter_forms=4','Search SEC Form 4 filings ↗']]:s.country==='CA'?[['https://www.sedi.ca/','Open Canadian insider reports · SEDI ↗'],['https://www.sedarplus.ca/','Open issuer disclosures · SEDAR+ ↗']]:[['https://dart.fss.or.kr/','Open Korean disclosures · DART ↗']];
  return `<h3>Ownership & disclosures</h3><p>${esc(data.status??'Unavailable')}</p>${data.asOf?`<p>Checked ${dateText(data.asOf)} · ${esc(data.source)}</p>`:''}${!(data.transactions?.length||data.filings?.length)?`<div class="detail-section"><p>${s.country==='US'?'No verified transaction records were collected for this issuer. Nasdaq coverage is collected for daily leaders and configured focus symbols. SEC filings can be added through repository setup.':s.country==='CA'?'An automated Canadian insider feed is not connected. Use SEDI to review reported transactions.':'DART ownership data requires an API key. Holdings changes must not be interpreted as open-market trades.'}</p></div>`:''}${(data.transactions??[]).map(t=>`<div class="insider-row"><span class="${t.code==='P'||t.side==='buy'?'up':t.code==='S'||t.side==='sell'?'down':'muted'}">${esc(t.type)}${t.code?' · '+esc(t.code):''}</span> ${esc(t.owner)}<small>${dateText(t.date)} · ${compact(t.shares)} shares · ${finite(t.value)?`${compact(t.value)} USD`:'value not reported'}</small>${link(t.url,t.code?'Read source filing ↗':'View source transactions ↗')}</div>`).join('')}<div class="detail-section"><h3>Source documents</h3>${(data.filings??[]).map(f=>link(f.url,`${f.type} · ${dateText(f.date)} ↗`)).join('')}${urls.map(([url,label])=>link(url,label)).join('')}<p>A missing record is not evidence of no insider activity. Awards, exercises and gifts are separate from purchases and sales.</p></div>`;
}
function renderRadar() {
  const groups=industryGroups();
  const themes=groups.filter(t=>t.count>=3).slice(0,10);
  const colors=['#c9f484','#8bd1dd','#d5acf5','#ebbc82','#8fb0ed','#e6a0bc','#a4d7bd','#c4c7a1','#b5acd8','#cbb8a3'];
  $('#radar-chart').innerHTML=`<svg viewBox="0 0 1100 400" role="img" aria-label="Industry momentum versus trend breadth. Circle size represents member count. Colors match the legend."><text x="20" y="20" fill="#929da5" font-size="12">MOMENTUM SCORE</text>${[0,25,50,75,100].map(n=>`<line x1="60" x2="750" y1="${350-n*3}" y2="${350-n*3}" stroke="#263037"/><text x="42" y="${354-n*3}" text-anchor="end" fill="#929da5" font-size="12">${n}</text><line x1="${60+n*6.9}" x2="${60+n*6.9}" y1="50" y2="350" stroke="#202930"/><text x="${60+n*6.9}" y="375" text-anchor="middle" fill="#929da5" font-size="12">${n}%</text>`).join('')}<text x="750" y="396" text-anchor="end" fill="#929da5" font-size="12">TREND BREADTH →</text><text x="790" y="40" fill="#929da5" font-size="12">INDUSTRIES / CLICK TO EXPLORE</text>${themes.map((t,i)=>`<g data-radar-theme="${esc(t.name)}" tabindex="0" role="button" aria-label="Explore ${esc(t.name)}" style="cursor:pointer"><circle cx="${60+t.breadth*6.9}" cy="${350-t.score*3}" r="${Math.min(25,7+Math.sqrt(t.count))}" fill="${colors[i%colors.length]}" fill-opacity=".22" stroke="${colors[i%colors.length]}" stroke-width="1.5"><title>${esc(t.name)}: score ${t.score}, breadth ${t.breadth}%, ${t.count} stocks</title></circle><circle cx="798" cy="${66+i*29}" r="4" fill="${colors[i%colors.length]}"/><text x="815" y="${70+i*29}" fill="${colors[i%colors.length]}" font-size="13">${esc(t.name)}</text></g>`).join('')}</svg>`;

  $('#theme-grid').innerHTML=groups.map((t,i)=>`<article class="radar-card"><div class="eyebrow" style="color:${colors[i%colors.length]}">${String(i+1).padStart(2,'0')} / ${t.count} STOCKS</div><h3>${esc(t.name)}</h3><div class="radar-stats"><div>Momentum<b>${num(t.score,0)}</b></div><div>Breadth<b>${t.breadth}%</b></div><div>1-week return<b class="${tone(t.week)}">${pct(t.week)}</b></div></div><div class="track"><i style="width:${t.breadth}%;background:${colors[i%colors.length]}"></i></div><p class="theme-meta">${finite(t.delta)?`${t.delta>0?'+':''}${num(t.delta)} avg. member score points vs. prior scan`:'Member-score changes build across daily snapshots'}</p><div>${t.leaders.map(id=>`<button class="leader-chip" data-leader="${esc(id)}">${esc(id.split(':')[1])} ↗</button>`).join('')}</div><button class="text-button" data-theme="${esc(t.name)}">Explore ${t.count} stocks →</button></article>`).join('');
}
function openMethod() {
  $('#method-content').innerHTML=`<h3>Momentum, with the math visible</h3><p>Scores run from 0 to 100. Each stock is compared with other eligible stocks listed in the same country. These are relative strength rankings, not probabilities or price targets.</p><ul>${Object.entries(weights).map(([k,w])=>`<li><b>${w}% ${labels[k]}</b> — ${k==='trend'?'fraction of 20-, 50- and 200-day averages below the current price.':k==='nearHigh'?'percentile of price divided by the 52-week high.':k==='rvol'?'percentile of TradingView’s 10-day relative volume.':'percentile of the corresponding price return.'}</li>`).join('')}</ul><p>Ties share a percentile. Missing components are omitted and remaining weights rescaled; below 70% input coverage a stock is unscored. Scores are ranked against the whole eligible country universe, regardless of your current filters. Listings define the country grouping; this is not issuer domicile.</p><h3>Setups & industries</h3><p><b>Near breakout:</b> within 3% of the 52-week high and relative volume ≥ 1.3×. <b>Trending:</b> price above at least two moving averages and a positive month. <b>Extended:</b> more than 15% above the 20-day average; this label takes priority. <b>Accelerating:</b> score up at least 3 points from the preceding successful scan day.</p><p>Industry scores are equal-weight averages within the selected USD market-cap universe. Each stock belongs to exactly one FactSet industry supplied by TradingView. This is a detailed industry classification, not GICS and not a broad industry group. Curated narrative tags and unverified headline signals are separate and never determine industry membership. The chart shows the 10 strongest industries with at least 3 members; cards include every industry. Breadth is the share above at least two moving averages. Changes average available member score changes; returns are descriptive averages, not portfolio returns.</p><h3>Market cap & coverage</h3><p>The default minimum is US$1 billion, across all countries. Market caps are explicitly requested in USD from TradingView; quote prices stay in their listing currency. Unknown USD market caps are excluded while a minimum is active. Reset restores US$1B+. A size threshold is not a guarantee of business quality. Scoring still compares the entire liquid country universe; market-cap filters only change which stocks and industries you see.</p><h3>Coverage & schedule</h3><p>Primary common shares, up to 20,000 source records per country before liquidity filtering. Approximate daily turnover is current price × average 10-day volume. Minimums: US 1 million, Canada 250 thousand, Korea 500 million, in each listing’s quote currency. Microcaps, illiquid stocks, preferred shares and secondary listings may be excluded.</p><p>The repository workflow is configured for 23:17 UTC daily, after the regular sessions in all three markets, and can be run manually in GitHub Actions. GitHub may delay scheduled runs. Market timestamps remain visible; failed sources retain the last successful snapshot. Browser refresh only reloads the published snapshot. History holds up to 90 scan days; there is no reconstructed historical score backtest.</p><h3>Data sources</h3>${state.data.sources.map(s=>`<div class="source"><div>${link(s.url,s.name,'text-button')}<span>${esc(s.status)}</span></div><p>${esc(s.detail)}</p></div>`).join('')}<h3>Your local research</h3><p>Stars and thesis notes are stored in this browser. They are not sent to GitHub and do not sync across devices. To include a stock in daily news/chart collection, add its exchange-qualified symbol to the repository’s focus list. No API keys are stored in the website.</p>${link('https://github.com/patrickdx/momentum-terminal/actions','Open scan & deployment runs ↗')}`;
  $('#method-dialog').showModal();
}
function resetFilters() {state.cap=1e9;$('#cap-filter').value='1000000000';state.query='';state.theme='';state.setup='';state.min=0;state.preset='all';state.page=0;$('#search').value='';$('#theme-filter').value='';$('#setup-filter').value='';$('#min-score').value='0';}
function switchCountry(country){const cap=state.cap;state.country=country;state.selected=null;resetFilters();state.cap=cap;$('#cap-filter').value=String(cap);renderMarket();}
function exportCSV(){
  const keys=['rank','id','name','country','currency','score','scoreDelta','price','day','week','month','quarter','rvol','setup','marketCapUsd','industry','sector','asOf'];
  const cell=(v)=>`"${String(v??'').replace(/^[=+\-@\t\r]/,m=>"'"+m).replaceAll('"','""')}"`;
  const csv=[keys.join(','),...state.filtered.map(s=>keys.map(k=>cell(s[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download=`vector-${state.country}-${state.data.generatedAt.slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadData() {
  $('#refresh').disabled=true;
  try {
    const response=await fetch(new URL('./data/latest.json',import.meta.url),{cache:'no-store'});
    if(!response.ok)throw Error(`Snapshot request returned ${response.status}`);
    const data=await response.json();
    if(![1,2].includes(data.schemaVersion)||!data.markets)throw Error('Snapshot format is unsupported');
    state.data=data;
    try {const r=await fetch(new URL('./data/recent.json',import.meta.url),{cache:'no-store'});state.history=r.ok?await r.json():[];}catch{state.history=[];}
    renderMarket();
  } catch(error) {
    $('#notice').hidden=false;$('#notice').textContent=`Could not load the daily snapshot. ${error.message}. Try Refresh data.`;
    if(!state.data){$('#scan-status').textContent='Snapshot unavailable';$('#stocks-body').innerHTML='<tr><td colspan="13" class="empty">No market data is loaded. Retry after the daily snapshot is published.</td></tr>';}
  } finally {$('#refresh').disabled=false;}
}
document.addEventListener('click',(e)=>{
  const b=e.target.closest('button');
  if(!b||!state.data)return;
  if(b.dataset.country){switchCountry(b.dataset.country);return;}
  if(b.dataset.view){state.view=b.dataset.view;state.page=0;renderView();return;}
  if(b.dataset.star){const id=b.dataset.star;state.watchlist.has(id)?state.watchlist.delete(id):state.watchlist.add(id);saveStore('vector-watchlist',[...state.watchlist]);$('#watch-count').textContent=state.watchlist.size;renderTable();$$('#stock-detail [data-star]').forEach(el=>{el.classList.toggle('on',state.watchlist.has(id));el.textContent=state.watchlist.has(id)?'★':'☆';el.setAttribute('aria-pressed',String(state.watchlist.has(id)));});return;}
  if(b.dataset.select){selectStock(b.dataset.select);return;}
  if(b.dataset.detailTab){state.detailTab=b.dataset.detailTab;renderResearch();return;}
  if(b.dataset.theme){state.view='screener';state.theme=b.dataset.theme;state.page=0;$('#theme-filter').value=state.theme;renderMarket();return;}
  if(b.dataset.leader){selectStock(b.dataset.leader);return;}
  if(b.dataset.sort){state.direction=state.sort===b.dataset.sort?-state.direction:(['name','rank','industry'].includes(b.dataset.sort)?1:-1);state.sort=b.dataset.sort;state.page=0;renderTable();return;}
  if(b.dataset.preset){state.preset=b.dataset.preset;state.page=0;renderTable();return;}
});
$('#stocks-body').addEventListener('click',e=>{if(e.target.closest('button'))return;const row=e.target.closest('[data-stock]');if(row){selectStock(row.dataset.stock);}});
$('#cap-filter').addEventListener('change',e=>{state.cap=Number(e.target.value);state.page=0;state.theme='';renderMarket();});
$('#close-stock').addEventListener('click',()=>$('#stock-dialog').close());
$('#stock-dialog').addEventListener('close',()=>{$('#stock-detail').innerHTML='';});
$('#stock-dialog').addEventListener('click',e=>{if(e.target===$('#stock-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#search').addEventListener('input',e=>{state.query=e.target.value;state.page=0;if(state.data)renderTable();});
$('#theme-filter').addEventListener('change',e=>{state.theme=e.target.value;state.page=0;renderTable();});
$('#setup-filter').addEventListener('change',e=>{state.setup=e.target.value;state.page=0;renderTable();});
$('#min-score').addEventListener('input',e=>{state.min=Math.max(0,Math.min(100,Number(e.target.value)||0));state.page=0;if(state.data)renderTable();});
$('#reset').addEventListener('click',()=>{resetFilters();if(state.data)renderMarket();});
$('#prev-page').addEventListener('click',()=>{state.page--;renderTable();});
$('#next-page').addEventListener('click',()=>{state.page++;renderTable();});
$('#all-themes').addEventListener('click',()=>{if(state.data){state.view='themes';renderView();}});
$('#sources-button').addEventListener('click',()=>{if(state.data)openMethod();});
$('#close-dialog').addEventListener('click',()=>$('#method-dialog').close());
$('#method-dialog').addEventListener('click',e=>{if(e.target===$('#method-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#radar-chart').addEventListener('click',e=>{const item=e.target.closest('[data-radar-theme]');if(item){state.theme=item.dataset.radarTheme;state.view='screener';state.page=0;renderMarket();}});
$('#radar-chart').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
$('#export').addEventListener('click',()=>{if(state.data)exportCSV();});
$('#refresh').addEventListener('click',()=>loadData());
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#method-dialog').open&&!$('#stock-dialog').open){e.preventDefault();if(state.view==='themes'){state.view='screener';renderView();}$('#search').focus();}});
loadData();
