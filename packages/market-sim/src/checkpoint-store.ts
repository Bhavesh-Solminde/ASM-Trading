import { mkdir,open,readFile,rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash,randomUUID } from "node:crypto";
import { AnchoredMarket } from "./anchored-market";

export interface WorldCheckpoint {
  version: 1;
  sequence: number;
  time: number;
  markets: ReturnType<AnchoredMarket["checkpoint"]>[];
}

/** One writer per world. Atomic rename keeps the previous checkpoint on failure. */
export class CheckpointStore {
  constructor(private readonly path:string){}
  async save(checkpoint:WorldCheckpoint){
    const payload=JSON.stringify(checkpoint);
    const envelope=JSON.stringify({sha256:createHash("sha256").update(payload).digest("hex"),payload});
    await mkdir(dirname(this.path),{recursive:true});
    const temporary=`${this.path}.${randomUUID()}.tmp`;
    const file=await open(temporary,"wx",0o600);
    try{await file.writeFile(envelope,"utf8");await file.sync();}finally{await file.close();}
    await rename(temporary,this.path);
    const directory=await open(dirname(this.path),"r");
    try{await directory.sync();}finally{await directory.close();}
  }
  async load():Promise<WorldCheckpoint|null>{
    let raw:string;
    try{raw=await readFile(this.path,"utf8");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
    const envelope=JSON.parse(raw) as {sha256:string;payload:string};
    if(typeof envelope.payload!=="string" || createHash("sha256").update(envelope.payload).digest("hex")!==envelope.sha256)throw new Error("Checkpoint checksum mismatch");
    const state=JSON.parse(envelope.payload) as WorldCheckpoint;
    if(state.version!==1 || !Number.isSafeInteger(state.sequence) || state.sequence<0 || !Number.isSafeInteger(state.time)
      || !Array.isArray(state.markets) || new Set(state.markets.map(m=>m.profile.symbol)).size!==state.markets.length)throw new Error("Invalid world checkpoint");
    for(const market of state.markets){if(market.clock!==state.time)throw new Error("Checkpoint clocks disagree");AnchoredMarket.restore(market);}
    return state;
  }
}
