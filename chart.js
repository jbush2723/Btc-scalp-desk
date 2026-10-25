// Chart analysis uses observed Kalshi YES midpoints, never an inferred BRTI price.
export function analyzeChart(samples,now) {
  const data=samples.filter(s=>Number.isFinite(s.mid)&&s.at<=now&&s.at>=now-90000);
  const result={ready:false,direction:'WARMING UP',data:[],fast:null,slow:null,low:null,high:null};
  if(!data.length)return result;
  let fast=data[0].mid,slow=fast;
  for(let i=0;i<data.length;i++){
    const dt=i?(data[i].at-data[i-1].at)/1000:0;
    fast+=(data[i].mid-fast)*(1-Math.exp(-dt/10));
    slow+=(data[i].mid-slow)*(1-Math.exp(-dt/30));
    result.data.push({...data[i],fast,slow});
  }
  const latest=data.at(-1);
  if(now-latest.at>6000){result.direction='STALE';return result;}
  result.fast=fast;result.slow=slow;
  const recent=data.filter(s=>s.at>=latest.at-30000);
  result.low=Math.min(...recent.map(s=>s.mid));result.high=Math.max(...recent.map(s=>s.mid));
  result.ready=data.length>=8&&latest.at-data[0].at>=28000&&!data.some((s,i)=>i&&s.at-data[i-1].at>8000);
  if(result.ready)result.direction=latest.mid>fast&&fast-slow>=.001?'UP':latest.mid<fast&&slow-fast>=.001?'DOWN':'MIXED / FLAT';
  return result;
}
export function drawChart(svg,analysis) {
  const ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text)n.textContent=text;svg.append(n);return n;};
  svg.replaceChildren();
  const data=analysis.data;
  if(data.length<2){node('text',{x:30,y:110,fill:'#a9bad1','font-size':16},'Collecting live contract quotes…');return;}
  const min=Math.max(0,Math.min(...data.map(s=>s.mid))-.01),max=Math.min(1,Math.max(...data.map(s=>s.mid))+.01);
  const start=data[0].at,end=Math.max(start+1000,data.at(-1).at);
  const x=t=>80+(t-start)/(end-start)*700,y=p=>190-(p-min)/(max-min)*165;
  for(let i=0;i<3;i++){const p=min+(max-min)*i/2;node('line',{x1:80,x2:780,y1:y(p),y2:y(p),stroke:'#2c3c55'});node('text',{x:4,y:y(p)+4,fill:'#a9bad1','font-size':12},(p*100).toFixed(1)+'¢');}
  for(const [key,color] of [['slow','#ffcd73'],['fast','#b9a2ff'],['mid','#62e8b7']])node('polyline',{points:data.map(s=>x(s.at).toFixed(1)+','+y(s[key]).toFixed(1)).join(' '),fill:'none',stroke:color,'stroke-width':key==='mid'?2.5:1.5});
  node('text',{x:80,y:215,fill:'#a9bad1','font-size':12},new Date(start).toLocaleTimeString());
  node('text',{x:780,y:215,fill:'#a9bad1','font-size':12,'text-anchor':'end'},new Date(end).toLocaleTimeString());
}
