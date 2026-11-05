type Kind="chartWork"|"frameInterval"|"switchLatency"|"longTask";
const LIMIT=1200;
const samples:Record<Kind,number[]>={chartWork:[],frameInterval:[],switchLatency:[],longTask:[]};
let enabled=false,startedAt=0,bytes=0,messages=0,pending:{key:string;at:number;cached:boolean}|null=null;
let switches:{key:string;ms:number;cached:boolean}[]=[];
export function recordChartMetric(kind:Kind,value:number){if(!enabled||!Number.isFinite(value))return;const list=samples[kind];list.push(value);if(list.length>LIMIT)list.shift();}
const encoder=new TextEncoder();
export function recordChartPayload(payload:string){if(enabled){bytes+=encoder.encode(payload).byteLength;messages++;}}
export function beginChartSwitch(key:string,cached:boolean){if(enabled)pending={key,cached,at:performance.now()};}
export function finishChartSwitch(key:string){
  if(!enabled||pending?.key!==key)return;
  const ms=performance.now()-pending.at;recordChartMetric("switchLatency",ms);switches.push({key,ms,cached:pending.cached});if(switches.length>100)switches.shift();pending=null;
}
export function startChartDiagnostics(){
  enabled=true;startedAt=Date.now();bytes=0;messages=0;pending=null;switches=[];for(const list of Object.values(samples))list.length=0;
  let frame=0,previous:number|null=null;
  const tick=(now:number)=>{
    if(document.hidden){previous=null;}else{if(previous!==null)recordChartMetric("frameInterval",now-previous);previous=now;}
    frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  let observer:PerformanceObserver|null=null;
  if(typeof PerformanceObserver!=="undefined"&&PerformanceObserver.supportedEntryTypes?.includes("longtask")){
    observer=new PerformanceObserver(list=>{if(!document.hidden)for(const entry of list.getEntries())recordChartMetric("longTask",entry.duration);});
    observer.observe({type:"longtask"});
  }
  return ()=>{enabled=false;cancelAnimationFrame(frame);observer?.disconnect();};
}
export function chartDiagnostics(){
  const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??null,max:sorted.at(-1)??null};};
  return {recording:enabled,startedAt:startedAt?new Date(startedAt).toISOString():null,measuredAt:new Date().toISOString(),
    measurement:"Actual browser animation-frame intervals, chart update JavaScript time and long tasks. Does not measure GPU paint completion or server CPU.",
    boundedSamples:LIMIT,bytes,messages,stats:Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,stats(values)])),switches,samples};
}
