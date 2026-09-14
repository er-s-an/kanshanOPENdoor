import QRCode from 'qrcode'

const W = 1080
const H = 1440
const STORY_QUERY = 'story=consort-3d'
const CANONICAL_PORTAL_URL = `https://kanshan.makebook.hk2048.online/?${STORY_QUERY}`
const SERIF = '"Songti SC","Noto Serif SC",serif'
const SANS = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'

type PageLocation = Pick<Location, 'protocol' | 'origin' | 'pathname'>

/**
 * A built experience is copied below /myopia-3d/. Trim that directory to get
 * back to the portal, while retaining a possible deployment subdirectory.
 * A direct end-consort.html preview has no such parent, so it deliberately
 * shares the stable production door instead of a non-portable local URL.
 */
export function getConsortPortalUrl(page: PageLocation | undefined = typeof window === 'undefined' ? undefined : window.location): string {
  if (!page || !/^https?:$/.test(page.protocol) || !page.origin || page.origin === 'null') return CANONICAL_PORTAL_URL
  const experienceDirectory = '/myopia-3d/'
  const start = page.pathname.lastIndexOf(experienceDirectory)
  if (start < 0) return CANONICAL_PORTAL_URL
  const portalPath = page.pathname.slice(0, start + 1)
  return new URL(`${portalPath}?${STORY_QUERY}`, page.origin).toString()
}

const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('二维码生成失败'))
    image.src = src
  })
}

function drawPalace(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.translate(W / 2, 405)
  ctx.fillStyle = 'rgba(238, 213, 151, .18)'
  ctx.strokeStyle = 'rgba(239, 203, 111, .72)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(-330, -48)
  ctx.lineTo(0, -260)
  ctx.lineTo(330, -48)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(28, 55, 43, .62)'
  ctx.fillRect(-268, -45, 536, 330)
  ctx.strokeRect(-268, -45, 536, 330)
  for (let x = -205; x <= 205; x += 102) {
    ctx.strokeStyle = 'rgba(239, 203, 111, .45)'
    ctx.beginPath()
    ctx.moveTo(x, -42)
    ctx.lineTo(x, 282)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(239, 203, 111, .25)'
  rounded(ctx, -70, 52, 140, 230, 64)
  ctx.fill()
  ctx.strokeStyle = 'rgba(239, 203, 111, .7)'
  ctx.stroke()
  ctx.restore()
}

export async function createConsortShareCard(): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const outer = ctx.createLinearGradient(0, 0, W, H)
  outer.addColorStop(0, '#173c32')
  outer.addColorStop(.55, '#637047')
  outer.addColorStop(1, '#b9864e')
  ctx.fillStyle = outer
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#162f28'
  rounded(ctx, 34, 34, 1012, 1372, 42)
  ctx.fill()
  ctx.fillStyle = '#f2e5c7'
  rounded(ctx, 56, 56, 968, 1328, 28)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#56744e'
  rounded(ctx, 76, 76, 206, 54, 27)
  ctx.fill()
  ctx.fillStyle = '#f2e5c7'
  ctx.font = `800 20px ${SANS}`
  ctx.fillText('CONSORT / 3D', 179, 111)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#778065'
  ctx.font = `600 19px ${SANS}`
  ctx.fillText('开放篇章记录 · KANSHAN DOOR', 986, 111)

  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(183, 127, 63, .12)'
  ctx.font = `900 178px ${SANS}`
  ctx.fillText('JING HUA', W / 2, 455)
  ctx.fillStyle = 'rgba(86, 116, 78, .14)'
  rounded(ctx, 164, 152, 752, 570, 42)
  ctx.fill()
  drawPalace(ctx)
  ctx.fillStyle = '#33483b'
  ctx.font = `700 18px ${SANS}`
  ctx.fillText('把景华宫，过成自己的日子。', W / 2, 680)

  ctx.fillStyle = '#283e33'
  ctx.font = `800 66px ${SERIF}`
  ctx.fillText('景 华 宫 的 日 子', W / 2, 806)
  ctx.fillStyle = '#778065'
  ctx.font = `500 26px ${SERIF}`
  ctx.fillText('种下萝卜，也把日子过成自己。', W / 2, 858)
  ctx.fillStyle = '#56744e'
  rounded(ctx, 336, 905, 408, 40, 20)
  ctx.fill()
  ctx.fillStyle = '#f2e5c7'
  ctx.font = `800 16px ${SANS}`
  ctx.fillText('《端妃黑又壮》· 开放篇章', W / 2, 932)
  ctx.fillStyle = '#33483b'
  ctx.font = `800 49px ${SERIF}`
  ctx.fillText('日子，已经有了模样。', W / 2, 1019)
  ctx.strokeStyle = 'rgba(86, 116, 78, .42)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(162, 1061)
  ctx.lineTo(918, 1061)
  ctx.stroke()
  ctx.fillStyle = '#778065'
  ctx.font = `600 20px ${SANS}`
  ctx.fillText('PS1 沉浸体验 · 开放文本止于 L177', W / 2, 1126)

  ctx.fillStyle = '#213b30'
  rounded(ctx, 76, 1180, 928, 180, 22)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = '#efd787'
  ctx.font = `700 27px ${SERIF}`
  ctx.fillText('扫二维码，打开这扇门', 116, 1240)
  ctx.fillStyle = 'rgba(242, 229, 199, .78)'
  ctx.font = `19px ${SANS}`
  ctx.fillText('看山任意门 · 每次打开，都是另一段故事', 116, 1284)
  ctx.fillStyle = 'rgba(242, 229, 199, .52)'
  ctx.font = `16px ${SANS}`
  ctx.fillText('固定入口 · 不带走你的进度或选择', 116, 1323)
  ctx.textAlign = 'center'
  try {
    const code = await loadImage(await QRCode.toDataURL(getConsortPortalUrl(), {
      errorCorrectionLevel: 'M', margin: 1, width: 240,
      color: { dark: '#173c32', light: '#fffdf7' },
    }))
    ctx.fillStyle = '#fffdf7'
    rounded(ctx, 844, 1198, 142, 142, 16)
    ctx.fill()
    ctx.drawImage(code, 858, 1212, 114, 114)
  } catch {
    // A record card is still useful if a restrictive browser blocks Canvas data URLs.
  }
  return canvas
}

function asBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成记录卡失败')), 'image/png'))
}

export async function saveConsortShareCard() {
  const blob = await asBlob(await createConsortShareCard())
  const objectUrl = URL.createObjectURL(blob)
  const download = document.createElement('a')
  download.href = objectUrl
  download.download = '端妃黑又壮-景华宫记录卡.png'
  download.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4_000)
}

export async function shareConsortShareCard() {
  const navigatorWithShare = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean }
  if (!navigatorWithShare.share) {
    await saveConsortShareCard()
    return 'saved' as const
  }
  const blob = await asBlob(await createConsortShareCard())
  const file = new File([blob], '端妃黑又壮-景华宫记录卡.png', { type: 'image/png' })
  const data: ShareData = {
    title: '我的《端妃黑又壮》篇章记录',
    text: '我在《端妃黑又壮》里，把景华宫过成了自己的日子。你会怎么开始？',
    url: getConsortPortalUrl(),
  }
  if (navigatorWithShare.canShare?.({ files: [file] })) data.files = [file]
  await navigatorWithShare.share(data)
  return 'shared' as const
}
