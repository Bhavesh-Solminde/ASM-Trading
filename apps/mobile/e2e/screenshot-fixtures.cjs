// Local screenshot-only fixture server. Never connects to production or accepts money actions.
const http = require('node:http');
const { createRequire } = require('node:module');
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const { WebSocketServer } = cliRequire('ws');
const demo='11111111-1111-4111-8111-111111111111', live='22222222-2222-4222-8222-222222222222';
const accounts=[{id:demo,type:'DEMO',currency:'INR',realBalance:1000000,bonusBalance:0},{id:live,type:'LIVE',currency:'INR',realBalance:1195000,bonusBalance:50000}];
const ts=Math.floor(Date.now()/1000);
const open={id:'33333333-3333-4333-8333-333333333333',accountId:demo,symbol:'NIFTY50',direction:'UP',stake:10000,payoutPct:93,entryPrice:23942.3,entryTs:ts-120,expiryTs:ts+1200,exitPrice:null,status:'OPEN',pnl:0};
const closed={...open,id:'44444444-4444-4444-8444-444444444444',status:'WON',entryTs:ts-3600,expiryTs:ts-3540,exitPrice:23960.8,pnl:9300};
const boot={userId:'55555555-5555-4555-8555-555555555555',assets:[{symbol:'NIFTY50',displayName:'NIFTY 50',precision:2,payoutPct:93,assetClass:'INDEX'}],accounts,recentTrades:[open,closed],defaultSymbol:'NIFTY50',liveAccess:true,completedDeposits:1,profile:{nickname:'Screenshot Test',email:'screenshots@example.test',kycStatus:'NOT_STARTED',locale:'en'}};
const row={createdAt:new Date().toISOString(),updatedAt:null,currency:'INR',destination:null,expiresAt:null,holdUntil:null,cancelableUntil:null};
const server=http.createServer((req,res)=>{let out;const u=new URL(req.url,'http://localhost');
if(u.pathname==='/api/v1/app/config')out={minVersion:'0.1.0',latestVersion:'0.1.0',apkUrl:'https://example.test/app.apk',playUrl:null,playLive:true,support:{whatsapp:null,telegram:null}};
else if(u.pathname==='/api/auth/login')out={token:'local-screenshot-fixture-only',userId:boot.userId};
else if(u.pathname==='/api/auth/ws-ticket')out={ticket:'fixture-only'};
else if(u.pathname==='/api/v1/bootstrap')out=boot;
else if(u.pathname==='/api/v1/preferences')out={locale:'en'};
else if(u.pathname==='/api/trades' && req.method==='GET')out={trades:u.searchParams.get('accountId')===live?[]:[open,closed]};
else if(u.pathname==='/api/v1/wallet')out={accounts,withdrawable:1195000,lockedBonus:50000,completedDeposits:1,nextBonusPercent:50,bonusTiers:[100,50,25]};
else if(u.pathname==='/api/v1/payments')out={rows:[{...row,key:'deposit-fixture',id:'d-fixture',kind:'deposit',status:'COMPLETED',methodLabel:'UPI',amountMinor:200000},{...row,key:'withdrawal-fixture',id:'w-fixture',kind:'withdrawal',status:'REQUESTED',methodLabel:'Bank',amountMinor:70000}],nextCursor:null};
else {res.statusCode=403;out={error:'Screenshot fixture server: action disabled',code:'fixture_only'};}
res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));});
const wss=new WebSocketServer({server});wss.on('connection',ws=>{const send=x=>ws.send(JSON.stringify(x));send({type:'ready',serverTs:Date.now()});ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='auth')send({type:'authed'});if(msg.type==='subscribe'){const candles=[];let last=23920;for(let i=0;i<150;i++){const o=last,c=o+Math.sin(i*1.7)*7+Math.cos(i*.41)*4+.25;last=c;candles.push({openTs:ts-(150-i)*60,o,h:Math.max(o,c)+3,l:Math.min(o,c)-3,c});}send({type:'candles:history',symbol:msg.symbol,timeframe:msg.timeframe,candles});send({type:'tick',symbol:msg.symbol,price:last,ts:Date.now()});send({type:'payout:update',symbol:msg.symbol,payoutPct:93});send({type:'sentiment',symbol:msg.symbol,upPct:57,downPct:43});}});});
server.listen(3217,'127.0.0.1',()=>console.log('Screenshot fixtures on 3217; all trading/payment actions disabled'));
