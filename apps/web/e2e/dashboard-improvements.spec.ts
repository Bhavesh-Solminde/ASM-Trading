import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@asm/db";
import { CfdDesk } from "../../engine/src/trading/cfd-desk";
const evidence=resolve(process.cwd(),"../../artifacts/dashboard-improvements-2026-11-11");
let shots: object[]=[];
async function capture(page:Page, info:TestInfo, id:string, name:string, caption:string){
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));
 const filename=`${id}-${info.project.name}-${name}.png`;await page.screenshot({path:resolve(evidence,filename),animations:"disabled"});
 shots.push({id,filename,caption,browser:info.project.name,viewport:page.viewportSize(),capturedAt:new Date().toISOString(),data:"Synthetic local fixtures; fixed reference quotes; real application UI and CFD persistence"});
 await info.attach(name,{path:resolve(evidence,filename),contentType:"image/png"});
}
async function trade(page:Page){await page.goto("/trade");await expect(page.locator("#cfd-stake")).toBeVisible();await expect(page.locator(".tv-lightweight-charts canvas").first()).toBeVisible();await expect(page.locator(".analysis-plot").getByText(/^O [\d,.]+\s+H /)).toBeVisible();}
async function dismissOffer(page:Page){
 const dialog=page.getByRole("dialog",{name:"Deposit bonus"});if(await dialog.isVisible())await dialog.getByRole("button",{name:"Close",exact:true}).click();
}
test.beforeEach(async({page},info)=>{
 page.on("pageerror",e=>{throw new Error(e.stack);});
 await page.addInitScript(()=>{
  localStorage.setItem("indianxtrade:diwali:2026:seen","1");
  // This suite tests chart interactions after the iOS install guide has been seen.
  localStorage.setItem("ixt.pwa.sheetShownAt",String(Date.now()));
 });
 // These tests exercise an already-dismissed offer except for the dedicated promotion case.
 const accounts=await prisma.account.findMany({where:{user:{email:"dashboard-verify@test.local"}},select:{id:true}});
 if(!info.title.startsWith("deposit offer")) await page.addInitScript(key=>{sessionStorage.setItem(key,"shown");},`asm_deposit_offer:${accounts.map(a=>a.id).sort().join(":")}:1`);
});
test.afterAll(()=>{
 mkdirSync(evidence,{recursive:true});const file=resolve(evidence,"manifest.json");
 let old: object[]=[];if(existsSync(file))try{old=JSON.parse(readFileSync(file,"utf8")).screenshots??[];}catch{}
 const names=new Set(shots.map(s=>(s as {filename:string}).filename));
 writeFileSync(file,JSON.stringify({generatedAt:new Date().toISOString(),screenshots:[...old.filter(s=>!names.has((s as {filename:string}).filename)),...shots]},null,2));
});

test("wide markets, Popular, and chart tools",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");
 await page.setViewportSize({width:1920,height:1080});await trade(page);
 const sidebar=page.getByRole("complementary",{name:"Markets sidebar"});await expect(sidebar).toBeVisible();
 for(const text of ["BTC/USDT","Gold","Silver","WTI","Brent"])await expect(sidebar.getByRole("button").filter({hasText:text}).first()).toBeVisible();
 await capture(page,info,"F04","wide-sidebar","Wide dashboard with a persistent market sidebar and five Popular instruments.");
 await sidebar.getByRole("button",{name:"All",exact:true}).click();expect(await sidebar.getByRole("button").count()).toBe(33);
 await capture(page,info,"F06","all-30","The All list is sourced from 30 catalogue entries; Popular remains a separate group.");
 await sidebar.getByRole("button").filter({hasText:"Silver"}).click();await expect(page.locator(".desktop-chart-readout")).toContainText("Silver");
 await capture(page,info,"F06","silver-selected","Selecting a Popular instrument switches the actual chart.");
});

test("investment, focus edge, refresh, fullscreen, and small widths",async({page},info)=>{
 await trade(page);const input=page.locator("#cfd-stake");await input.click();await input.press("ControlOrMeta+A");await page.keyboard.insertText("₹1,00,000");
 await expect(input).toHaveValue("100000");await expect(input).toHaveCSS("outline-style","none");
 expect(await input.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await capture(page,info,"F07","lakh-focused","₹1,00,000 retains all six digits and the composite field has one focus edge.");
 await input.press("ControlOrMeta+A");await page.keyboard.insertText("1000001");await expect(input).toHaveValue("100000");await expect(page.locator(".trade-ticket [role=alert]")).toContainText("at most two decimal places");await capture(page,info,"F07","invalid-limit","An over-limit amount is rejected with an explicit message and the valid amount remains intact.");
 await input.click();await input.press("ControlOrMeta+A");await page.keyboard.insertText("100000");

 await page.getByRole("button",{name:"Fullscreen chart",exact:true}).click();await expect(page.locator(".trade-workspace")).toHaveAttribute("data-focus","true");await expect(input).toHaveValue("100000");
 await capture(page,info,"F01","fullscreen","Fullscreen keeps the investment, shows chart tools, and keeps phone Buy/Sell below the chart.");
 await page.getByRole("button",{name:"Exit fullscreen",exact:true}).click();await page.reload();await expect(input).toHaveValue("100000");
 await capture(page,info,"F07","after-refresh","The same investment survives leaving fullscreen and refreshing.");
 const orderResponse = page.waitForResponse(r=>r.url().endsWith("/api/cfd/trades")&&r.request().method()==="POST");
 await page.locator(".ticket-actions button").first().click(); const opened=await(await orderResponse).json();expect(opened.trade.stake).toBe(10000000);
 expect((await prisma.trade.findUniqueOrThrow({where:{id:opened.trade.id}})).stake).toBe(10000000);
 await capture(page,info,"F07","submitted-lakh","The actual Buy button submitted ₹1,00,000 and the local engine stored exactly 10,000,000 minor units.");
 await page.request.post(`/api/cfd/trades/${opened.trade.id}/close`);

 await page.setViewportSize({width:320,height:740});await input.focus();expect(await input.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await capture(page,info,"F11","small-width-focus","Investment remains readable with a single focus treatment at 320px width.");
 await page.setViewportSize({width:700,height:800});await capture(page,info,"F11","tablet-focus","Tablet layout preserves the full amount and focus treatment.");
});

test("mobile normal, fullscreen and circular logo",async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await trade(page);
 await expect(page.getByRole("navigation",{name:"Chart drawing tools"})).toBeHidden();await expect(page.getByRole("link",{name:"Charts by TradingView"})).toBeVisible();const logo=page.getByRole("link",{name:"Charts by TradingView"});await expect(logo).toHaveCount(1);await expect(logo).toHaveAttribute("href","https://www.tradingview.com/");await expect(logo).toHaveCSS("border-radius","50%");await expect(logo).toHaveCSS("width","36px");await expect(logo).toHaveCSS("height","36px");await expect(logo.locator("img")).toHaveAttribute("src","/brand/tradingview-chart.svg");
 await capture(page,info,"F02","normal-phone-logo","Normal phone chart has the official chart mark inside a circular linked badge.");
 await page.getByRole("button",{name:"Fullscreen chart",exact:true}).click();await expect(page.getByRole("navigation",{name:"Chart drawing tools"})).toBeVisible();
 const buttons=page.locator(".ticket-actions");await expect(buttons).toBeVisible();expect((await buttons.boundingBox())!.y).toBeGreaterThanOrEqual((await page.locator(".analysis-plot").boundingBox())!.y+(await page.locator(".analysis-plot").boundingBox())!.height);
 await capture(page,info,"F01","phone-fullscreen","Phone fullscreen: tools on the left, indicators above, Buy/Sell below the chart, and the original ticket controls below.");
 await capture(page,info,"F02","fullscreen-logo","The circular linked chart mark remains visible in phone fullscreen.");
 await page.getByRole("button",{name:"Exit fullscreen",exact:true}).click();await page.setViewportSize({width:844,height:390});await page.getByRole("button",{name:"Fullscreen chart",exact:true}).click();await capture(page,info,"F01","landscape","Short landscape layout keeps the tool rail scrollable and exit control reachable.");
});

test("every drawing tool, indicators, edit, undo and persistence",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await trade(page);
 const canvas=page.getByLabel("Chart drawings",{exact:true});const box=(await canvas.boundingBox())!;
 const start={x:box.x+box.width*.45,y:box.y+box.height*.45},end={x:box.x+box.width*.7,y:box.y+box.height*.65};
 for(const [label,name] of [["Horizontal line","horizontal"],["Trend line","trend"],["Parallel channel","channel"],["Fibonacci retracement","fib"],["Freehand drawing","brush"],["Text annotation","text"],["Measure","measure"]]){
  await page.getByRole("button",{name:label,exact:true}).click();
  if(name==="text")await page.getByRole("textbox",{name:"Annotation text"}).fill("Gold analysis");
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();
  await expect(canvas.locator("g").first()).toBeAttached();await capture(page,info,"F01",name!,`${label} created on the running chart; anchors follow chart time and price.`);
  if(name==="trend"){
   const handle=canvas.locator('circle[data-anchor="1"]'),line=canvas.locator("line[data-drawing]");const before=await line.getAttribute("y2"),h=(await handle.boundingBox())!;
   await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2-20,h.y+h.height/2-35,{steps:8});await page.mouse.up();
   await expect(line).not.toHaveAttribute("y2",before!);await page.getByRole("button",{name:"Undo drawing change",exact:true}).click();
   await expect(line).toHaveAttribute("y2",before!);await line.click({force:true});
  }
  if(name!=="measure")await page.getByRole("button",{name:"Delete selected drawing"}).click();
 }
 await page.getByRole("button",{name:/ƒx/}).click();
 for(const i of ["SMA","EMA","RSI"]){await page.getByLabel(`${i} 14`,{exact:true}).check();await expect(page.getByTestId("indicator-values")).toContainText(`${i} 14:`);await expect(page.getByTestId("indicator-values")).not.toContainText("Waiting for candles");await capture(page,info,"F01",i.toLowerCase(),`${i} 14 is calculated from chart candles and rendered as a native chart series.`);}
 await page.getByRole("button",{name:"Done",exact:true}).click();
 await page.reload();await expect(page.getByLabel("Chart drawings").locator("g").first()).toBeAttached();await capture(page,info,"F01","restored-analysis","Drawings and indicator selection survive refresh.");
 await page.getByRole("button",{name:/ƒx/}).click();await page.mouse.move(start.x,start.y);
 for(let i=0;i<5;i++){
  // Keep the pointer over the plot while replacing indicator series.
  await page.getByLabel("SMA 14",{exact:true}).evaluate(el=>(el as HTMLInputElement).click());
  await page.getByLabel("SMA 14",{exact:true}).evaluate(el=>(el as HTMLInputElement).click());
 }
 await page.getByRole("button",{name:"Done",exact:true}).click();
 await page.getByRole("button",{name:"Zoom in chart",exact:true}).click();await page.getByRole("button",{name:"Zoom out chart",exact:true}).click();await page.getByRole("button",{name:"Fit chart",exact:true}).click();
 await capture(page,info,"F01","zoom-fit","Zoom controls and fit remain usable with saved analysis.");
});

test("history details from dashboard and History page",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await trade(page);
 await page.getByRole("tab",{name:/closed/i}).click();await page.getByRole("button",{name:/Trade details/}).first().click();
 const dialog=page.getByRole("dialog",{name:"Trade details"});await expect(dialog).toBeVisible();await expect(dialog).toContainText("Net profit/loss");await expect(dialog).toContainText("Close reason");
 await capture(page,info,"F09","dashboard-details","Dashboard Closed rows open a details panel instead of only selecting chart protection.");
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await page.goto("/history?filter=trades");await page.getByRole("button",{name:/Gold/}).first().click();await expect(dialog).toBeVisible();
 await capture(page,info,"F09","history-details","Full History uses the same details panel, with an explicit View on chart action.");
 await page.setViewportSize({width:390,height:844});await capture(page,info,"F09","phone-details","Trade details fit a scrollable phone sheet and show actual close metadata when recorded.");
});

test("bot P&L is removed from every dashboard layout",async({page},info)=>{
 const requests:string[]=[];page.on("request",request=>{if(request.url().includes("/api/markets/bot-pnl"))requests.push(request.url());});
 await trade(page);await expect(page.getByTestId("bot-pnl")).toHaveCount(0);
 await expect(page.getByText("Bot P&L",{exact:false})).toHaveCount(0);
 await capture(page,info,"F01","without-bot-pnl","Selected-market bot P&L has been removed; the chart, custom tools and trading controls remain available.");
 await page.getByRole("button",{name:"Fullscreen chart",exact:true}).click();await expect(page.getByTestId("bot-pnl")).toHaveCount(0);
 await page.waitForTimeout(3200);expect(requests).toEqual([]);
 expect((await page.request.get("/api/markets/bot-pnl?symbol=XAUUSD")).status()).toBe(404);
});

test("deposit offer opens automatically, dismisses and stays dismissed",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await trade(page);
 await page.evaluate(()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith("asm_deposit_offer:"))sessionStorage.removeItem(key);for(const key of Object.keys(localStorage))if(key.startsWith("asm_deposit_offer:"))localStorage.removeItem(key);});
 await page.reload();const dialog=page.getByRole("dialog",{name:"Deposit bonus"});await expect(dialog).toBeVisible({timeout:30000});await expect(dialog).toContainText("100%");
 await capture(page,info,"F03","desktop-offer","The eligible first-deposit promotion opens automatically and includes a close button, deposit action and terms.");
 await page.setViewportSize({width:390,height:844});await capture(page,info,"F03","phone-offer","The same offer adapts to a phone dialogue.");
 await page.keyboard.press("Escape");await expect(dialog).toBeHidden();await capture(page,info,"F03","dismissed","Escape dismisses the offer and returns the dashboard to use.");
 await page.reload();await page.waitForTimeout(21000);await expect(dialog).toBeHidden();
});

test("open trade then drag, confirm and persist TP/SL",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await trade(page);await dismissOffer(page);
 await page.locator("#cfd-stake").click();await page.locator("#cfd-stake").press("ControlOrMeta+A");await page.keyboard.insertText("1000");
 for(let i=0;i<4;i++)await page.getByRole("button",{name:"Longer",exact:true}).click();
 const response=page.waitForResponse(r=>r.url().endsWith("/api/cfd/trades")&&r.request().method()==="POST");
 await page.getByRole("button",{name:/Buy\s*Price goes up/}).click();const opened=await (await response).json();expect(opened.trade?.stake).toBe(100000);
 const id=opened.trade.id;await expect(page.getByRole("button",{name:"Add TP to Buy position"})).toBeVisible();await capture(page,info,"F10","opened-no-exits","A real local demo trade opens with no TP/SL; protection handles become available afterward.");
 for(const [kind,delta] of [["TP",-85],["SL",70]] as const){
  const handle=page.getByRole("button",{name:`Add ${kind} to Buy position`});const b=(await handle.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2+delta,{steps:12});await page.mouse.up();
  const group=page.getByRole("group",{name:"Confirm protection changes"});await expect(group).toBeVisible();await capture(page,info,"F10",`${kind.toLowerCase()}-draft`,`${kind} line is draggable; draft changes require confirmation and do not replace saved protection prematurely.`);
  await group.getByRole("button",{name:"Confirm",exact:true}).click();await expect(group).toBeHidden();
 }
 await page.reload();const stored=await prisma.trade.findUniqueOrThrow({where:{id}});expect(stored.takeProfit).not.toBeNull();expect(stored.stopLoss).not.toBeNull();
 for(const label of ["TP","SL"]){const badge=page.getByRole("button",{name:new RegExp(`^${label} at `)});await expect(badge).toHaveText(/^[+−]?\d+\.\d{2}%$/);await expect(badge).toHaveAttribute("title",/% of investment/);}
 await capture(page,info,"F10","saved-reloaded","Both exits are persisted through the authenticated API and remain visible after refresh.");
 await page.setViewportSize({width:390,height:844});await capture(page,info,"F10","phone-percent-exits","Phone TP/SL labels show projected profit/loss as a percentage of the investment; saved exit prices are unchanged.");await page.setViewportSize({width:1440,height:900});
 await page.getByRole("button",{name:"Edit position protection",exact:true}).first().click();await capture(page,info,"F11","protection-focus","The precise protection editor remains available alongside dragging, with scoped focus styling.");
 const editor=page.getByRole("dialog",{name:"Edit position protection"});await editor.getByRole("button",{name:"Cancel",exact:true}).click();
 const asset=await prisma.asset.findUniqueOrThrow({where:{symbol:"XAUUSD"}});await new CfdDesk().scanPositions(asset.id,asset.symbol,stored.takeProfit!,new Date());
 const settled=await prisma.trade.findUniqueOrThrow({where:{id}});expect(settled.closeReason).toBe("TAKE_PROFIT");expect(settled.closedAt).not.toBeNull();
 await page.reload();await page.getByRole("tab",{name:/closed/i}).click();await page.getByRole("button",{name:`Trade details ${id}`,exact:true}).click();await expect(page.getByRole("dialog",{name:"Trade details"})).toContainText("take profit");
 await capture(page,info,"F10","exit-executed","The real local CFD desk triggers Take Profit and the history panel displays the recorded close reason and time.");
});

test("SEO and standalone input focus",async({browser},info)=>{
 test.skip(info.project.name!=="desktop-chromium");const context=await browser.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[]}});await context.addInitScript(()=>localStorage.setItem("indianxtrade:diwali:2026:seen","1"));const page=await context.newPage();
 await page.goto("/");await expect(page.locator('meta[name="description"]')).toHaveAttribute("content",/30/);await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content",/30/);
 await capture(page,info,"F05","landing-30","Public landing copy and metadata use the shared 30-market catalogue, including commodities.");
 writeFileSync(resolve(evidence,"seo-metadata.json"),JSON.stringify(await page.locator('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]').evaluateAll(n=>n.map(e=>({name:e.getAttribute("name")??e.getAttribute("property"),content:e.getAttribute("content")}))),null,2));
 await page.goto("/login");const email=page.getByRole("textbox",{name:/email/i});await email.focus();await expect(email).toHaveCSS("outline-offset","-2px");await capture(page,info,"F11","login-email-focus","Standalone login input uses an inset focus edge, preserving keyboard visibility without a separated second border.");
 await page.setViewportSize({width:390,height:844});await capture(page,info,"F11","phone-login-focus","The shared standalone input focus correction also applies at phone width.");await context.close();
});

test("Sell protection survives a failed save and its Stop Loss executes",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await trade(page);
 const investment=page.locator("#cfd-stake");await investment.click();await investment.press("ControlOrMeta+A");await page.keyboard.insertText("500");
 const response=page.waitForResponse(r=>r.url().endsWith("/api/cfd/trades")&&r.request().method()==="POST");
 await page.getByRole("button",{name:/Sell\s*Price goes down/}).click();const opened=await(await response).json();expect(opened.trade.direction).toBe("SHORT");const id=opened.trade.id;
 for(const [kind,delta]of [["TP",65],["SL",-75]]as const){const b=(await page.getByRole("button",{name:`Add ${kind} to Sell position`}).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2+delta,{steps:12});await page.mouse.up();const group=page.getByRole("group",{name:"Confirm protection changes"});await group.getByRole("button",{name:"Confirm",exact:true}).click();await expect(group).toBeHidden();}
 const saved=await prisma.trade.findUniqueOrThrow({where:{id}});for(const label of ["TP","SL"])await expect(page.getByRole("button",{name:new RegExp(`^${label} at `)})).toHaveText(/^[+−]?\d+\.\d{2}%$/);await capture(page,info,"F10","sell-saved-exits","A Sell position has persisted TP below entry and SL above entry, with profit/loss shown as a percentage of investment.");
 await page.getByRole("button",{name:"Edit position protection",exact:true}).first().click();const editor=page.getByRole("dialog",{name:"Edit position protection"});const price=editor.getByRole("spinbutton",{name:"TP price",exact:true});await price.click();await price.press("ControlOrMeta+A");await page.keyboard.insertText(String(Number((saved.takeProfit!-.05).toFixed(2))));await expect(price).toHaveCSS("outline-offset","-2px");await capture(page,info,"F11","protection-price-focused","The protection price input has a single inset keyboard-focus edge.");
 await page.route(`**/api/cfd/trades/${id}`,route=>route.abort("failed"),{times:1});await editor.getByRole("button",{name:"Confirm",exact:true}).click();await expect(editor.getByRole("alert")).toBeVisible();expect((await prisma.trade.findUniqueOrThrow({where:{id}})).takeProfit).toBe(saved.takeProfit);
 await capture(page,info,"F10","failed-save","An intentionally interrupted PATCH shows an error while the previously saved protection remains unchanged.");await editor.getByRole("button",{name:"Cancel",exact:true}).click();
 const asset=await prisma.asset.findUniqueOrThrow({where:{symbol:"XAUUSD"}});await new CfdDesk().scanPositions(asset.id,asset.symbol,saved.stopLoss!,new Date());expect((await prisma.trade.findUniqueOrThrow({where:{id}})).closeReason).toBe("STOP_LOSS");await page.reload();await page.getByRole("tab",{name:/closed/i}).click();await page.getByRole("button",{name:`Trade details ${id}`,exact:true}).click();await capture(page,info,"F10","sell-stop-executed","The real local CFD desk executes the Sell Stop Loss and stores its closing metadata.");
});

test("focus styling across search and payment input families",async({page},info)=>{
 test.skip(info.project.name!=="desktop-chromium");await page.setViewportSize({width:1920,height:1080});await trade(page);
 const search=page.getByRole("textbox",{name:"Search sidebar markets"});await search.focus();await expect(search).toHaveCSS("outline-offset","-2px");await capture(page,info,"F11","market-search-focused","The standalone market-search field has one inset focus edge.");
 await page.goto("/deposit");const amount=page.locator("#deposit-amount");await amount.focus();await expect(amount).toHaveCSS("outline-offset","-2px");await capture(page,info,"F11","deposit-amount-focused","The same focus policy works for the larger deposit input without submitting any deposit.");
});
