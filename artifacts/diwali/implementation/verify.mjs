import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.DIWALI_TEST_URL || 'http://localhost:3000';
const server = process.env.DIWALI_TEST_URL ? null : spawn('pnpm', ['--filter','@asm/web','dev'], {stdio:'ignore',detached:true});
let browser;
try {
  for(let i=0;i<100;i++) { try { if((await fetch(`${base}/diwali-preview`)).ok) break; } catch {} await new Promise(r=>setTimeout(r,300)); }
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/diwali-preview`);
  await page.getByRole('button',{name:'Celebrate Diwali',exact:true}).first().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'Celebrate with sound',exact:true}).click();
  assert(await page.getByRole('button',{name:'Play quietly',exact:true}).isDisabled());
  await page.waitForTimeout(900);
  await page.screenshot({path:'artifacts/diwali/implementation/desktop-fireworks.png'});
  await page.getByRole('button',{name:'Mute sound',exact:true}).click();
  assert(await page.getByRole('button',{name:'Unmute site sounds'}).isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Mobile',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/diwali/implementation/mobile-lights.png'});
  await page.getByRole('button',{name:'Celebrate Diwali',exact:true}).first().click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(100);
  assert(await page.getByRole('button',{name:'Play quietly',exact:true}).isDisabled());
  await page.screenshot({path:'artifacts/diwali/implementation/mobile-greeting.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: preview desktop/mobile, replay guard, mute state, Escape, reduced motion; no page errors.');
} finally { await browser?.close(); try {server && process.kill(-server.pid,'SIGTERM');} catch {} }
