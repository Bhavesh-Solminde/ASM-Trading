import pg from "pg";

/** A session lock uses one idle connection, without holding an idle transaction. */
export class OtcWriterLock {
  private client:pg.Client;
  private failure:Error|null=null;
  private heartbeat:ReturnType<typeof setInterval>|null=null;
  constructor(url:string,private onLost:(error:Error)=>void){
    this.client=new pg.Client({connectionString:url,keepAlive:true,connectionTimeoutMillis:10000});
    const fail=(error:Error)=>{if(this.failure)return;this.failure=error;this.onLost(error);};
    this.client.on("error",fail);this.client.on("end",()=>fail(new Error("OTC writer lock connection ended")));
  }
  async acquire(){
    await this.client.connect();
    const result=await this.client.query<{locked:boolean}>("SELECT pg_try_advisory_lock($1,$2) AS locked",[4281165,1]);
    if(!result.rows[0]?.locked){await this.client.end();throw new Error("Another OTC engine owns the market writer lock");}
    this.heartbeat=setInterval(()=>{void this.client.query("SELECT 1").catch((error:Error)=>{if(!this.failure){this.failure=error;this.onLost(error);}});},5000);
    this.heartbeat.unref();
  }
  assertActive(){if(this.failure)throw this.failure;}
  async close(){if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;await this.client.end();}
}
