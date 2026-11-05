"use client";
import { useEffect,useRef,useState } from "react";
import { chartDiagnostics,startChartDiagnostics } from "./diagnostics";
export function ChartDiagnostics(){
  const [recording,setRecording]=useState(false),[result,setResult]=useState<ReturnType<typeof chartDiagnostics>|null>(null);
  const stop=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>stop.current?.(),[]);
  function toggle(){if(recording){stop.current?.();stop.current=null;setResult(chartDiagnostics());setRecording(false);}else{stop.current=startChartDiagnostics();setRecording(true);setResult(null);}}
  function download(){const data=chartDiagnostics(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="chart-performance.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setResult(data);}
  return <details className="rounded border border-rule px-3 py-2 text-xs text-ink-2 phone:mx-2">
    <summary className="cursor-pointer">Chart performance</summary>
    <p className="my-2 text-ink-3">Record this browser while you switch markets, zoom and pan. Results cover frame intervals and update time; server usage is separate.</p>
    <div className="flex gap-3"><button className="rounded border border-rule px-3 py-2" onClick={toggle}>{recording?"Stop recording":"Record performance"}</button><button className="rounded border border-rule px-3 py-2" onClick={download}>Download measurements</button></div>
    {recording?<p className="mt-2" role="status">Recording browser performance…</p>:null}
    {result?<pre className="mt-2 overflow-auto text-[10px]" aria-label="Browser performance measurements">{JSON.stringify({bytes:result.bytes,messages:result.messages,stats:result.stats,switches:result.switches},null,2)}</pre>:null}
  </details>;
}
