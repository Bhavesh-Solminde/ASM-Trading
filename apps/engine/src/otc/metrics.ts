import { monitorEventLoopDelay,performance } from "node:perf_hooks";
/** Server-only diagnostics. A CPU percentage is relative to one logical core. */
export function otcProcessMetrics(){
  const delay=monitorEventLoopDelay({resolution:20});delay.enable();
  let previous=process.cpuUsage(),at=performance.now();
  const samples:{time:string;cpuOneCorePct:number;rssBytes:number;heapBytes:number;eventLoopP95Ms:number;eventLoopMaxMs:number}[]=[];
  const sample=()=>{
    const now=performance.now(),cpu=process.cpuUsage(),memory=process.memoryUsage();
    samples.push({time:new Date().toISOString(),cpuOneCorePct:(cpu.user-previous.user+cpu.system-previous.system)/((now-at)*1000)*100,
      rssBytes:memory.rss,heapBytes:memory.heapUsed,eventLoopP95Ms:delay.percentile(95)/1e6,eventLoopMaxMs:delay.max/1e6});
    previous=cpu;at=now;delay.reset();if(samples.length>720)samples.shift();
  };
  const timer=setInterval(sample,5000);timer.unref();
  return {read:()=>({pid:process.pid,sampleIntervalMs:5000,scope:"Engine process including worker; excludes web, Postgres, Redis and browser",samples:[...samples]}),stop:()=>{clearInterval(timer);delay.disable();}};
}
