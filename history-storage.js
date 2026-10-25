// Large, per-round browser storage for historical market candles and trade flow.
// Legacy localStorage records are copied transactionally and removed ONLY after
// successful IndexedDB commit. Never clear other application storage.
const NAME='btcScalpHistoricalDataV1';
const VERSION=1;
const STORES=['kalshiRounds','tradeFlows'];
let opening=null;

function database(){
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('IndexedDB is unavailable in this browser or browsing mode.'));return;}
  const req=indexedDB.open(NAME,VERSION);
  req.onupgradeneeded=()=>{
   const db=req.result;
   for(const store of STORES)if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'ticker'});
  };
  req.onerror=()=>reject(req.error||Error('Could not open browser historical database.'));
  req.onblocked=()=>reject(Error('History database upgrade blocked by another open tab. Close other copies of this dashboard and refresh.'));
  req.onsuccess=()=>{
   const db=req.result;
   db.onversionchange=()=>db.close();
   resolve(db);
  };
 }).catch(e=>{opening=null;throw e;});
 return opening;
}

async function transaction(storeName,mode,work){
 if(!STORES.includes(storeName))throw Error('Invalid history store');
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(storeName,mode),store=tx.objectStore(storeName);
  let value;
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error||Error('Browser database transaction failed.'));
  tx.onabort=()=>reject(tx.error||Error('Browser database transaction aborted.'));
  try{work(store,result=>{value=result;});}
  catch(error){try{tx.abort();}catch{}reject(error);}
 });
}

export async function historyRecords(storeName){
 return transaction(storeName,'readonly',(store,set)=>{
  const request=store.getAll();
  request.onsuccess=()=>set(request.result||[]);
 });
}

export async function historyPut(storeName,record){
 if(typeof record?.ticker!=='string'||!record.ticker)throw Error('Historical record has no ticker');
 await transaction(storeName,'readwrite',store=>store.put(record));
}

// A legacy value may be a JSON array (candles) or a map keyed by ticker (trades).
// Read it first, then copy any records not already present in IndexedDB.
// A failed migration leaves the old records untouched and visible on next retry.
export async function historyMigrate(storeName,legacyKey,format){
 let source;
 try{source=localStorage.getItem(legacyKey);}
 catch{return {migrated:0,removed:false};}
 if(source===null)return {migrated:0,removed:false};
 let parsed;
 try{parsed=JSON.parse(source);}
 catch{throw Error('Saved legacy '+storeName+' data could not be parsed; it was not deleted.');}
 const rows=(format==='array'?Array.isArray(parsed)?parsed:[]:parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?Object.values(parsed):[])
  .filter(r=>r&&typeof r.ticker==='string'&&r.ticker.length>0);
 if(!rows.length)return {migrated:0,removed:false};
 await transaction(storeName,'readwrite',store=>{
  for(const row of rows){
   const request=store.get(row.ticker);
   request.onsuccess=()=>{
    // Protect newer IndexedDB records if a previously migrated legacy key remains.
    if(!request.result)store.put(row);
   };
  }
 });
 try{localStorage.removeItem(legacyKey);}
 catch{ /* Migration is already committed. A later retry won't overwrite modern data. */ }
 return {migrated:rows.length,removed:localStorage.getItem(legacyKey)===null};
}

export async function historyUsage(){
 if(typeof navigator==='undefined'||typeof navigator.storage?.estimate!=='function')return null;
 try{
  const {usage,quota}=await navigator.storage.estimate();
  if(!Number.isFinite(usage)||!Number.isFinite(quota))return null;
  return {usage,quota};
 }catch{return null;}
}
