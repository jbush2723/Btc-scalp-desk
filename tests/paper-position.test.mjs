import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePaperPosition,projectPaperReturn} from '../paper-position.js';

const ticker='KXBTC15M-TEST';
const start=Date.now()-1200000;
const plan={available:true,ticker,side:'yes',entry:.5,stop:.42,target:.7};
const q=(bid,ask=.50,size=200)=>({
 yesBid:bid,yesAsk:ask,noBid:1-ask,noAsk:1-bid,
 yesBidSize:size,yesAskSize:size,noBidSize:size,noAskSize:size
});
const empty=()=>({used:[],pending:null,active:null,last:null});
function observe(state,at,{closeAt=start+900000,price=q(.49),buyPlan=plan,reading='UP',fresh=true}={}){
 return advancePaperPosition(state,{plan:buyPlan,reading:{action:reading},
  ticker,quote:price,bookAt:at-100,now:at,closeAt,fresh,stake:50});
}
function opened({closeAt=start+900000}={}){
 const pending=observe(empty(),start+100,{closeAt,price:q(.48)}).state;
 const opening=observe(pending,start+2200,{closeAt,price:q(.49)}).state;
 assert.ok(opening.active);
 return opening;
}

test('paper entries need the next observed order book, not the signaling snapshot',()=>{
 const first=observe(empty(),start+100,{price:q(.48)});
 assert.ok(first.state.pending);
 assert.equal(first.state.active,null);
 const next=observe(first.state,start+2200,{price:q(.49)});
 assert.ok(next.state.active);
 assert.equal(next.state.active.entry,.5);
 assert.equal(next.state.active.side,'yes');
 assert.equal(next.state.last,null);
});

test('upward quote momentum yields experimental projected positive return, separate from target',()=>{
 const state=opened();
 const now=start+30000;
 const samples=Array.from({length:12},(_,i)=>({at:now-44000+4000*i,mid:.43+i*.004}));
 const projection=projectPaperReturn(state.active,{quote:q(.51,.53),samples,now,fresh:true});
 assert.ok(projection);
 assert.ok(projection.projectedPct>0);
 assert.ok(projection.projectedBid>.51);
 assert.ok(Math.abs(projection.planTargetPct-40)<.0001);
});

test('downward quote momentum projects a lower selling bid, not forced upside',()=>{
 const state=opened(),now=start+30000;
 const samples=Array.from({length:12},(_,i)=>({at:now-44000+4000*i,mid:.60-i*.004}));
 const projection=projectPaperReturn(state.active,{quote:q(.49,.51),samples,now,fresh:true});
 assert.ok(projection.projectedBid<.49);
 assert.ok(projection.projectedPct<0);
});
test('projection is unavailable when quote history has a gap',()=>{
 const state=opened(),now=start+30000;
 const samples=[...Array.from({length:8},(_,i)=>({at:now-42000+3000*i,mid:.42+i*.003})),
  {at:now,mid:.50}];
 assert.equal(projectPaperReturn(state.active,{quote:q(.49),samples,now,fresh:true}),null);
});

test('paper monitor says HOLD before a trigger and EXIT at the observed +15% bid',()=>{
 let state=opened();
 const hold=observe(state,start+7200,{price:q(.5,.52)});state=hold.state;
 assert.ok(state.active);
 assert.match(hold.message,/HOLD/);
 const sold=observe(state,start+10000,{price:q(.59,.61)});
 assert.equal(sold.state.active,null);
 assert.match(sold.state.last.status,/TAKE PROFIT/);
 assert.ok(sold.state.last.grossPnl>0);
});

test('a long gap cannot be reconstructed as a successful hypothetical trade',()=>{
 const state=opened();
 const skipped=observe(state,start+21000,{price:q(.6,.62)});
 assert.equal(skipped.state.active,null);
 assert.match(skipped.state.last.status,/UNRESOLVED · DATA GAP/);
 assert.equal(skipped.state.last.grossPct,null);
});

test('pre-close deadline uses a timely observed bid as a paper exit',()=>{
 const closeAt=start+90000;
 let state=opened({closeAt});
 for(let t=start+7000;t<=start+32000;t+=5000){
  const item=observe(state,t,{closeAt,price:q(.49)});
  state=item.state;
 }
 const final=state.last;
 assert.equal(state.active,null);
 assert.equal(final.status,'EXIT · PRE-CLOSE LIMIT');
 assert.ok(final.exitAt<=closeAt-60000);
});

test('never counts an unobserved or illiquid exit as hypothetical profit',()=>{
 let state=opened();
 const tooThin=observe(state,start+8000,{price:q(.60,.62,1)});
 assert.ok(tooThin.state.active);
 const deadline=observe(tooThin.state,start+430000,{price:q(.7,.72,1)});
 assert.equal(deadline.state.active,null);
 assert.match(deadline.state.last.status,/UNRESOLVED/);
 assert.equal(deadline.state.last.grossPct,null);
});
