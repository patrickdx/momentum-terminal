const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, digits = 1) => finite(v) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v) : '—';
const pct = (v) => finite(v) ? `${v > 0 ? '+' : ''}${num(v)}%` : '—';
const tone = (v) => finite(v) && v !== 0 ? v > 0 ? 'up' : 'down' : 'muted';
const compact = (v) => finite(v) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '—';
const safeURL = (v) => { try { const u = new URL(v); return u.protocol === 'https:' ? esc(u.href) : '#'; } catch { return '#'; } };
const dateText = (v) => { if (!v) return '—'; const d = new Date(typeof v === 'number' ? v * 1000 : v); return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); };
const link = (url, text, cls = 'external-link') => `<a class="${cls}" href="${safeURL(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Browser storage is unavailable. Changes last for this visit only.'); return false; } }
const saved = readStore('vector-watchlist', []);
const state = { data: null, history: [], country: 'US', view: 'screener', theme: '', setup: '', query: '', min: 0, preset: 'all', sort: 'score', direction: -1, page: 0, pageSize: 20, selected: null, detailTab: 'overview', watchlist: new Set(Array.isArray(saved) ? saved : []), filtered: [] };
const weights = { month:25, quarter:25, week:15, rvol:15, trend:10, nearHigh:10 };
const labels = { month:'1-month strength', quarter:'3-month strength', week:'1-week strength', rvol:'Relative volume', trend:'Trend alignment', nearHigh:'52-week high proximity' };
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function market() { return state.data?.markets?.[state.country] ?? { stocks: [], themes: [] }; }
function currentStock() { return market().stocks.find(s => s.id === state.selected); }
function scoreBadge(score) { return `<span class="score-block ${score < 50 ? 'low' : score < 80 ? 'mid' : ''}">${num(score,0)}</span>`; }
function upcoming(s) { const days = finite(s.earnings) ? (s.earnings * 1000 - Date.now()) / 86400000 : null; return days !== null && days >= 0 && days <= 14; }
function chartSVG(points) {
  if (points.length < 2) return '<div class="empty">Price history unavailable</div>';
  const values = points.map(p=>p.close), lo = Math.min(...values), hi = Math.max(...values), spread = hi - lo || 1;
  const pointsString = values.map((v,i)=>`${(i/(values.length-1)*300+2).toFixed(2)},${(112-(v-lo)/spread*100).toFixed(2)}`).join(' ');
  const color = values.at(-1) >= values[0] ? '#a9da88' : '#ed9393';
  return `<svg class="price-chart" viewBox="0 0 304 132" role="img" aria-label="Daily closing prices from ${esc(points[0].date)} to ${esc(points.at(-1).date)}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${[15,60,112].map(y=>`<line x1="0" x2="304" y1="${y}" y2="${y}" stroke="#263037" stroke-dasharray="3 4"/>`).join('')}<polygon points="2,128 ${pointsString} 302,128" fill="url(#chart-fill)"/><polyline points="${pointsString}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><text x="2" y="130" fill="#929da5" font-size="9">${esc(dateText(points[0].date))}</text><text x="302" y="130" text-anchor="end" fill="#929da5" font-size="9">${esc(dateText(points.at(-1).date))}</text></svg>`;
}
function renderMarket() {
  const m = market(), stocks = m.stocks;
  $$('.country-tabs button').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.country === state.country)));
  const age = m.asOf ? (Date.now()-new Date(m.asOf).valueOf())/3600000 : Infinity;
  $('#scan-status').textContent = m.asOf ? `Collected ${new Date(m.asOf).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}` : 'No successful snapshot';
  $('#market-note').textContent = `${state.country === 'KR' ? 'KRW' : state.country === 'CA' ? 'CAD' : 'USD'} base market · primary common shares`;
  const warnings = [];
  if (m.status !== 'ok') warnings.push(m.error || 'This market is unavailable.');
  if (age > 36) warnings.push('Snapshot is over 36 hours old. Check the daily scan before relying on it.');
  if (m.truncated) warnings.push('Scanner universe exceeds the 5,000-record cap. Coverage is incomplete.');
  $('#notice').hidden = !warnings.length;
  $('#notice').textContent = warnings.join(' ');
  const strong = stocks.filter(s=>s.score>=80).length;
  const trendAvailable = stocks.filter(s=>finite(s.trend));
  const breadth = trendAvailable.length ? 100*trendAvailable.filter(s=>s.trend>=66.6).length/trendAvailable.length : null;
  const surges = stocks.filter(s=>s.rvol>=2).length;
  $('#metrics').innerHTML = [
    ['Stocks scanned',compact(stocks.length),'Liquidity-screened primary listings',`${compact(m.universe)} in source`],
    ['Strong momentum',compact(strong),'Score ≥ 80 · within this country',`${stocks.length ? num(strong/stocks.length*100,0) : '—'}% of universe`],
    ['Trend breadth',`${num(breadth,0)}%`,'Above at least 2 of 3 moving averages','20 / 50 / 200D'],
    ['Volume surges',compact(surges),'Trading at ≥ 2× relative volume','10-day baseline']
  ].map(([label,value,note,extra])=>`<div class="metric"><div class="metric-label">${esc(label)}<span aria-hidden="true">↗</span></div><div class="metric-value">${esc(value)}<small>${esc(extra)}</small></div><div class="metric-note">${esc(note)}</div></div>`).join('');
  $('#theme-strip').innerHTML = m.themes.filter(t=>t.name!=='Other').slice(0,5).map(t=>`<button class="theme-card ${state.theme===t.name?'selected':''}" data-theme="${esc(t.name)}"><div class="theme-top">${esc(t.name)} <span class="muted">↗</span></div><div class="theme-number">${num(t.score,0)}<span class="${tone(t.week)}">${pct(t.week)} / 1W</span></div><div class="track"><i style="width:${t.breadth}%"></i></div><div class="theme-meta">${t.count} stocks · ${t.breadth}% in trend</div></button>`).join('');
  $('#theme-filter').innerHTML = '<option value="">All themes</option>' + m.themes.map(t=>`<option value="${esc(t.name)}" ${state.theme===t.name?'selected':''}>${esc(t.name)} (${t.count})</option>`).join('');
  $('#footer-coverage').textContent = `Snapshot data · prices may be delayed · ${compact(m.turnoverFloor)} native-currency daily turnover floor · not investment advice`;
  renderView();
}
function filterStocks() {
  const q = state.query.toLocaleLowerCase().trim();
  const rows = market().stocks.filter(s=>{
    if (state.view==='watchlist'&&!state.watchlist.has(s.id)) return false;
    if (q&&!`${s.symbol} ${s.name} ${s.industry} ${s.themes.join(' ')} ${s.news.map(n=>n.title).join(' ')}`.toLocaleLowerCase().includes(q)) return false;
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
  if (!state.filtered.some(s=>s.id===state.selected)) state.selected=rows[0]?.id??null;
  $('#result-count').textContent=`${state.filtered.length.toLocaleString()} matches`;
  $$('.quick-filters button').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));
  const empty=state.view==='watchlist'?'Star a stock to save it here. Watchlists stay in this browser.':state.preset==='improving'&&!state.history.some(h=>h.date<state.data.generatedAt.slice(0,10))?'Acceleration appears after snapshots from two different days are available.':'No stocks match. Try clearing a filter.';
  $('#stocks-body').innerHTML=rows.length?rows.map(s=>`<tr class="${s.id===state.selected?'selected':''}" data-stock="${esc(s.id)}"><td><button class="star ${state.watchlist.has(s.id)?'on':''}" data-star="${esc(s.id)}" aria-label="${state.watchlist.has(s.id)?'Remove':'Add'} ${esc(s.symbol)} ${state.watchlist.has(s.id)?'from':'to'} watchlist" aria-pressed="${state.watchlist.has(s.id)}">${state.watchlist.has(s.id)?'★':'☆'}</button></td><td>${s.rank??'—'}</td><td><button class="company-button" data-select="${esc(s.id)}">${esc(s.symbol)}</button><span class="company-name" title="${esc(s.name)}">${esc(s.name)}</span></td><td><div class="score-cell">${scoreBadge(s.score)}<span class="score-delta ${tone(s.scoreDelta)}" title="Change since the previous daily snapshot">${finite(s.scoreDelta)?`${s.scoreDelta>0?'+':''}${num(s.scoreDelta,0)}`:'—'}</span></div></td><td><span class="currency">${esc(s.currency)}</span>${num(s.price,s.currency==='KRW'?0:2)}</td><td class="${tone(s.day)}">${pct(s.day)}</td><td class="${tone(s.month)}">${pct(s.month)}</td><td class="${s.rvol>=2?'up':''}">${num(s.rvol)}×</td><td><span class="setup ${s.setup==='Extended'?'extended':''}">${esc(s.setup)}${upcoming(s)?' · Earnings':''}</span><span class="story-tag">${esc(s.themes[0])}</span></td></tr>`).join(''):`<tr><td colspan="9" class="empty">${esc(empty)}</td></tr>`;
  $('#pagination-label').textContent=state.filtered.length?`${state.page*state.pageSize+1}–${Math.min((state.page+1)*state.pageSize,state.filtered.length)} of ${state.filtered.length.toLocaleString()} · click a company to research`:'No matches';
  $('#prev-page').disabled=state.page===0;
  $('#next-page').disabled=state.page>=pages-1;
  renderDetail();
}
function renderDetail() {
  const s=currentStock();
  if(!s){$('#stock-detail').innerHTML='<div class="empty">Select a stock to explore its price action, story, and filings.</div>';return;}
  $('#stock-detail').innerHTML=`<div class="detail-head"><div class="detail-topline"><span>STOCK INTELLIGENCE</span><button class="star ${state.watchlist.has(s.id)?'on':''}" data-star="${esc(s.id)}" aria-label="Toggle ${esc(s.symbol)} watchlist" aria-pressed="${state.watchlist.has(s.id)}">${state.watchlist.has(s.id)?'★':'☆'}</button></div><h2 class="detail-symbol">${esc(s.symbol)}</h2><div class="detail-name">${esc(s.name)} · ${esc(s.exchange)}</div><div class="detail-price">${num(s.price,s.currency==='KRW'?0:2)} <span class="muted">${esc(s.currency)}</span><span class="${tone(s.day)}">${pct(s.day)}</span></div><div class="detail-tags">${s.themes.map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</div></div><div class="detail-tabs" role="tablist" aria-label="Stock research tabs">${[['overview','Overview'],['story','Story & news'],['insider','Insiders']].map(([id,label])=>`<button role="tab" aria-selected="${state.detailTab===id}" class="${state.detailTab===id?'active':''}" data-detail-tab="${id}">${label}</button>`).join('')}</div><div class="detail-content">${state.detailTab==='overview'?overview(s):state.detailTab==='story'?story(s):insider(s)}</div>`;
  const note=$('#stock-note');
  if(note){ const notes=readStore('vector-notes',{}); note.value=notes[s.id]??''; note.addEventListener('input',()=>{const all=readStore('vector-notes',{});all[s.id]=note.value;saveStore('vector-notes',all);}); }
}
function overview(s) {
  const points=s.chart??[];
  const chart=points.length?chartSVG(points):'<p class="muted">Six-month history is collected for daily leaders and configured focus symbols. Open the full chart below for this stock.</p>';
  const stats=[['Market cap',`${compact(s.marketCap)} ${s.currency}`],['Revenue growth',pct(s.revenueGrowth)],['1-week return',pct(s.week)],['3-month return',pct(s.quarter)],['P/E (TTM)',num(s.pe)],['RSI (14)',num(s.rsi,0)],['From 52W high',finite(s.nearHigh)?pct((s.nearHigh-1)*100):'—'],['Earnings date',dateText(s.earnings)]];
  const extended=finite(s.extension)&&s.extension>15;
  return `<div class="chart-label"><span>PRICE ACTION / 6 MONTHS</span><span>DAILY CLOSE</span></div>${chart}<div class="chart-note">${esc(s.chartStatus)}</div><dl class="data-grid">${stats.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="detail-section"><h3>Momentum score ${scoreBadge(s.score)}</h3>${Object.keys(weights).map(k=>`<div class="component"><span>${labels[k]} · ${weights[k]}%</span><div class="track"><i style="width:${s.components[k]??0}%"></i></div><b>${num(s.components[k],0)}</b></div>`).join('')}<p>${s.coverage}% input coverage. ${finite(s.scoreDelta)?`Score ${s.scoreDelta>0?'rose':'changed'} ${num(s.scoreDelta)} points since the previous daily snapshot.`:'Daily score changes appear after a second scan day.'}</p>${extended?`<p class="down">Extended: ${num(s.extension)}% above the 20-day average. Momentum can persist, but pullback risk is elevated.</p>`:''}</div>${link('https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s.id),'Open full chart on TradingView ↗')}`;
}
function story(s) {
  const evidence=s.themeEvidence??[];
  const notes=state.history.filter(h=>h.stocks?.[s.id]).slice(-6);
  return `<h3>The narrative behind the ticker</h3><p>Themes are research leads from company classifications and headline keywords. They do not establish what caused a price move.</p>${evidence.map(e=>`<div class="detail-section"><h3>${esc(e.theme)}</h3><p>${esc(e.basis)}${e.keyword?` · matched “${esc(e.keyword)}”`:''}${e.headlines?` · ${e.headlines} matching headline${e.headlines>1?'s':''}`:''}</p></div>`).join('')}<div class="detail-section"><h3>Latest coverage <span class="muted">/ 7 days</span></h3><p>${esc(s.newsStatus)}</p>${s.news.length?s.news.map(n=>`<a href="${safeURL(n.url)}" class="article" target="_blank" rel="noopener noreferrer">${esc(n.title)}<small>${esc(n.source)} · ${dateText(n.published)} ↗</small></a>`).join(''):'<p>No headlines collected for this stock in this snapshot.</p>'}${link('https://news.google.com/search?q='+encodeURIComponent(s.name+' stock'),'Search current news ↗')}</div><div class="detail-section"><h3>Recent momentum</h3>${notes.length>1?notes.map(h=>`<div class="component"><span>${esc(h.date)}</span><span class="muted">rank ${h.stocks[s.id].rank??'—'}</span><b>${num(h.stocks[s.id].score,0)}</b></div>`).join(''):'<p>History builds with each successful daily scan. No backfilled scores are implied.</p>'}</div><label class="notes-label" for="stock-note">Your thesis <span class="muted">· private to this browser</span></label><textarea class="research-note" id="stock-note" placeholder="What is the catalyst? What would change your mind?"></textarea>`;
}
function insider(s) {
  const data=s.insider??{};
  const urls=s.country==='US'?[['https://www.sec.gov/edgar/search/#/q='+encodeURIComponent(s.name)+'&filter_forms=4','Search SEC Form 4 filings ↗']]:s.country==='CA'?[['https://www.sedi.ca/','Open Canadian insider reports · SEDI ↗'],['https://www.sedarplus.ca/','Open issuer disclosures · SEDAR+ ↗']]:[['https://dart.fss.or.kr/','Open Korean disclosures · DART ↗']];
  return `<h3>Ownership & disclosures</h3><p>${esc(data.status??'Unavailable')}</p>${data.asOf?`<p>Checked ${dateText(data.asOf)} · ${esc(data.source)}</p>`:''}${!(data.transactions?.length||data.filings?.length)?`<div class="detail-section"><p>${s.country==='US'?'Automated US transactions require SEC_USER_AGENT configuration. This snapshot has no verified transaction records for this issuer.':s.country==='CA'?'An automated Canadian insider feed is not connected. Use SEDI to review reported transactions.':'DART ownership data requires an API key. Holdings changes must not be interpreted as open-market trades.'}</p></div>`:''}${(data.transactions??[]).map(t=>`<div class="insider-row"><span class="${t.code==='P'?'up':t.code==='S'?'down':'muted'}">${esc(t.type)} · ${esc(t.code)}</span> ${esc(t.owner)}<small>${dateText(t.date)} · ${compact(t.shares)} shares · ${finite(t.value)?`${compact(t.value)} USD`:'value not reported'}</small>${link(t.url,'Read source filing ↗')}</div>`).join('')}<div class="detail-section"><h3>Source documents</h3>${(data.filings??[]).map(f=>link(f.url,`${f.type} · ${dateText(f.date)} ↗`)).join('')}${urls.map(([url,label])=>link(url,label)).join('')}<p>A missing record is not evidence of no insider activity. Awards, exercises and gifts are separate from purchases and sales.</p></div>`;
}
function renderRadar() {
  const themes=market().themes.filter(t=>t.name!=='Other');
  const colors=['#c9f484','#8bd1dd','#d5acf5','#ebbc82','#8fb0ed','#e6a0bc','#a4d7bd','#c4c7a1','#b5acd8','#cbb8a3'];
  $('#radar-chart').innerHTML=`<svg viewBox="0 0 1100 400" role="img" aria-label="Theme momentum versus trend breadth. Each circle represents one theme; larger circles contain more stocks."><text x="35" y="20" fill="#929da5" font-size="12">MOMENTUM SCORE</text>${[0,25,50,75,100].map(n=>`<line x1="60" x2="1060" y1="${350-n*3}" y2="${350-n*3}" stroke="#263037" ${n===50?'stroke-dasharray="4 4"':''}/><text x="42" y="${354-n*3}" text-anchor="end" fill="#929da5" font-size="12">${n}</text><line x1="${60+n*10}" x2="${60+n*10}" y1="50" y2="350" stroke="#202930"/><text x="${60+n*10}" y="375" text-anchor="middle" fill="#929da5" font-size="12">${n}%</text>`).join('')}<text x="1060" y="396" text-anchor="end" fill="#929da5" font-size="12">TREND BREADTH →</text><text x="1060" y="36" text-anchor="end" fill="#66705e" font-size="11">STRONG & BROADLY PARTICIPATING</text>${themes.map((t,i)=>`<g><circle cx="${60+t.breadth*10}" cy="${350-t.score*3}" r="${Math.min(25,7+Math.sqrt(t.count))}" fill="${colors[i%colors.length]}" fill-opacity=".2" stroke="${colors[i%colors.length]}" stroke-width="1.5"><title>${esc(t.name)}: score ${t.score}, breadth ${t.breadth}%, ${t.count} stocks</title></circle><text x="${60+t.breadth*10}" y="${350-t.score*3-32-(i%2)*13}" text-anchor="middle" fill="${colors[i%colors.length]}" font-size="11">${esc(t.name)}</text></g>`).join('')}</svg>`;
  $('#theme-grid').innerHTML=themes.map((t,i)=>`<article class="radar-card"><div class="eyebrow" style="color:${colors[i%colors.length]}">${String(i+1).padStart(2,'0')} / ${t.count} STOCKS</div><h3>${esc(t.name)}</h3><div class="radar-stats"><div>Momentum<b>${num(t.score,0)}</b></div><div>Breadth<b>${t.breadth}%</b></div><div>1-week return<b class="${tone(t.week)}">${pct(t.week)}</b></div></div><div class="track"><i style="width:${t.breadth}%;background:${colors[i%colors.length]}"></i></div><p class="theme-meta">${finite(t.delta)?`${t.delta>0?'+':''}${num(t.delta)} score points vs. previous scan day`:'Theme changes build across daily snapshots'}</p><div>${t.leaders.map(id=>`<button class="leader-chip" data-leader="${esc(id)}">${esc(id.split(':')[1])} ↗</button>`).join('')}</div><button class="text-button" data-theme="${esc(t.name)}">Explore ${t.count} stocks →</button></article>`).join('');
}
function openMethod() {
  $('#method-content').innerHTML=`<h3>Momentum, with the math visible</h3><p>Scores run from 0 to 100. Each stock is compared with other eligible stocks listed in the same country. These are relative strength rankings, not probabilities or price targets.</p><ul>${Object.entries(weights).map(([k,w])=>`<li><b>${w}% ${labels[k]}</b> — ${k==='trend'?'fraction of 20-, 50- and 200-day averages below the current price.':k==='nearHigh'?'percentile of price divided by the 52-week high.':k==='rvol'?'percentile of TradingView’s 10-day relative volume.':'percentile of the corresponding price return.'}</li>`).join('')}</ul><p>Ties share a percentile. Missing components are omitted and remaining weights rescaled; below 70% input coverage a stock is unscored. Scores are ranked against the whole eligible country universe, regardless of your current filters. Listings define the country grouping; this is not issuer domicile.</p><h3>Setups & themes</h3><p><b>Near breakout:</b> within 3% of the 52-week high and relative volume ≥ 1.3×. <b>Trending:</b> price above at least two moving averages and a positive month. <b>Extended:</b> more than 15% above the 20-day average; this label takes priority. <b>Accelerating:</b> score up at least 3 points from the preceding successful scan day.</p><p>Theme scores are equal-weight averages of member momentum scores. Breadth is the share above at least two moving averages. Stocks can belong to multiple themes; returns are not portfolio returns. Classification uses issuer/industry keywords, explicit company mappings, and collected headline keywords. Themes and news matches need human verification; no sentiment or causal claims are inferred.</p><h3>Coverage & schedule</h3><p>Primary common shares, up to 5,000 source records per country before liquidity filtering. Approximate daily turnover is current price × average 10-day volume. Minimums: US 1 million, Canada 250 thousand, Korea 500 million, in each listing’s quote currency. Microcaps, illiquid stocks, preferred shares and secondary listings may be excluded.</p><p>The repository workflow is configured for 23:17 UTC daily, after the regular sessions in all three markets, and can be run manually in GitHub Actions. GitHub may delay scheduled runs. Market timestamps remain visible; failed sources retain the last successful snapshot. Browser refresh only reloads the published snapshot. History holds up to 90 scan days; there is no reconstructed historical score backtest.</p><h3>Data sources</h3>${state.data.sources.map(s=>`<div class="source"><div>${link(s.url,s.name,'text-button')}<span>${esc(s.status)}</span></div><p>${esc(s.detail)}</p></div>`).join('')}<h3>Your local research</h3><p>Stars and thesis notes are stored in this browser. They are not sent to GitHub and do not sync across devices. To include a stock in daily news/chart collection, add its exchange-qualified symbol to the repository’s focus list. No API keys are stored in the website.</p>${link('https://github.com/patrickdx/momentum-terminal/actions','Open scan & deployment runs ↗')}`;
  $('#method-dialog').showModal();
}
function resetFilters() {state.query='';state.theme='';state.setup='';state.min=0;state.preset='all';state.page=0;$('#search').value='';$('#theme-filter').value='';$('#setup-filter').value='';$('#min-score').value='0';}
function switchCountry(country){state.country=country;state.selected=null;resetFilters();renderMarket();}
function exportCSV(){
  const keys=['rank','id','name','country','currency','score','scoreDelta','price','day','week','month','quarter','rvol','setup','marketCap','sector','asOf'];
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
    if(data.schemaVersion!==1||!data.markets)throw Error('Snapshot format is unsupported');
    state.data=data;
    try {const r=await fetch(new URL('./data/history.json',import.meta.url),{cache:'no-store'});state.history=r.ok?await r.json():[];}catch{state.history=[];}
    renderMarket();
  } catch(error) {
    $('#notice').hidden=false;$('#notice').textContent=`Could not load the daily snapshot. ${error.message}. Try Refresh data.`;
    if(!state.data){$('#scan-status').textContent='Snapshot unavailable';$('#stocks-body').innerHTML='<tr><td colspan="9" class="empty">No market data is loaded. Retry after the daily snapshot is published.</td></tr>';}
  } finally {$('#refresh').disabled=false;}
}
document.addEventListener('click',(e)=>{
  const b=e.target.closest('button');
  if(!b||!state.data)return;
  if(b.dataset.country){switchCountry(b.dataset.country);return;}
  if(b.dataset.view){state.view=b.dataset.view;state.page=0;renderView();return;}
  if(b.dataset.star){const id=b.dataset.star;state.watchlist.has(id)?state.watchlist.delete(id):state.watchlist.add(id);saveStore('vector-watchlist',[...state.watchlist]);$('#watch-count').textContent=state.watchlist.size;renderTable();return;}
  if(b.dataset.select){state.selected=b.dataset.select;renderTable();return;}
  if(b.dataset.detailTab){state.detailTab=b.dataset.detailTab;renderDetail();return;}
  if(b.dataset.theme){state.view='screener';state.theme=b.dataset.theme;state.page=0;$('#theme-filter').value=state.theme;renderMarket();return;}
  if(b.dataset.leader){state.view='screener';resetFilters();state.selected=b.dataset.leader;state.query=b.dataset.leader.split(':')[1];$('#search').value=state.query;renderView();return;}
  if(b.dataset.sort){state.direction=state.sort===b.dataset.sort?-state.direction:(['name','rank'].includes(b.dataset.sort)?1:-1);state.sort=b.dataset.sort;state.page=0;renderTable();return;}
  if(b.dataset.preset){state.preset=b.dataset.preset;state.page=0;renderTable();return;}
});
$('#stocks-body').addEventListener('click',e=>{if(e.target.closest('button'))return;const row=e.target.closest('[data-stock]');if(row){state.selected=row.dataset.stock;renderTable();}});
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
$('#export').addEventListener('click',()=>{if(state.data)exportCSV();});
$('#refresh').addEventListener('click',()=>loadData());
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#method-dialog').open){e.preventDefault();if(state.view==='themes'){state.view='screener';renderView();}$('#search').focus();}});
loadData();
