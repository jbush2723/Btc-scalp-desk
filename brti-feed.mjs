import WebSocket from 'ws';
import {authHeaders,loadCredentials} from './kalshi-auth.mjs';

const freshMs=5000;
const positive=value=> (typeof value==='string'&&value.trim()!==''||typeof value==='number')&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function parseTick(frame,now=Date.now()) {
  try{
    if(frame.type!=='cfbenchmarks_value'||frame.msg?.index_id!=='BRTI')return null;
    const raw=JSON.parse(frame.msg.data), value=positive(raw.value), time=Number(raw.time);
    if(raw.type!=='value'||raw.id!=='BRTI'||value===null||!Number.isSafeInteger(time)||time>now+2000||now-time>freshMs)return null;
    const a=frame.msg.avg_60s_data;
    const average=a&&positive(a.value)!==null&&Number.isInteger(a.window_size)&&a.window_size>0&&a.window_size<=60&&
      Number.isSafeInteger(a.window_start_ts_ms)&&Number.isSafeInteger(a.window_end_ts_exclusive)&&
      a.window_start_ts_ms<a.window_end_ts_exclusive&&a.window_end_ts_exclusive<=time&&time-a.window_end_ts_exclusive<=2000 ?
      {value:Number(a.value),samples:a.window_size}:null;
    return {value,time,average};
  }catch{return null;}
}
export class BrtiFeed {
  constructor({credentials=loadCredentials,Socket=WebSocket,now=Date.now}={}){
    this.credentials=credentials;this.Socket=Socket;this.now=now;this.clockOffset=0;this.status='setup_required';this.tick=null;this.history=[];this.nextAt=0;this.failures=0;this.stopped=false;
  }
  start(){this.stopped=false;void this.connect();this.timer=setInterval(()=>{void this.maintain();},2000);this.timer.unref?.();}
  stop(){this.stopped=true;clearInterval(this.timer);this.socket?.terminate();this.socket=null;}
  async maintain(){
    if(this.socket&&this.now()-this.lastTickAt>20000){this.status='waiting_for_data';this.socket.terminate();}
    if(!this.socket&&!this.connecting&&this.now()>=this.nextAt)await this.connect();
  }
  async connect(){
    if(this.stopped||this.connecting||this.socket)return;
    this.connecting=true;
    try{
      const creds=await this.credentials();
      if(this.stopped)return;
      if(!creds){this.status='setup_required';this.nextAt=this.now()+5000;return;}
      this.status='connecting';this.tick=null;this.history=[];this.lastTickAt=this.now();
      const started=this.now();
      const socket=new this.Socket('wss://external-api-ws.kalshi.com/trade-api/ws/v2',{
        headers:authHeaders(creds.keyId,creds.key),handshakeTimeout:10000,maxPayload:256*1024,followRedirects:false
      });
      this.socket=socket;
      // Calibrate freshness against the authenticated TLS handshake's HTTP Date.
      // Local clocks can differ by seconds; never infer an offset from a price tick.
      socket.on('upgrade',response=>{
        const ended=this.now(),date=Date.parse(response.headers.date);
        if(Number.isFinite(date)&&ended-started<10000&&Math.abs(date-ended)<600000)this.clockOffset=date+500-(started+ended)/2;
      });
      socket.on('open',()=>{if(this.socket!==socket)return;this.status='waiting_for_data';socket.send(JSON.stringify({id:1,cmd:'subscribe',params:{channels:['cfbenchmarks_value'],index_ids:['BRTI']}}));});
      socket.on('message',data=>{
        if(this.socket!==socket)return;
        let frame;try{frame=JSON.parse(data.toString());}catch{return;}
        if(frame.type==='error'){this.status='subscription_denied';this.nextAt=this.now()+60000;socket.terminate();return;}
        const tick=parseTick(frame,this.now()+this.clockOffset);
        if(!tick||this.tick&&tick.time<=this.tick.time)return;
        this.tick=tick;this.status='live';this.lastTickAt=this.now();this.failures=0;
        this.history.push({time:tick.time,value:tick.value});this.history=this.history.filter(p=>p.time>=tick.time-15*60000).slice(-900);
      });
      socket.on('unexpected-response',(_req,res)=>{
        this.status=[401,403].includes(res.statusCode)?'access_denied':'connection_error';
        this.nextAt=this.now()+60000;res.resume();socket.terminate();
      });
      socket.on('error',()=>{if(!['access_denied','subscription_denied'].includes(this.status))this.status='connection_error';});
      socket.on('close',()=>{
        if(this.socket!==socket)return;this.socket=null;this.tick=null;this.history=[];
        if(!['access_denied','subscription_denied','connection_error'].includes(this.status))this.status='reconnecting';
        this.nextAt=Math.max(this.nextAt,this.now()+Math.min(60000,2000*2**Math.min(this.failures++,5)));
      });
    }catch{this.status='configuration_error';this.nextAt=this.now()+10000;}
    finally{this.connecting=false;}
  }
  snapshot(){
    const age=this.tick?Math.max(0,this.now()+this.clockOffset-this.tick.time):null;
    const fresh=this.status==='live'&&this.tick&&age<=freshMs&&this.now()-this.lastTickAt<=freshMs;
    return {source:'CF Benchmarks BRTI via Kalshi',status:this.status==='live'&&!fresh?'stale':this.status,
      price:fresh?this.tick.value:null,sourceTime:fresh?this.tick.time:null,ageMs:fresh?age:null,average:fresh?this.tick.average:null,
      history:fresh?this.history:[]};
  }
}
