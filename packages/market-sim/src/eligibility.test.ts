import { expect,it } from "vitest";
import { isTob } from "./eligibility";
it("only USER-role LIVE accounts can submit Tob flow",()=>{
  for(const role of ["USER","ADMIN","AFFILIATE"] as const)
    for(const accountType of ["LIVE","DEMO"] as const)
      expect(isTob({role,accountType})).toBe(role==="USER" && accountType==="LIVE");
});
