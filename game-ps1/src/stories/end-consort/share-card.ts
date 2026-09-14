import QRCode from 'qrcode'

const W = 1080
const H = 1440
const STORY_QUERY = 'story=consort-3d'
const CANONICAL_PORTAL_URL = `https://kanshan.makebook.hk2048.online/?${STORY_QUERY}`
const SERIF = '"Songti SC","Noto Serif SC",serif'
const SANS = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'

type PageLocation = Pick<Location, 'protocol' | 'origin' | 'pathname'>

/**
 * These are deliberately small, story-facing keepsakes rather than player
 * types. They are drawn once after an open chapter finishes and never claim to
 * diagnose the player from the limited 3D interactions.
 */
export type ConsortKeepsake = Readonly<{
  id: 'roster' | 'seeds' | 'water' | 'chess'
  name: string
  line: string
  marker: string
  colors: Readonly<{ ink: string; accent: string; wash: string }>
}>

export const CONSORT_KEEPSAKES: readonly ConsortKeepsake[] = [
  {
    id: 'roster',
    name: '景华宫名册',
    line: '把人留下来，也把该做的事一件件写清。',
    marker: '安顿',
    colors: { ink: '#33483b', accent: '#56744e', wash: '#d7dfba' },
  },
  {
    id: 'seeds',
    name: '萝卜种子袋',
    line: '土翻松了，种子才有地方慢慢落下。',
    marker: '播种',
    colors: { ink: '#5b4430', accent: '#9b6d3b', wash: '#eed8a5' },
  },
  {
    id: 'water',
    name: '洗手的清水',
    line: '做完手边的活，再干干净净坐到石桌前。',
    marker: '洗净',
    colors: { ink: '#31545c', accent: '#4c8290', wash: '#c7e3df' },
  },
  {
    id: 'chess',
    name: '石桌残局',
    line: '棋势已经明白，话仍要照实说出来。',
    marker: '落子',
    colors: { ink: '#3e4130', accent: '#6e7447', wash: '#dde0b8' },
  },
]

export function drawConsortKeepsake(random = Math.random()): ConsortKeepsake {
  const normalized = Number.isFinite(random) ? Math.min(Math.max(random, 0), .999999) : 0
  return CONSORT_KEEPSAKES[Math.floor(normalized * CONSORT_KEEPSAKES.length)]!
}

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

function drawKeepsakeMotif(ctx: CanvasRenderingContext2D, record: ConsortKeepsake) {
  ctx.save()
  ctx.translate(W / 2, 420)
  ctx.strokeStyle = record.colors.accent
  ctx.fillStyle = record.colors.wash
  ctx.lineWidth = 9

  if (record.id === 'roster') {
    rounded(ctx, -245, -232, 490, 455, 24)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = `${record.colors.accent}bb`
    ctx.lineWidth = 5
    for (let row = -138; row <= 120; row += 86) {
      ctx.beginPath()
      ctx.moveTo(-152, row)
      ctx.lineTo(152, row)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-152, row + 27)
      ctx.lineTo(52, row + 27)
      ctx.stroke()
    }
    ctx.fillStyle = record.colors.accent
    ctx.beginPath()
    ctx.arc(-148, -164, 16, 0, Math.PI * 2)
    ctx.arc(-148, -78, 16, 0, Math.PI * 2)
    ctx.arc(-148, 8, 16, 0, Math.PI * 2)
    ctx.fill()
  } else if (record.id === 'seeds') {
    ctx.strokeStyle = `${record.colors.accent}bb`
    ctx.lineWidth = 7
    for (let y = -145; y <= 145; y += 96) {
      ctx.beginPath()
      ctx.moveTo(-250, y)
      ctx.quadraticCurveTo(0, y + 62, 250, y)
      ctx.stroke()
    }
    ctx.fillStyle = record.colors.accent
    for (const [x, y] of [[-150, -110], [-50, -55], [90, -118], [185, -15], [-133, 65], [14, 101], [130, 143]] as const) {
      ctx.beginPath()
      ctx.ellipse(x, y, 22, 13, -.36, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (record.id === 'water') {
    ctx.fillStyle = record.colors.wash
    ctx.beginPath()
    ctx.arc(0, 0, 208, 0, Math.PI * 2)
    ctx.fill()
    for (const radius of [68, 126, 190]) {
      ctx.strokeStyle = `${record.colors.accent}${radius === 190 ? 'a0' : 'd2'}`
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.ellipse(0, 0, radius, radius * .56, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = record.colors.accent
    ctx.beginPath()
    ctx.arc(0, -92, 19, 0, Math.PI * 2)
    ctx.fill()
  } else {
    rounded(ctx, -214, -214, 428, 428, 12)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = `${record.colors.accent}bb`
    ctx.lineWidth = 5
    for (let i = 1; i < 4; i++) {
      const place = -214 + i * 107
      ctx.beginPath()
      ctx.moveTo(place, -214)
      ctx.lineTo(place, 214)
      ctx.moveTo(-214, place)
      ctx.lineTo(214, place)
      ctx.stroke()
    }
    for (const [x, y, dark] of [[-108, -108, true], [0, -2, false], [108, 105, true], [106, -108, false], [-108, 105, false]] as const) {
      ctx.fillStyle = dark ? record.colors.ink : '#f9f3df'
      ctx.beginPath()
      ctx.arc(x, y, 31, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `${record.colors.accent}99`
      ctx.lineWidth = 4
      ctx.stroke()
    }
  }
  ctx.restore()
}

export async function createConsortShareCard(record: ConsortKeepsake): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const outer = ctx.createLinearGradient(0, 0, W, H)
  outer.addColorStop(0, record.colors.ink)
  outer.addColorStop(.54, record.colors.accent)
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
  ctx.fillStyle = record.colors.accent
  rounded(ctx, 76, 76, 206, 54, 27)
  ctx.fill()
  ctx.fillStyle = '#f2e5c7'
  ctx.font = `800 20px ${SANS}`
  ctx.fillText('CONSORT / 3D', 179, 111)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#778065'
  ctx.font = `600 19px ${SANS}`
  ctx.fillText('刘看山 · 本局随机记录卡', 986, 111)

  ctx.textAlign = 'center'
  ctx.fillStyle = `${record.colors.accent}16`
  ctx.font = `900 178px ${SANS}`
  ctx.fillText('JING HUA', W / 2, 455)
  ctx.fillStyle = `${record.colors.wash}90`
  rounded(ctx, 164, 152, 752, 570, 42)
  ctx.fill()
  drawKeepsakeMotif(ctx, record)
  ctx.fillStyle = record.colors.ink
  ctx.font = `800 18px ${SANS}`
  ctx.fillText(`本局印记 · ${record.marker}`, W / 2, 680)

  ctx.fillStyle = '#283e33'
  ctx.font = `800 34px ${SERIF}`
  ctx.fillText('《端妃黑又壮》开放篇章', W / 2, 793)
  ctx.fillStyle = record.colors.ink
  ctx.font = `800 66px ${SERIF}`
  ctx.fillText(record.name, W / 2, 878)
  ctx.fillStyle = '#778065'
  ctx.font = `500 26px ${SERIF}`
  ctx.fillText(record.line, W / 2, 932)
  ctx.fillStyle = record.colors.accent
  rounded(ctx, 334, 972, 412, 42, 21)
  ctx.fill()
  ctx.fillStyle = '#f2e5c7'
  ctx.font = `800 16px ${SANS}`
  ctx.fillText('随机收藏 · 不表示玩家表现', W / 2, 1000)
  ctx.strokeStyle = `${record.colors.accent}88`
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(162, 1057)
  ctx.lineTo(918, 1057)
  ctx.stroke()
  ctx.fillStyle = '#778065'
  ctx.font = `600 20px ${SANS}`
  ctx.fillText('开放文本止于 L177 · 不补写后续命运', W / 2, 1122)

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

type NavigatorWithShare = {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
}

/**
 * Everything that a save or a native share needs is prepared while the ending
 * sheet is opening. Web Share is activation-gated on mobile, so a click must
 * never wait for QR rendering or canvas encoding before invoking it.
 */
export type PreparedConsortShareCard = Readonly<{
  record: ConsortKeepsake
  canvas: HTMLCanvasElement
  blob: Blob
  file?: File
  shareData: ShareData
}>

function fileName(record: ConsortKeepsake) {
  return `端妃黑又壮-${record.name}-记录卡.png`
}

function shareText(record: ConsortKeepsake) {
  return `我在《端妃黑又壮》的开放篇章里，抽到了「${record.name}」本局记录卡。原文停在 L177 的未完话语。`
}

export async function prepareConsortShareCard(record: ConsortKeepsake): Promise<PreparedConsortShareCard> {
  const canvas = await createConsortShareCard(record)
  const blob = await asBlob(canvas)
  const file = typeof File === 'function'
    ? new File([blob], fileName(record), { type: 'image/png' })
    : undefined
  const shareData: ShareData = {
    title: `我的《端妃黑又壮》${record.name}记录卡`,
    text: shareText(record),
    // The portal route is deliberately the door only. It does not encode the
    // random card, play progress, or any in-game actions.
    url: getConsortPortalUrl(),
  }
  return { record, canvas, blob, file, shareData }
}

/** Save the already-rendered image; this is also the no-Web-Share fallback. */
export function savePreparedConsortShareCard(card: PreparedConsortShareCard) {
  const { blob, record } = card
  const objectUrl = URL.createObjectURL(blob)
  const download = document.createElement('a')
  download.href = objectUrl
  download.download = fileName(record)
  download.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4_000)
}

/**
 * Calls navigator.share immediately with the prepared image. Do not make this
 * async: callers need the browser call itself to happen in the original button
 * click stack. Browsers that cannot share image files download the exact same
 * prepared PNG instead of silently sharing only a text link.
 */
export function sharePreparedConsortShareCard(card: PreparedConsortShareCard): Promise<'shared' | 'saved'> {
  const navigatorWithShare = navigator as NavigatorWithShare
  const file = card.file
  // A browser that exposes text sharing alone must not receive a card as a
  // text-only fallback. If it cannot prove file support, save this PNG.
  let canShareFile = false
  if (file && navigatorWithShare.share && navigatorWithShare.canShare) {
    try {
      canShareFile = navigatorWithShare.canShare({ files: [file] })
    } catch {
      canShareFile = false
    }
  }
  if (!canShareFile || !file || !navigatorWithShare.share) {
    savePreparedConsortShareCard(card)
    return Promise.resolve('saved')
  }

  const data: ShareData = { ...card.shareData, files: [file] }
  try {
    // No await may precede this invocation; it must retain the tap activation.
    const nativeShare = navigatorWithShare.share(data)
    return nativeShare.then(
      () => 'shared' as const,
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        savePreparedConsortShareCard(card)
        return 'saved' as const
      },
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return Promise.reject(error)
    savePreparedConsortShareCard(card)
    return Promise.resolve('saved')
  }
}
