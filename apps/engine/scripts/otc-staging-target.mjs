import { resolve } from "node:path";

/** Fixture funding is allowed only in the named disposable acceptance stack. */
export function stagingTarget(env=process.env){
  const db=new URL(env.DATABASE_URL??"");
  const local=db.hostname==="127.0.0.1"&&db.port==="55440"&&db.pathname==="/otc_integration";
  const container=env.OTC_STAGING_PROJECT==="asmtrader-otc-staging"&&db.hostname==="postgres"&&db.port==="5432"&&db.username==="otc_stage"&&db.pathname==="/otc_integration";
  if(env.OTC_STAGING_RUN!=="true"||(!local&&!container))throw new Error("Named disposable OTC acceptance database required");
  return {base:container?"http://web:3000":"http://127.0.0.1:4301",ws:container?"ws://engine:4001":"ws://127.0.0.1:4501",
    metrics:container?"http://engine:4002/otc/metrics":"http://127.0.0.1:4502/otc/metrics",
    output:resolve(container?"/tmp/otc-reports":"../../docs/verification"),credentials:resolve(container?"/tmp/otc-credentials":"../../.secrets"),
    scope:container?"Isolated KVM staging engine including worker; excludes separate web/database/Redis/browser processes":"Local isolated engine including worker; not a KVM or browser measurement"};
}
