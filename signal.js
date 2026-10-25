// Transparent, unbacktested rules. This measures contract momentum, not BRTI.
export class SignalEngine {
  constructor() { this.reset(); }
  reset() { this.samples=[]; this.candidate=null; }
  record(quote, at) {
    const {yesBid:bid,yesAsk:ask}=quote;
    if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||ask<bid){this.reset();return;}
    const last=this.samples.at(-1);
    if(last&&at<=last.at)return;
    if(last&&at-last.at>8000)this.reset();
    this.samples.push({at,mid:(bid+ask)/2,spread:ask-bid});
    this.samples=this.samples.filter(s=>s.at>=at-90000);
  }
  evaluate({now,ready,seconds,totals}) {
    const latest=this.samples.at(-1);
    const result={action:'WAIT',trend:'WARMING UP',change:null,lean:'—',reason:'Collecting 30 seconds of price history.',shares:[]};
    const wait=reason=>{this.candidate=null;return {...result,reason};};
    if(!ready||!latest||now-latest.at>6000) {result.trend='UNAVAILABLE';return wait('Fresh, complete quotes and trade history are required.');}
    result.lean=(latest.mid>.5?'UP':latest.mid<.5?'DOWN':'EVEN')+' · YES midpoint '+(latest.mid*100).toFixed(1)+'¢';
    const baseline=this.samples.filter(s=>s.at<=latest.at-30000).at(-1);
    if(!baseline||latest.at-baseline.at>36000)return wait('Collecting 30 seconds of uninterrupted price history.');
    result.change=(latest.mid-baseline.mid)*100;
    result.trend=result.change>=1-1e-8?'UP':result.change<=-1+1e-8?'DOWN':'SIDEWAYS';
    result.shares=totals.map(t=>t.yes+t.no>0?t.yes/(t.yes+t.no):null);
    if(seconds<=60)return wait('Final minute: settlement sensitivity is high.');
    if(latest.spread>.03000001)return wait('Spread is wider than 3¢.');
    if(totals.some(t=>t.unknown/(t.yes+t.no+t.unknown||1)>.1))return wait('Too much trade volume has an unknown taker side.');
    if(totals[0].count<5||totals[0].yes+totals[0].no<20)return wait('Too little recent trading: need 5 trades and 20 contracts in 10 seconds.');
    const [s10,s30,s60]=result.shares;
    const up=result.trend==='UP'&&s10>=.6&&s30>=.55&&s60>=.5;
    const down=result.trend==='DOWN'&&s10!==null&&s10<=.4&&s30!==null&&s30<=.45&&s60!==null&&s60<=.5;
    const direction=up?'UP':down?'DOWN':null;
    if(!direction)return wait(result.trend==='SIDEWAYS'?'Price is moving sideways; no directional setup.':'Price momentum and taker flow do not agree strongly enough.');
    if(this.candidate?.direction!==direction)this.candidate={direction,since:latest.at,last:latest.at,observations:1};
    else if(latest.at>this.candidate.last){this.candidate.last=latest.at;this.candidate.observations++;}
    if(latest.at-this.candidate.since<4000||this.candidate.observations<3)return {...result,reason:direction+' setup forming. Waiting for confirmation across 3 fresh snapshots.'};
    return {...result,action:direction,reason:(direction==='UP'?'Rising YES price with YES':'Falling YES price with NO')+' taker buying aligned across 10/30/60 seconds.'};
  }
}
