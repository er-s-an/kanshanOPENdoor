import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
const out = path.dirname(new URL(import.meta.url).pathname)
const browser = await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']})
const page = await browser.newPage({viewport:{width:1440,height:900}, deviceScaleFactor:1})
const errors=[], screens=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png'),timeout:15000});screens.push(name)}
try {
 await page.goto('http://127.0.0.1:5186/blue-blood.html',{waitUntil:'networkidle'})
 await shot('01-title')
 await page.locator('#start').click()
 await page.waitForFunction(()=>window.__blueBloodTest?.snapshot().task==='training.teacher')
 const before=await page.evaluate(()=>window.__blueBloodTest.snapshot().position)
 await page.keyboard.down('KeyW');await page.waitForTimeout(1600);await page.keyboard.up('KeyW')
 const after=await page.evaluate(()=>window.__blueBloodTest.snapshot().position)
 if(Math.abs(before[2]-after[2])<.02) throw Error('WASD did not move camera')
 await shot('02-training')
 if(process.argv.includes('--opening-only')) {await fs.writeFile(path.join(out,'opening.json'),JSON.stringify({before,after,errors,screens},null,2));process.exitCode=errors.length?1:0;await browser.close();process.exit()}
 const captured=new Set()
 let completed=false
 for(let i=0;i<450;i++) {
  const s=await page.evaluate(()=>window.__blueBloodTest.snapshot())
  if(s.finished){await shot('08-boundary');completed=true;break}
  if(s.mirror){
   await page.locator('#phone-angle').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))})
   if(!captured.has('mirror')) {await page.waitForTimeout(1300);await shot('05-mirror');captured.add('mirror')}
   await page.waitForTimeout(400);continue
  }
  if(await page.locator('#dialog-next').count()){await page.locator('#dialog-next').click();continue}
  if(await page.locator('[data-query]').count()) {for(const b of await page.locator('[data-query]').all())await b.click();await page.locator('#search-done').click();continue}
  if(await page.locator('#answer-blood').count()) {
   await page.locator('#answer-blood').selectOption('red');await page.locator('#answer-hair').selectOption('black');await page.locator('#exam-done').click()
   if(!(await page.locator('#exam-feedback').innerText()).includes('草稿'))throw Error('Incorrect exam answers were accepted')
   await page.locator('#answer-blood').selectOption('blue');await page.locator('#answer-hair').selectOption('white');await shot('04-exam');await page.locator('#exam-done').click();continue
  }
  if(await page.locator('[data-note]').count()){for(const b of await page.locator('[data-note]').all())if(await b.isEnabled())await b.click();await shot('07-notes');await page.locator('#notes-done').click();continue}
  if(await page.locator('#type-question').count()) {const b=page.locator('#type-question');if(await b.isEnabled())await b.click();else await page.waitForTimeout(300);continue}
  if(s.busy){
   if(s.task==='washroom.gap'&&!captured.has('blood')){await page.waitForTimeout(1500);await shot('03-blood');captured.add('blood')}
   if(s.task==='street.seat'&&!captured.has('street')){await page.waitForTimeout(3500);await shot('06-window');captured.add('street')}
   await page.waitForTimeout(200);continue
  }
  if(s.task){
   const moved=await page.evaluate(()=>window.__blueBloodTest.moveToTask())
   if(!moved)throw Error('No accessible position for '+s.task)
   await page.locator('#interact').click()
   await page.waitForTimeout(80)
  }else await page.waitForTimeout(200)
 }
 if(!completed)throw Error('Did not reach source boundary')
 const final=await page.evaluate(()=>window.__blueBloodTest.snapshot())
 if(final.sourceEnd!=='【记性不好，总是把地标建筑记错城市')throw Error('Source boundary changed')
 for(const event of ['training.publicCorrection','washroom.blueToRed','night.postDeleted','exam.blueWhite','mirror.look:3','street.turn1','street.turn2','street.turn3','street.manPassed','street.nightWithoutReturn','notes.attributedHypothesis','sourceBoundary:L139'])if(!final.history.includes(event))throw Error('Missing event '+event)
 await page.reload({waitUntil:'networkidle'})
 if(!(await page.locator('#continue').count()))throw Error('Missing resume button')
 await page.locator('#continue').click();await page.waitForFunction(()=>window.__blueBloodTest.snapshot().task==='notes.lock')
 await page.keyboard.press('Escape');await page.waitForTimeout(100)
 if(!(await page.evaluate(()=>window.__blueBloodTest.snapshot().paused)))throw Error('Pause did not freeze')
 await page.locator('#resume').click()
 const report={completed:true,before,after,final,resumeChapter:(await page.evaluate(()=>window.__blueBloodTest.snapshot())).chapter,errors,screens,limitations:['Development-only placement used between tasks; story interactions and panels were real.','WASD movement smoke-tested; complete physical navigation separately checked against collider grid.','Headless Chromium screenshots do not prove physical mobile controls or human audio quality.']}
 await fs.writeFile(path.join(out,'playthrough.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify({completed:true,history:final.history.length,errors,screens}))
 if(errors.length)process.exitCode=1
} catch(e) {console.error(e);await shot('failure');await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(e),errors,state:await page.evaluate(()=>window.__blueBloodTest?.snapshot())},null,2));process.exitCode=1}
await browser.close()
