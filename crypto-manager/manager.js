/* MarketPulse Crypto Manager V1 — Shadow Mode
   Deterministic position/risk manager. It does NOT execute trades.
   The manager observes an existing trade + market state and returns one decision:
   HOLD, RECOMMEND_EARLY_EXIT, RECOMMEND_PROFIT_EXIT, RECOMMEND_TIGHTEN_STOP,
   STOP_REACHED, TARGET_REACHED, NO_DECISION.
*/
(function(){
  "use strict";

  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));

  function evaluate(trade,market){
    if(!trade||!market) return {action:"NO_DECISION",reason:"missing_context",confidence:0};
    const dir=String(trade.dir||"").toUpperCase();
    const entry=Number(trade.entry),sl=Number(trade.sl),tp=Number(trade.tp),price=Number(market.price);
    if(!["LONG","SHORT"].includes(dir)||![entry,sl,tp,price].every(Number.isFinite)||entry<=0||sl<=0||tp<=0||price<=0){
      return {action:"NO_DECISION",reason:"invalid_context",confidence:0};
    }

    const r=dir==="LONG" ? (price-entry)/Math.abs(entry-sl) : (entry-price)/Math.abs(sl-entry);
    const peakR=Number.isFinite(Number(trade.peakR)) ? Number(trade.peakR) : r;
    const losing=r<0;
    const profitable=r>0;
    const invalidations=[
      market.emaInvalidated===true,
      market.momentumAgainst===true,
      Number(market.volumeRatio)<0.9,
      market.regime==="against"
    ].filter(Boolean).length;

    const stopHit=dir==="LONG" ? price<=sl : price>=sl;
    const targetHit=dir==="LONG" ? price>=tp : price<=tp;

    if(stopHit) return {action:"STOP_REACHED",reason:"active_stop_reached",confidence:100,r,peakR};
    if(targetHit) return {action:"TARGET_REACHED",reason:"target_reached",confidence:100,r,peakR};

    if(losing && invalidations>=2){
      return {
        action:"RECOMMEND_EARLY_EXIT",
        reason:"losing_position_with_"+invalidations+"_invalidation_signals",
        confidence:clamp(55+invalidations*15,0,95),r,peakR
      };
    }

    if(profitable && invalidations>=2 && r>=0.30){
      return {
        action:"RECOMMEND_PROFIT_EXIT",
        reason:"profitable_position_with_"+invalidations+"_deterioration_signals",
        confidence:clamp(55+invalidations*12+r*10,0,95),r,peakR
      };
    }

    if(peakR>=0.70 && r>=0.30 && invalidations>=1){
      return {
        action:"RECOMMEND_TIGHTEN_STOP",
        reason:"profit_protection_with_market_deterioration",
        confidence:clamp(60+invalidations*10,0,95),r,peakR
      };
    }

    return {action:"HOLD",reason:"no_manager_trigger",confidence:50,r,peakR};
  }

  window.CryptoTradeManagerV1={version:"shadow-v1",mode:"shadow",evaluate};
})();