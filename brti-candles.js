// Builds real 15-second OHLC candles from timestamped official BRTI observations.
// Empty intervals are omitted instead of fabricating interpolated prices.
const BUCKET=15000;
export function candlesFromTicks(history,{now=Date.now(),windowMs=900000}={}){
 const cutoff=now-windowMs, buckets=new Map();
 if(!Array.isArray(history))return [];
 for(const tick of history){
  if(!Number.isFinite(tick?.time)||!Number.isFinite(tick?.value)||tick.value<=0||tick.time<cutoff-BUCKET||tick.time>now+2000)continue;
  const start=Math.floor(tick.time/BUCKET)*BUCKET;
  if(start+BUCKET<=cutoff)continue;
  let row=buckets.get(start);
  if(!row){row={time:start,open:tick.value,high:tick.value,low:tick.value,close:tick.value,first:tick.time,last:tick.time,count:1};buckets.set(start,row);}
  else {
   if(tick.time<row.first){row.first=tick.time;row.open=tick.value;}
   if(tick.time>=row.last){row.last=tick.time;row.close=tick.value;}
   row.high=Math.max(row.high,tick.value);row.low=Math.min(row.low,tick.value);row.count++;
  }
 }
 return [...buckets.values()].sort((a,b)=>a.time-b.time);
}
const NS='http://www.w3.org/2000/svg';
function element(tag,attrs={},value){
 const node=document.createElementNS(NS,tag);
 for(const [key,val] of Object.entries(attrs))node.setAttribute(key,String(val));
 if(value!==undefined)node.textContent=value;
 return node;
}
export function drawBrtiCandles(svg,candles,{now=Date.now(),windowMs=900000,strike=null}={}){
 svg.replaceChildren();svg.setAttribute('viewBox','0 0 900 270');
 const left=18,right=768,top=22,bottom=236;
 const fmt=v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});
 const valid=candles.filter(c=>c.time>=now-windowMs-15000&&c.time<=now+2000&&[c.open,c.high,c.low,c.close].every(Number.isFinite));
 if(!valid.length){svg.append(element('text',{x:450,y:135,fill:'#a9bad1','text-anchor':'middle','font-size':15},'Waiting for real BRTI ticks to build 15-second candles'));return;}
 const prices=valid.flatMap(c=>[c.low,c.high]);if(Number.isFinite(strike)&&strike>0)prices.push(strike);
 let min=Math.min(...prices),max=Math.max(...prices);
 const pad=Math.max((max-min)*.13,0.5);min-=pad;max+=pad;
 const X=t=>left+(t-(now-windowMs))/windowMs*(right-left);
 const Y=p=>bottom-(p-min)/(max-min)*(bottom-top);
 for(let i=0;i<5;i++){
  const p=min+(max-min)*i/4,y=Y(p);
  svg.append(element('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#34435a','stroke-width':.6}));
  svg.append(element('text',{x:775,y:y+4,fill:'#a9bad1','font-size':12},fmt(p)));
 }
 const labels=Math.min(6,Math.max(2,Math.round(windowMs/300000)+1));
 for(let i=0;i<=labels;i++){
  const t=now-windowMs+windowMs*i/labels,x=X(t);
  svg.append(element('text',{x,y:258,fill:'#a9bad1','font-size':11,'text-anchor':i===0?'start':i===labels?'end':'middle'},new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
 }
 if(Number.isFinite(strike)&&strike>0){
  const y=Y(strike);svg.append(element('line',{x1:left,x2:right,y1:y,y2:y,stroke:'#ffd27a','stroke-dasharray':'6 5','stroke-width':1.4}));
  svg.append(element('text',{x:770,y:y-5,fill:'#ffd27a','font-size':11},'Strike'));
 }
 const barWidth=Math.max(1.5,Math.min(17,(right-left)*BUCKET/windowMs*.7));
 for(const c of valid){
  const x=X(c.time+BUCKET/2);
  if(x<left-12||x>right+12)continue;
  const green=c.close>=c.open,color=green?'#62e8b7':'#ff959c';
  svg.append(element('line',{x1:x,x2:x,y1:Y(c.high),y2:Y(c.low),stroke:color,'stroke-width':1.35}));
  const y1=Y(Math.max(c.open,c.close)),y2=Y(Math.min(c.open,c.close));
  svg.append(element('rect',{x:x-barWidth/2,y:y1,width:barWidth,height:Math.max(1.5,y2-y1),fill:color}));
 }
}
