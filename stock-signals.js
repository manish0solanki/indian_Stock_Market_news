/* MarketPulse Stock Signals v1.0
 * Isolated from crypto signals. No broker orders are sent.
 * Daily and intraday feeds are isolated Supabase Edge Functions. Yahoo-derived data may be delayed.
 */
(() => {
'use strict';
const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
const STOCK_DATA_URL = SUPABASE_URL + '/functions/v1/stock-signal-data';
const INTRADAY_DATA_URL = SUPABASE_URL + '/functions/v1/stock-signal-intraday';
const FNO_LIMIT = 35;
const MAX_QUOTE_AGE_HOURS = 96;
const $ = id => document.getElementById(id);
let apiBase = '';
let supabase = null;
let latestSignals = [];

function setCheck(id, text, status='warn') {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.className = status === 'ok' ? 'ok-text' : status === 'bad' ? 'bad-text' : 'warn-text';
}
function setMarketStatus(text, status='warn') {
  const el=$('marketStatus');
  el.innerHTML='<span class="dot '+(status==='ok'?'ok':status==='bad'?'bad':'')+'"></span><span>'+esc(text)+'</span>';
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeNumberFormat(value, options={}) {
  const n=Number(value);
  if (!Number.isFinite(n)) return '—';
  try { return n.toLocaleString('en-IN',options); } catch (_) { return String(n); }
}
function safeNow() {
  try { return (typeof Date !== 'undefined' && Date.now) ? new Date(Date.now()).toISOString() : 'time unavailable'; }
  catch (_) { return 'time unavailable'; }
}
function money(value) {
  const n=Number(value);
  if (!Number.isFinite(n)) return '—';
  return safeNumberFormat(n,{style:'currency',currency:'INR',maximumFractionDigits:2});
}
function num(value) { const n=Number(value); return Number.isFinite(n)?n:null; }
function quoteTime(data) {
  const marketTs=Number(data?.latest_trading_timestamp);
  if(Number.isFinite(marketTs)&&marketTs>0) return new Date(marketTs*1000).toISOString();
  return data?.quote_time || data?.updated_at || data?.timestamp || data?.as_of || data?.fetched_at || null;
}

async function init() {
  try {
    const response=await fetch('/config.json?ts='+Date.now(),{cache:'no-store'});
    if(response.ok) { const cfg=await response.json(); apiBase=String(cfg.apiBase||'').replace(/\/$/,''); }
  } catch (_) {}
  try { supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY); setCheck('storageCheck','Client ready; schema required','warn'); }
  catch(e) { setCheck('storageCheck','Client unavailable','bad'); }
  $('timeframe').addEventListener('change', renderTimeframeState);
  $('scanBtn').addEventListener('click', scan);
  renderTimeframeState();
  await scan();
}
function renderTimeframeState() {
  const intraday=$('timeframe').value==='intraday';
  if(intraday) {
    $('dataNotice').className='notice warning';
    $('dataNotice').innerHTML='<strong>Intraday mode selected.</strong><span>The scanner will request five-minute candles from the separate intraday endpoint. It will block stale, incomplete or unavailable data; Yahoo-derived data may be delayed.</span>';
    setCheck('intradayCheck','Not available — blocked','bad');
  } else {
    $('dataNotice').className='notice warning';
    $('dataNotice').innerHTML='<strong>Daily history validation required.</strong><span>Signal candidates will only be shown if the current quote, history dates, OHLC values and volume pass validation. Yahoo-derived data may be delayed.</span>';
  }
}
async function fetchJson(url, label) {
  const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error(label+' HTTP '+r.status);
  return r.json();
}
async function getUniverse() {
  if(!apiBase) throw new Error('config.json has no API base URL; cannot retrieve the F&O universe');
  const data=await fetchJson(apiBase+'/fno-list','F&O list');
  let list=Array.isArray(data)?data:(data.items||data.stocks||data.symbols||data.data||[]);
  if(!Array.isArray(list)) throw new Error('F&O feed returned an unknown format');
  list=list.map(x=>{
    if(typeof x==='string') return {symbol:x.toUpperCase(),name:x.toUpperCase()};
    const symbol=String(x.symbol||x.trading_symbol||x.ticker||x.stock_symbol||'').toUpperCase().replace(/\.NS$/,'');
    return {symbol,name:x.company_name||x.name||symbol};
  }).filter(x=>/^[A-Z0-9&-]{1,30}$/.test(x.symbol));
  const unique=[...new Map(list.map(x=>[x.symbol,x])).values()];
  if(!unique.length) throw new Error('F&O feed returned zero recognized symbols');
  // Cap requests to avoid hammering the quote function. Prioritize common liquid F&O names.
  const preferred=['RELIANCE','HDFCBANK','ICICIBANK','SBIN','INFY','TCS','BHARTIARTL','LT','AXISBANK','KOTAKBANK','ITC','BAJFINANCE','MARUTI','TATAMOTORS','SUNPHARMA','HINDUNILVR','TITAN','NTPC','POWERGRID','ONGC','TATASTEEL','ADANIENT','JSWSTEEL','WIPRO','TECHM','INDUSINDBK','ULTRACEMCO','ASIANPAINT','COALINDIA','BAJAJFINSV','TRENT','BEL','HAL','DLF','PIDILITIND'];
  const rank=new Map(preferred.map((s,i)=>[s,i]));
  unique.sort((a,b)=>(rank.get(a.symbol)??999)-(rank.get(b.symbol)??999)||a.symbol.localeCompare(b.symbol));
  $('eligibleCount').textContent=safeNumberFormat(unique.length);
  setCheck('universeCheck',unique.length+' symbols · '+Math.min(unique.length,FNO_LIMIT)+' scanned per run','ok');
  return unique.slice(0,FNO_LIMIT);
}
async function getStock(symbol) {
  const data=await fetchJson(STOCK_DATA_URL+'?symbol='+encodeURIComponent(symbol),'Quote '+symbol);
  if(!data || data.success!==true) throw new Error(data?.error||'No successful quote response');
  const history=Array.isArray(data.history)?data.history:[];
  return {data,history};
}
function normalizeBars(history) {
  return history.map(b=>{
    const date=String(b.date||b.datetime||b.timestamp||b.time||'').slice(0,10);
    return {date,open:num(b.open),high:num(b.high),low:num(b.low),close:num(b.close??b.adjclose),volume:num(b.volume)};
  }).filter(b=>b.date && b.open>0 && b.high>0 && b.low>0 && b.close>0 && b.volume!==null)
    .filter(b=>b.high>=Math.max(b.open,b.close,b.low) && b.low<=Math.min(b.open,b.close,b.high))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function validateQuote(data, bars) {
  const price=num(data.price);
  if(!(price>0)) return {ok:false,reason:'Invalid current price'};
  const t=quoteTime(data);
  if(!t) return {ok:false,reason:'Quote timestamp missing; freshness cannot be verified'};
  const ms=Date.parse(t);
  if(!Number.isFinite(ms)) return {ok:false,reason:'Unparseable quote timestamp'};
  const ageH=(Date.now()-ms)/3600000;
  if(ageH < -1 || ageH > MAX_QUOTE_AGE_HOURS) return {ok:false,reason:'Quote stale ('+Math.round(ageH)+'h old)'};
  if(bars.length<60) return {ok:false,reason:'Need at least 60 valid daily OHLCV candles; got '+bars.length};
  const last=bars[bars.length-1], lastDate=Date.parse(last.date+'T00:00:00Z');
  const days=(Date.now()-lastDate)/86400000;
  if(!Number.isFinite(lastDate)||days>7||days< -1) return {ok:false,reason:'Daily history is stale or has an invalid date'};
  if(Math.abs(price-last.close)/price>0.12) return {ok:false,reason:'Quote/history mismatch exceeds 12%; refusing to signal'};
  return {ok:true,price,quoteTime:t,ageH,last};
}
function ema(values, period) {
  if(values.length<period) return [];
  const out=[]; let prev=values.slice(0,period).reduce((a,b)=>a+b,0)/period; out[period-1]=prev;
  const k=2/(period+1);
  for(let i=period;i<values.length;i++){prev=values[i]*k+prev*(1-k);out[i]=prev;}
  return out;
}
function rsi(values,period=14) {
  if(values.length<=period) return null;
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];if(d>0)gains+=d;else losses-=d;}
  let avgG=gains/period,avgL=losses/period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];avgG=((avgG*(period-1))+Math.max(d,0))/period;avgL=((avgL*(period-1))+Math.max(-d,0))/period;}
  if(avgL===0) return 100;
  return 100-(100/(1+avgG/avgL));
}
function atr(bars,period=14) {
  if(bars.length<=period) return null;
  const tr=[];
  for(let i=1;i<bars.length;i++){const b=bars[i],p=bars[i-1].close;tr.push(Math.max(b.high-b.low,Math.abs(b.high-p),Math.abs(b.low-p)));}
  return tr.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function macd(values) {
  const a=ema(values,12),b=ema(values,26),line=values.map((_,i)=>a[i]!==undefined&&b[i]!==undefined?a[i]-b[i]:null);
  const valid=line.filter(v=>v!==null); const sig=ema(valid,9);
  return {line:line[line.length-1],signal:sig[sig.length-1]};
}
function analyse(symbol,name,data,history,tf) {
  const bars=normalizeBars(history),valid=validateQuote(data,bars);
  if(!valid.ok) return {blocked:true,symbol,reason:valid.reason};
  const closes=bars.map(b=>b.close), last=bars[bars.length-1], prev=bars[bars.length-2];
  const e20=ema(closes,20),e50=ema(closes,50),r=rsi(closes),a=atr(bars),m=macd(closes);
  if(!Number.isFinite(a)||a<=0||!Number.isFinite(r)||!Number.isFinite(m.line)||!Number.isFinite(m.signal)||!Number.isFinite(e20.at(-1))||!Number.isFinite(e50.at(-1))) return {blocked:true,symbol,reason:'Indicators missing or non-finite (ATR/RSI/EMA/MACD)'};
  const avgVol=bars.slice(-21,-1).reduce((s,b)=>s+b.volume,0)/20;
  const volRatio=avgVol>0?last.volume/avgVol:0;
  const priorHigh=Math.max(...bars.slice(-21,-1).map(b=>b.high));
  const priorLow=Math.min(...bars.slice(-21,-1).map(b=>b.low));
  const trendUp=last.close>e20.at(-1)&&e20.at(-1)>e50.at(-1);
  const trendDown=last.close<e20.at(-1)&&e20.at(-1)<e50.at(-1);
  const breakout=last.close>priorHigh&&volRatio>=1.15;
  const breakdown=last.close<priorLow&&volRatio>=1.15;
  const pullbackBuy=trendUp&&last.low<=e20.at(-1)*1.015&&last.close>e20.at(-1)&&last.close>last.open;
  const pullbackSell=trendDown&&last.high>=e20.at(-1)*0.985&&last.close<e20.at(-1)&&last.close<last.open;
  const buyMomentum=r>=52&&r<=70&&m.line>m.signal;
  const sellMomentum=r>=30&&r<=48&&m.line<m.signal;
  let side=null,setup='',score=0,reasons=[];
  if((breakout||pullbackBuy)&&buyMomentum) {
    side='BUY';setup=breakout?'20-day breakout':'Trend pullback';score=60+(breakout?10:0)+(volRatio>=1.5?10:0)+(r>=55&&r<=65?10:0)+(m.line>m.signal?10:0);
    reasons=[trendUp?'Price above rising trend EMAs':'Breakout above 20-session high',buyMomentum?'RSI and MACD confirm bullish momentum':'Momentum confirmation',volRatio>=1.15?'Volume above recent average':'Volume confirmation is limited'];
  } else if((breakdown||pullbackSell)&&sellMomentum) {
    side='SELL';setup=breakdown?'20-day breakdown':'Bear trend pullback';score=60+(breakdown?10:0)+(volRatio>=1.5?10:0)+(r>=35&&r<=45?10:0)+(m.line<m.signal?10:0);
    reasons=[trendDown?'Price below falling trend EMAs':'Breakdown below 20-session low',sellMomentum?'RSI and MACD confirm bearish momentum':'Momentum confirmation',volRatio>=1.15?'Volume above recent average':'Volume confirmation is limited'];
  } else return null;
  if(score<75) return null;
  // Use structure and ATR for a stop; targets are at least 1.5R and 2R.
  const entry=valid.price;
  let stop=side==='BUY'?Math.min(last.low,entry-1.5*a):Math.max(last.high,entry+1.5*a);
  if(side==='BUY'&&stop>=entry || side==='SELL'&&stop<=entry) return null;
  const risk=Math.abs(entry-stop), riskPct=risk/entry*100;
  if(riskPct<0.25||riskPct>6) return null;
  const target1=side==='BUY'?entry+1.5*risk:entry-1.5*risk;
  const target2=side==='BUY'?entry+2*risk:entry-2*risk;
  if(side==='SELL'&&target2<=0) return null;
  const capital=Math.max(0,num($('capital').value)||0),riskBudget=capital*(Number($('riskPct').value)/100);
  const qty=Math.max(0,Math.floor(riskBudget/risk));
  if(!qty) return null;
  return {symbol,name,side,setup,score,entry,stop,target1,target2,riskPerShare:risk,qty,riskBudget,rr1:1.5,rr2:2,rsi:r,atr:a,ema20:e20.at(-1),ema50:e50.at(-1),volRatio,barDate:last.date,quoteTime:valid.quoteTime,quoteAgeH:valid.ageH,reasons,tf:'swing',source:'stock-data/history'};
}

function normalizeIntradayBars(history) {
  return history.map(b=>({timestamp:Number(b.timestamp)||Date.parse(b.date||b.datetime||b.time||'' )/1000,
    date:b.date||b.datetime||'',open:num(b.open),high:num(b.high),low:num(b.low),close:num(b.close),volume:num(b.volume)}))
    .filter(b=>Number.isFinite(b.timestamp)&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.open>0&&b.high>0&&b.low>0&&b.close>0&&b.volume>0&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high))
    .sort((a,b)=>a.timestamp-b.timestamp);
}
function analyseIntraday(symbol,name,data) {
  const bars=normalizeIntradayBars(data.history||[]);
  if(bars.length<60) return {blocked:true,symbol,reason:'Need at least 60 valid 5-minute candles; got '+bars.length};
  const last=bars.at(-1), ageMin=(Date.now()-last.timestamp*1000)/60000;
  if(!Number.isFinite(ageMin)||ageMin < -2||ageMin>30) return {blocked:true,symbol,reason:'Latest 5-minute candle is stale ('+Math.round(ageMin)+' minutes old)'};
  const closes=bars.map(b=>b.close), e9=ema(closes,9),e21=ema(closes,21), r=rsi(closes), a=atr(bars,14),m=macd(closes);
  if(!Number.isFinite(a)||a<=0||!Number.isFinite(r)||!Number.isFinite(m.line)||!Number.isFinite(m.signal)||!Number.isFinite(e9.at(-1))||!Number.isFinite(e21.at(-1))) return {blocked:true,symbol,reason:'Intraday indicators incomplete'};
  const avgVol=bars.slice(-21,-1).reduce((s,b)=>s+b.volume,0)/20;
  const volRatio=avgVol>0?last.volume/avgVol:0;
  const priorHigh=Math.max(...bars.slice(-13,-1).map(b=>b.high)),priorLow=Math.min(...bars.slice(-13,-1).map(b=>b.low));
  const up=last.close>e9.at(-1)&&e9.at(-1)>e21.at(-1), down=last.close<e9.at(-1)&&e9.at(-1)<e21.at(-1);
  const breakout=last.close>priorHigh&&volRatio>=1.15, breakdown=last.close<priorLow&&volRatio>=1.15;
  const buy=up&&(breakout||(last.low<=e9.at(-1)*1.003&&last.close>last.open))&&r>=52&&r<=72&&m.line>m.signal;
  const sell=down&&(breakdown||(last.high>=e9.at(-1)*0.997&&last.close<last.open))&&r>=28&&r<=48&&m.line<m.signal;
  if(!buy&&!sell) return null;
  const side=buy?'BUY':'SELL',entry=last.close;
  let stop=side==='BUY'?Math.min(last.low,entry-1.2*a):Math.max(last.high,entry+1.2*a);
  const risk=Math.abs(entry-stop),riskPct=risk/entry*100;
  if(!Number.isFinite(risk)||risk<=0||riskPct<0.1||riskPct>2) return null;
  const target1=side==='BUY'?entry+1.5*risk:entry-1.5*risk,target2=side==='BUY'?entry+2*risk:entry-2*risk;
  const capital=Math.max(0,num($('capital').value)||0),riskBudget=capital*(Number($('riskPct').value)/100),qty=Math.floor(riskBudget/risk);
  if(qty<1||target2<=0) return null;
  const score=60+(breakout||breakdown?10:0)+(volRatio>=1.5?10:0)+(r>=55&&r<=65?10:0)+10;
  if(score<75)return null;
  return {symbol,name,side,setup:breakout?'5m breakout':breakdown?'5m breakdown':'5m EMA pullback',score,entry,stop,target1,target2,riskPerShare:risk,qty,riskBudget,rr1:1.5,rr2:2,rsi:r,atr:a,ema20:e9.at(-1),ema50:e21.at(-1),volRatio,barDate:new Date(last.timestamp*1000).toISOString(),quoteTime:new Date(last.timestamp*1000).toISOString(),quoteAgeH:ageMin/60,reasons:[up?'5m EMA9 above EMA21':'5m EMA9 below EMA21', 'RSI and MACD confirm momentum',volRatio>=1.15?'Volume expansion confirmed':'Volume confirmation'],tf:'intraday',source:'stock-signal-intraday/5m'};
}
async function getIntraday(symbol) {
 const data=await fetchJson(INTRADAY_DATA_URL+'?symbol='+encodeURIComponent(symbol),'Intraday '+symbol);
 if(!data||data.success!==true) throw new Error(data?.error||'No intraday candle response');
 return data;
}

function renderSignals(signals,blocked) {
  latestSignals=signals;
  $('signalCount').textContent=signals.length;
  const host=$('signals');
  if(!signals.length) {
    host.innerHTML='<div class="empty-state"><strong>No qualified setups</strong><span>'+esc(blocked.length?blocked.length+' symbols were blocked by data-quality gates.':'No stock met all trend, momentum, volume and risk rules on this scan.')+' This is preferable to manufacturing a trade.</span></div>';
    return;
  }
  const safeSignals=signals.filter(s=>s&&Number.isFinite(s.entry)&&Number.isFinite(s.stop)&&Number.isFinite(s.target1)&&Number.isFinite(s.target2)&&Number.isFinite(s.rsi)&&Number.isFinite(s.qty)&&Number.isFinite(s.score));
  if(safeSignals.length!==signals.length) console.warn('Stock Signals: dropped malformed signal cards',signals.length-safeSignals.length);
  signals=safeSignals;
  latestSignals=signals;
  $('signalCount').textContent=signals.length;
  if(!signals.length){host.innerHTML='<div class="empty-state"><strong>No qualified setups</strong><span>Signals with incomplete indicator values were rejected. Check the diagnostics and source history.</span></div>';return;}
  host.innerHTML=signals.map(s=>'<article class="signal-card"><div class="signal-top"><div><div class="symbol">'+esc(s.symbol)+' · '+esc(s.name)+'</div><div class="company">'+esc(s.setup)+' · Daily candles</div></div><span class="pill '+(s.side==='SELL'?'sell':'')+'">'+s.side+' · '+s.score+'/100</span></div><div class="entry-row"><div class="price-box"><span>Entry reference</span><strong>'+money(s.entry)+'</strong></div><div class="price-box stop"><span>Stop-loss</span><strong>'+money(s.stop)+'</strong></div><div class="price-box target"><span>Target 1</span><strong>'+money(s.target1)+'</strong></div></div><div class="entry-row"><div class="price-box target"><span>Target 2</span><strong>'+money(s.target2)+'</strong></div><div class="price-box"><span>Qty by risk</span><strong>'+safeNumberFormat(s.qty)+'</strong></div><div class="price-box"><span>Risk budget</span><strong>'+money(s.riskBudget)+'</strong></div></div><div class="signal-meta"><div><span>Risk / share</span><strong>'+money(s.riskPerShare)+'</strong></div><div><span>Reward : risk</span><strong>1 : 1.5 / 1 : 2</strong></div><div><span>RSI (14)</span><strong>'+safeNumberFormat(s.rsi,{minimumFractionDigits:1,maximumFractionDigits:1})+'</strong></div></div><p class="reason">'+(Array.isArray(s.reasons)?s.reasons:[]).map(esc).join(' · ')+'</p><div class="signal-foot"><span>Last daily candle: '+esc(s.barDate)+'</span><span>Quote age: '+Math.max(0,Math.round(s.quoteAgeH))+'h</span><button class="small-button" data-copy="'+esc(s.symbol)+'" type="button">Copy plan</button></div></article>').join('');
  host.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',()=>{
    const s=latestSignals.find(x=>x.symbol===btn.dataset.copy);if(!s)return;
    const plan=[s.symbol+' '+s.side+' ('+s.tf+')','Entry reference: '+s.entry,'SL: '+s.stop,'Target 1: '+s.target1,'Target 2: '+s.target2,'Qty by risk: '+s.qty,'Setup: '+s.setup,'Score: '+s.score+'/100','Quote time: '+s.quoteTime].join('\n');
    navigator.clipboard?.writeText(plan).then(()=>btn.textContent='Copied').catch(()=>{btn.textContent='Copy unavailable';});
  }));
}
async function persistSignals(signals) {
  if(!supabase) {setCheck('storageCheck','Supabase client unavailable','bad');return;}
  try {
    const {data:{session},error:authError}=await supabase.auth.getSession();
    if(authError||!session?.user){setCheck('storageCheck','Sign in to save signals','warn');return;}
    const rows=signals.map(s=>({user_id:session.user.id,symbol:s.symbol,timeframe:s.tf,direction:s.side,setup:s.setup,score:s.score,entry_price:s.entry,stop_loss:s.stop,target_1:s.target1,target_2:s.target2,quantity:s.qty,risk_budget:s.riskBudget,rr_target_1:s.rr1,rr_target_2:s.rr2,quote_time:s.quoteTime,candle_time:s.barDate,source:s.source,indicators:{rsi:s.rsi,atr:s.atr,ema20:s.ema20,ema50:s.ema50,volume_ratio:s.volRatio},status:'ACTIVE',strategy_version:'swing-v1'}));
    if(!rows.length){setCheck('storageCheck','No qualified signals to save','warn');return;}
    const {error}=await supabase.from('stock_trade_signals').upsert(rows,{onConflict:'user_id,symbol,timeframe,direction,candle_time,strategy_version'});
    if(error) throw error;
    setCheck('storageCheck',rows.length+' signal(s) saved','ok');
  } catch(e) {setCheck('storageCheck','Not saved: '+String(e.message||e).slice(0,100),'bad');}
}
async function scan() {
  const btn=$('scanBtn');btn.disabled=true;btn.textContent='Validating…';
  $('scanSummary').textContent='Checking feeds and validating symbols…';
  $('candleCount').textContent='—';$('candleWindow').textContent='Waiting for valid daily bars';
  $('feedState').textContent='CHECKING';setMarketStatus('Checking data feed');
  const signals=[],blocked=[];let quoteOk=0,candleOk=0;
  try {
    const timeframe=$('timeframe').value;
    const universe=await getUniverse();
    if(timeframe==='intraday') {
      setCheck('quoteCheck','Using latest 5-minute candle as entry reference','warn');
      setCheck('dailyCheck','Daily history not used in intraday mode','warn');
      setCheck('intradayCheck','Validating 5-minute candles','warn');
      const jobs=universe.map(async stock=>{
        try {
          const data=await getIntraday(stock.symbol);
          quoteOk++;
          const sig=analyseIntraday(stock.symbol,stock.name,data);
          if(sig)signals.push(sig);else blocked.push({symbol:stock.symbol,reason:'No setup or risk gate failed'});
          if(Array.isArray(data.history)&&data.history.length>=60)candleOk++;
        } catch(e) {blocked.push({symbol:stock.symbol,reason:String(e.message||e)});}
      });
      await Promise.all(jobs);
      signals.sort((a,b)=>b.score-a.score);
      $('candleCount').textContent=String(candleOk);
      $('candleWindow').textContent='of '+universe.length+' symbols passed 5-minute candle gates';
      $('feedState').textContent=candleOk?'PARTIAL':'BLOCKED';$('feedChecked').textContent=safeNow();
      setCheck('quoteCheck',quoteOk+' / '+universe.length+' intraday responses received',quoteOk?'ok':'bad');
      setCheck('dailyCheck','Not required for intraday','warn');
      setCheck('intradayCheck',candleOk+' / '+universe.length+' returned at least 60 five-minute candles',candleOk?'ok':'bad');
      setMarketStatus(candleOk?'Intraday data validated; verify broker price':'Intraday data unavailable',candleOk?'warn':'bad');
      $('dataNotice').className='notice warning';
      $('dataNotice').innerHTML='<strong>Intraday data is Yahoo-derived and may be delayed.</strong><span>Only use signals when the latest candle is fresh. Confirm entry and stop with your broker; no orders are placed.</span>';
      $('scanSummary').textContent=signals.length+' intraday setup(s) · '+blocked.length+' blocked/no setup · '+universe.length+' scanned';
      renderSignals(signals,blocked);await persistSignals(signals);return;
    }
    setCheck('quoteCheck','Testing '+Math.min(universe.length,5)+' quote responses','warn');
    const jobs=universe.map(async stock=>{
      try {
        const {data,history}=await getStock(stock.symbol);
        const bars=normalizeBars(history);
        const validation=validateQuote(data,bars);
        if(num(data.price)>0&&quoteTime(data)) quoteOk++;
        if(validation.ok)candleOk++;
        const signal=analyse(stock.symbol,stock.name,data,history,$('timeframe').value);
        if(signal) signals.push(signal); else if(!validation.ok) blocked.push({symbol:stock.symbol,reason:validation.reason});
      } catch(e) {blocked.push({symbol:stock.symbol,reason:String(e.message||e)});}
    });
    await Promise.all(jobs);
    signals.sort((a,b)=>b.score-a.score);
    $('candleCount').textContent=candleOk.toString();
    $('candleWindow').textContent='of '+universe.length+' symbols passed quote + daily OHLCV gates';
    $('feedState').textContent=quoteOk>0&&candleOk>0?'PARTIAL':'BLOCKED';
    $('feedChecked').textContent=new Date().toLocaleString('en-IN');
    setCheck('quoteCheck',quoteOk+' / '+universe.length+' had valid price + timestamp',quoteOk?'ok':'bad');
    setCheck('dailyCheck',candleOk+' / '+universe.length+' passed OHLCV/date checks',candleOk?'ok':'bad');
    setCheck('intradayCheck','Unavailable — daily candles only','bad');
    setMarketStatus(candleOk?'Daily data partly validated':'Data not validated',candleOk?'warn':'bad');
    $('dataNotice').className=candleOk?'notice warning':'notice bad';
    $('dataNotice').innerHTML=candleOk?'<strong>Daily data passed basic checks for '+candleOk+' symbol(s).</strong><span>This is not proof of exchange-grade real-time accuracy. Check source timestamps and verify prices with your broker before acting.</span>':'<strong>No reliable daily candle set passed validation.</strong><span>No recommendations are available. Fix the feed/schema before using this page for trading.</span>';
    $('scanSummary').textContent=signals.length+' qualified setup(s) · '+blocked.length+' blocked/unavailable · '+universe.length+' scanned';
    renderSignals(signals,blocked);
    await persistSignals(signals);
  } catch(e) {
    $('feedState').textContent='BLOCKED';$('feedChecked').textContent=new Date().toLocaleString('en-IN');
    setMarketStatus('Feed error','bad');setCheck('universeCheck',String((e&&e.message)||e)+' · '+String((e&&e.stack)||'').slice(0,180),'bad');
    setCheck('quoteCheck','Not validated','bad');setCheck('dailyCheck','Not validated','bad');
    $('dataNotice').className='notice bad';$('dataNotice').innerHTML='<strong>Scanner stopped safely.</strong><span>'+esc(String(e.message||e))+'</span>';
    $('scanSummary').textContent='No signals generated.';renderSignals([],[]);
  } finally {btn.disabled=false;btn.textContent='Validate feed & scan';}
}
init();
})();