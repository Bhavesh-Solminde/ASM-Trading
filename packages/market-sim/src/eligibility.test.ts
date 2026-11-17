import { expect,it } from "vitest";
import { isTob } from "./eligibility";
it("USER and real AFFILIATE LIVE accounts submit Tob flow; ADMIN, DEMO and legacy-simulated never do",()=>{
  for(const role of ["USER","ADMIN","AFFILIATE"] as const)
    for(const accountType of ["LIVE","DEMO"] as const)
      for(const legacySimulated of [undefined,false,true]){
        const real=role==="USER"||(role==="AFFILIATE"&&legacySimulated===false);
        expect(isTob({role,accountType,...(legacySimulated!==undefined?{legacySimulated}:{})})).toBe(real&&accountType==="LIVE");
      }
});
