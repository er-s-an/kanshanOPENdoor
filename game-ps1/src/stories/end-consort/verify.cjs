/* Actual browser inputs only: no teleport, phase mutation, or test-only auto-complete.
 * Node 25+ for importing world.ts. PLAYWRIGHT_MODULE can point to an installed Playwright.
 * Run the Vite dev server first, then node src/stories/end-consort/verify.cjs.
 */
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
let playwright
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core') }
catch (error) {
  throw new Error('Install game-ps1 dependencies or set PLAYWRIGHT_MODULE to a local Playwright module.', { cause: error })
}
const out = path.join(__dirname, 'evidence')
const baseURL = process.env.CONSORT_URL || 'http://127.0.0.1:5188/end-consort.html'
const normal = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

async function main() {
  await mkdir(out, { recursive: true })
  const THREE = await import('three')
  const { buildConsortWorld } = await import(pathToFileURL(path.join(__dirname, 'world.ts')).href)
  const world = buildConsortWorld(new THREE.Scene())
  const blocked = (x, z) => world.colliders.some(b => b.max.y > .3 && b.min.y < 1.8 && x + .26 > b.min.x && x - .26 < b.max.x && z + .26 > b.min.z && z - .26 < b.max.z)
  // World geometry only plans a walking route. The browser still executes every move.
  const findPath = (start, target) => {
    const step = .35
    const xy = (x, z) => [Math.round(x / step), Math.round(z / step)]
    const key = ([x,z]) => `${x},${z}`
    const first = xy(start[0], start[2])
    const nodes = [first]
    const prev = new Map([[key(first), null]])
    let end = null
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], x = n[0]*step, z=n[1]*step
      if (Math.hypot(x-target.position[0],z-target.position[2]) < target.radius - .35) { end=n;break }
      for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const next=[n[0]+dx,n[1]+dz], id=key(next), nx=next[0]*step,nz=next[1]*step
        if(nx < -8.7 || nx > 8.7 || nz < -9.6 || nz > 9.5 || prev.has(id) || blocked(nx,nz)) continue
        prev.set(id,n);nodes.push(next)
      }
    }
    assert(end,`No walking route to ${target.id}`)
    const route=[]
    while(end){route.push([end[0]*step,end[1]*step]);end=prev.get(key(end))}
    route.reverse()
    // Keep the geometry-safe grid turns. `walk` re-faces and remeasures during
    // each short stride, so a long open lane cannot become a one-shot input.
    const compact=[]
    for(let i=1;i<route.length;i++){
      const previous=route[i-1],current=route[i],next=route[i+1]
      if(!next || Math.sign(current[0]-previous[0])!==Math.sign(next[0]-current[0]) || Math.sign(current[1]-previous[1])!==Math.sign(next[1]-current[1]))compact.push(current)
    }
    return compact
  }
  // Chrome's normal headless compositor captures this WebGL canvas reliably on
  // this host. Forced SwiftShader can leave screenshot capture waiting forever.
  const browser = await playwright.chromium.launch({ channel:'chrome',headless:true,args:['--no-proxy-server'] })
  const page = await browser.newPage({ viewport:{ width:1365,height:900 } })
  page.setDefaultTimeout(15000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const snapshot=()=>page.evaluate(()=>window.__consortSnapshot())
  const shot=name=>page.screenshot({path:path.join(out,name),timeout:15000})
  async function face(point){
    const s=await snapshot()
    const yaw=Math.atan2(-(point[0]-s.position[0]),-(point[1]-s.position[2]))
    const delta=normal(yaw-s.yaw)
    if(Math.abs(delta)<.012)return
    await page.mouse.move(682,470)
    await page.mouse.down()
    await page.mouse.move(682-delta/.005,470,{steps:Math.max(4,Math.ceil(Math.abs(delta)/.18))})
    await page.mouse.up()
  }
  async function walk(point){
    await page.bringToFront()
    try {
      for(let attempt=0;attempt<240;attempt++){
        const before=await snapshot()
        const remaining=Math.hypot(point[0]-before.position[0],point[1]-before.position[2])
        if(remaining < .24)return
        // Re-face before each short, genuine keyboard stride. A dropped drag or
        // a collision can no longer leave a multi-metre compacted segment stuck.
        await face(point)
        await page.keyboard.down('w')
        await page.waitForTimeout(35)
        await page.keyboard.up('w')
      }
      throw Error(`Walking input did not reach ${JSON.stringify(point)}`)
    } finally { await page.keyboard.up('w') }
  }
  try {
    await page.goto(baseURL,{waitUntil:'commit',timeout:30000})
    await page.waitForFunction(()=>typeof window.__consortSnapshot==='function',null,{timeout:30000})
    await shot('01-cover.png')
    await page.locator('#start').click()
    await shot('02-courtyard.png')
    let lastPhase=''
    let actions=0
    let turnPosition
    for(;actions<350;actions++){
      const s=await snapshot()
      if(s.phase!==lastPhase){console.log('phase',s.phase);lastPhase=s.phase}
      if(s.ended)break
      if(s.phase==='turn' && !s.busy){
        assert.equal(s.actorsVisible.emperor,false,'Emperor revealed before turning')
        turnPosition=[...s.position]
      }
      if(s.phase==='weed')assert.equal(s.actorsVisible.defei,false,'Weeding before Defei left')
      if(await page.locator('#dialog').isVisible()){
        await page.keyboard.press('e')
        continue
      }
      if(await page.locator('#custom').isVisible()){
        if(await page.locator('#pack-books').count()){
          await page.locator('#pack-books').click();await page.locator('#pack-seeds').click();await page.locator('#pack-done').click()
        }else if(await page.locator('#give-ledger').count()){
          await page.locator('#errand').click();assert.equal((await snapshot()).phase,'fushun');await page.locator('#give-ledger').click()
        }else if(await page.locator('#wait-done').count()){
          await page.locator('#wait-done').click({timeout:8000})
        }else if(await page.locator('#board').count()){
          await shot(`chess-${s.chessStep}.png`)
          if(s.chessStep<3){
            if(s.chessStep===0){await page.locator('[data-cell="0"]').click();assert.equal((await snapshot()).chessStep,0)}
            await page.locator('#board .target').click()
          }else await page.locator('#chess-assist').click()
        }else if(await page.locator('#accept-win').count())await page.locator('#accept-win').click()
        else throw Error('Unrecognized modal')
        continue
      }
      if(s.phase==='turn'){
        // E alone must not reveal the emperor. The player has to use the same
        // mouse turn as a real run, then E can open the gate and reveal him.
        assert.equal(await page.locator('#interact').isDisabled(),true,'Turn interaction was enabled before facing the gate')
        await page.keyboard.press('e')
        const premature=await snapshot()
        assert.equal(premature.phase,'turn','Premature E advanced the reveal')
        assert.equal(premature.actorsVisible.emperor,false,'Premature E revealed the emperor')
        assert(Math.hypot(premature.position[0]-turnPosition[0],premature.position[2]-turnPosition[2])<.02,'Premature E moved the player')
        await face([world.anchors.gate.x,world.anchors.gate.z])
        await page.waitForFunction(()=>!document.querySelector('#interact').disabled,null,{timeout:10000})
        const faced=await snapshot()
        assert(Math.abs(normal(faced.yaw-s.yaw))>.5,'Mouse turn did not change the camera heading')
        await page.keyboard.press('e')
        const after=await snapshot()
        assert.equal(after.actorsVisible.emperor,true,'Emperor was not revealed after turning')
        assert(Math.hypot(after.position[0]-turnPosition[0],after.position[2]-turnPosition[2])<.02,'Turning required walking')
        continue
      }
      const target=s.target
      assert(target,`No target for ${s.phase}`)
      if(Math.hypot(s.position[0]-target.position[0],s.position[2]-target.position[2])>target.radius-.1){
        for(const point of findPath(s.position,target))await walk(point)
      }
      if(s.phase==='talk')await page.waitForFunction(()=>!document.querySelector('#interact').disabled,null,{timeout:20000})
      await page.keyboard.press('e')
      if(s.phase==='sow' || s.phase==='defei')await shot(`phase-${s.phase}.png`)
    }
    const result=await snapshot()
    assert(result.ended,'Did not reach textual boundary')
    assert.deepEqual(result.plotState,[3,3,3])
    assert.equal(result.handsClean,true)
    assert.equal(result.chessStep,3)
    assert.equal(errors.length,0,errors.join('\n'))
    const text=result.events.map(e=>e.action).join('\n')
    assert(text.indexOf('臣妾输了。')<text.indexOf('你没输。'))
    assert(text.indexOf('你没输。')<text.indexOf('那臣妾赢了。'))
    assert.equal(result.events.filter(e=>e.action==='萧寻: 「御史参了朕一个时').length,1)
    await shot('09-boundary.png')
    await writeFile(path.join(out,'browser-run.json'),JSON.stringify({url:baseURL,mode:'Headless desktop Chrome, actual keyboard/mouse controls',actions,errors,result},null,2))
    console.log('DESKTOP_PASS',actions,'actions',result.events.length,'events')
    await page.locator('#again').click()
    await page.waitForFunction(()=>window.__consortSnapshot && !window.__consortSnapshot().started)
    assert(await page.locator('#cover').isVisible(),'Restart did not restore cover')
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2})
    mobile.on('pageerror',error=>errors.push(error.message))
    await mobile.goto(baseURL,{waitUntil:'commit',timeout:30000})
    await mobile.waitForFunction(()=>typeof window.__consortSnapshot==='function',null,{timeout:30000})
    await mobile.screenshot({path:path.join(out,'10-mobile-cover.png')})
    await mobile.locator('#start').tap()
    assert.equal(await mobile.locator('.mobilepad').isVisible(),true)
    const initial=await mobile.evaluate(()=>window.__consortSnapshot().position)
    const button=await mobile.locator('[data-move="KeyW"]').boundingBox()
    await mobile.mouse.move(button.x+button.width/2,button.y+button.height/2)
    await mobile.mouse.down();await mobile.waitForTimeout(450);await mobile.mouse.up()
    const moved=await mobile.evaluate(()=>window.__consortSnapshot().position)
    assert(Math.hypot(initial[0]-moved[0],initial[2]-moved[2])>.2,'Mobile movement pad failed')
    const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
    assert.equal(overflow,false,'Horizontal overflow on mobile')
    await mobile.screenshot({path:path.join(out,'11-mobile-courtyard.png')})
    assert.equal(errors.length,0)
    console.log('MOBILE_SMOKE_PASS, RESTART_PASS')
  }catch(error){
    await shot('failure.png').catch(()=>{})
    console.error('STATE',JSON.stringify(await snapshot().catch(()=>({}))))
    throw error
  }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
