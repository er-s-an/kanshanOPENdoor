import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
const out=path.dirname(new URL(import.meta.url).pathname)
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true})
const errors=[];page.on('pageerror',e=>errors.push(String(e)))
try{
 await page.goto('http://127.0.0.1:5186/blue-blood.html',{waitUntil:'networkidle'})
 await page.screenshot({path:path.join(out,'09-mobile-title.png')})
 await page.locator('#start').tap();await page.waitForFunction(()=>window.__blueBloodTest?.snapshot().task==='training.teacher')
 const b=await page.locator('[data-key="KeyW"]').boundingBox();if(!b)throw Error('Touch forward missing')
 const pos0=await page.evaluate(()=>window.__blueBloodTest.snapshot().position)
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]})
 await page.waitForTimeout(650)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 const pos1=await page.evaluate(()=>window.__blueBloodTest.snapshot().position)
 if(Math.abs(pos0[2]-pos1[2])<.02)throw Error('Touch direction did not move')
 await page.screenshot({path:path.join(out,'10-mobile-scene.png')})
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile horizontal overflow')
 await page.locator('#menu').tap();await page.locator('#resume').tap()
 await page.evaluate(()=>localStorage.setItem('kanshan.blue-blood.chapter.v1',JSON.stringify({version:1,chapter:5})))
 await page.reload({waitUntil:'networkidle'});await page.locator('#continue').tap()
 await page.waitForFunction(()=>window.__blueBloodTest.snapshot().task==='restaurant.phone')
 await page.evaluate(()=>window.__blueBloodTest.moveToTask());await page.locator('#interact').tap();await page.locator('#dialog-next').tap()
 await page.waitForFunction(()=>window.__blueBloodTest.snapshot().mirror)
 await page.locator('#phone-angle').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))})
 await page.waitForFunction(()=>document.querySelector('#phone-counter')?.textContent.includes('保持这个角度'))
 await page.screenshot({path:path.join(out,'11-mobile-mirror.png')})
 await page.waitForFunction(()=>window.__blueBloodTest.snapshot().mirrorLooks===3,{},{timeout:30000})
 await fs.writeFile(path.join(out,'mobile-smoke.json'),JSON.stringify({viewport:[390,844],overflow,pos0,pos1,errors,limitations:['Emulated mobile only; CDP touch events for held movement. Physical touch and audio not verified.']},null,2))
 console.log(JSON.stringify({mobileSmoke:errors.length===0,overflow,errors}));if(errors.length)process.exitCode=1
}finally{await browser.close()}
