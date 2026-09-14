import QRCode from 'qrcode'

export type MyopiaEnding = {
  id: string
  title: string
  subtitle: string
  tone: 'good' | 'bad' | 'secret'
}

export type MyopiaJourneyImprint = {
  id: 'mist-lamp' | 'focus-mark' | 'night-window' | 'doorway-echo' | 'blur-record'
  title: string
  line: string
  kind: 'keepsake' | 'failure-record'
  theme: Theme
}

/**
 * The finished artifact for one ending sheet. Keeping the Canvas, PNG Blob,
 * File, and share metadata together guarantees that preview, save, and native
 * share all use exactly the same randomly selected card.
 */
export type PreparedMyopiaShareCard = {
  canvas: HTMLCanvasElement
  blob: Blob
  file: File
  shareData: ShareData
}

const W = 1080
const H = 1440
const CANONICAL_PORTAL_URL = 'https://kanshan.makebook.hk2048.online/'
export const MYOPIA_EXPERIENCE_ID = 'myopia-3d'
const SERIF = '"Songti SC","Noto Serif SC",serif'
const SANS = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'

type Theme = {
  outerA: string
  outerB: string
  paper: string
  ink: string
  muted: string
  accent: string
  accent2: string
  motif: 'focus' | 'door' | 'pulse' | 'window'
}

type ChapterRecord = { title: string; line: string }

/**
 * These are collectible visual treatments, deliberately separate from the
 * player's stance. A draw is made by HUD exactly once at chapter close and is
 * then passed to preview/save/share; it is never included in a URL.
 */
const JOURNEY_IMPRINTS: readonly MyopiaJourneyImprint[] = [
  {
    id: 'mist-lamp',
    kind: 'keepsake',
    title: '雾中引路牌',
    line: '看不清时，先把脚下的路照亮。',
    theme: { outerA: '#1b3040', outerB: '#6c96a6', paper: '#eef8f4', ink: '#17323a', muted: '#5c7d82', accent: '#367f85', accent2: '#e9d383', motif: 'focus' },
  },
  {
    id: 'focus-mark',
    kind: 'keepsake',
    title: '一米以内',
    line: '靠近一点，模糊的边缘终于有了形状。',
    theme: { outerA: '#463152', outerB: '#9d6e91', paper: '#fbf0f7', ink: '#45273f', muted: '#846175', accent: '#a24d7d', accent2: '#ebc0d9', motif: 'pulse' },
  },
  {
    id: 'night-window',
    kind: 'keepsake',
    title: '夜灯未熄',
    line: '屋里再暗，手边的一点光还在。',
    theme: { outerA: '#15243b', outerB: '#4977a2', paper: '#eaf2ff', ink: '#173150', muted: '#59728e', accent: '#3068a6', accent2: '#f5dc8a', motif: 'window' },
  },
  {
    id: 'doorway-echo',
    kind: 'keepsake',
    title: '门缝里的光',
    line: '在门还没完全打开前，你已经留下了声音。',
    theme: { outerA: '#4d252d', outerB: '#c36f66', paper: '#fff0e8', ink: '#54262d', muted: '#96636a', accent: '#b9505d', accent2: '#f4c477', motif: 'door' },
  },
]

const FAILURE_IMPRINT: MyopiaJourneyImprint = {
  id: 'blur-record',
  kind: 'failure-record',
  title: '失焦记录',
  line: '惊悚值到达阈值，本局在这里停下。',
  theme: { outerA: '#280d16', outerB: '#7e2639', paper: '#fff0ed', ink: '#4c1824', muted: '#8e5961', accent: '#b43750', accent2: '#f2b5a5', motif: 'pulse' },
}

const chapterRecords: Record<string, ChapterRecord> = {
  chapterProtect: { title: '向她走去', line: '看清以前，我先向她走近。' },
  chapterCalm: { title: '先让她停下', line: '我先让声音停在能被听见的地方。' },
  chapterDistance: { title: '留出距离', line: '我给恐惧留出距离，也没让它替我说话。' },
  dead: { title: '惊悚值到达阈值', line: '互动玩法在惊悚值达到 100 时停止本局。' },
}

function chapterRecordFor(ending: MyopiaEnding): ChapterRecord {
  return chapterRecords[ending.id] || chapterRecords.chapterDistance
}

/**
 * Pick a visual keepsake once for a completed open chapter. A fear-threshold
 * failure stays factual: it receives a fixed loss record rather than a random reward.
 */
export function drawMyopiaJourneyImprint(ending: MyopiaEnding): MyopiaJourneyImprint {
  if (ending.id === 'dead') return FAILURE_IMPRINT
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return JOURNEY_IMPRINTS[value[0] % JOURNEY_IMPRINTS.length]
  }
  return JOURNEY_IMPRINTS[Math.floor(Math.random() * JOURNEY_IMPRINTS.length)]
}

const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

const rgba = (hex: string, alpha: number) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/**
 * A 3D page may run either below the portal (`/myopia-3d/`) or standalone
 * during authoring. Shared links always return to a portal door, never expose
 * a save, ending, fear, or random-card state.
 */
export function buildMyopiaPortalUrl(): string {
  const fallback = new URL(CANONICAL_PORTAL_URL)
  if (typeof window === 'undefined') {
    fallback.searchParams.set('story', MYOPIA_EXPERIENCE_ID)
    return fallback.toString()
  }
  try {
    const current = new URL(window.location.href)
    const mounted = current.pathname.match(/^(.*)\/myopia-3d(?:\/|$)/)
    if (!mounted) throw new Error('standalone experience')
    current.pathname = `${mounted[1] || ''}/`
    current.search = ''
    current.hash = ''
    current.searchParams.set('story', MYOPIA_EXPERIENCE_ID)
    return current.toString()
  } catch {
    fallback.searchParams.set('story', MYOPIA_EXPERIENCE_ID)
    return fallback.toString()
  }
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const area = document.createElement('textarea')
  area.value = value
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('复制入口失败')
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('二维码生成失败'))
    image.src = src
  })
}

function drawMotif(ctx: CanvasRenderingContext2D, theme: Theme) {
  ctx.save()
  rounded(ctx, 240, 158, 600, 508, 42)
  ctx.clip()
  ctx.translate(540, 412)
  ctx.strokeStyle = rgba(theme.accent2, 0.34)
  ctx.fillStyle = rgba(theme.accent2, 0.16)
  ctx.lineWidth = 5
  if (theme.motif === 'door') {
    ctx.strokeRect(-170, -230, 340, 460)
    ctx.strokeRect(-120, -180, 240, 360)
    ctx.beginPath(); ctx.arc(96, 0, 14, 0, Math.PI * 2); ctx.fill()
  } else if (theme.motif === 'pulse') {
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath(); ctx.arc(0, i * 40, 240, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke()
    }
  } else if (theme.motif === 'window') {
    ctx.strokeRect(-210, -210, 420, 420)
    ctx.beginPath(); ctx.moveTo(0, -210); ctx.lineTo(0, 210); ctx.moveTo(-210, 0); ctx.lineTo(210, 0); ctx.stroke()
    ctx.fillStyle = rgba(theme.accent2, 0.22)
    rounded(ctx, 20, -170, 130, 130, 12); ctx.fill()
  } else {
    for (let r = 110; r < 430; r += 70) {
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.52, Math.PI / 5, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.restore()
}

function drawCenteredLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const lines: string[] = []
  let current = ''
  for (const char of text) {
    const candidate = current + char
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = char
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  const start = y - ((lines.length - 1) * lineHeight) / 2
  lines.forEach((line, index) => ctx.fillText(line, x, start + index * lineHeight))
}

/** Draw the card selected at the end of this particular run. */
export async function createMyopiaShareCard(
  ending: MyopiaEnding,
  imprint: MyopiaJourneyImprint,
  portalUrl = buildMyopiaPortalUrl(),
): Promise<HTMLCanvasElement> {
  const theme = imprint.theme
  const record = chapterRecordFor(ending)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const gradient = ctx.createLinearGradient(0, 0, W, H)
  gradient.addColorStop(0, theme.outerA)
  gradient.addColorStop(1, theme.outerB)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = theme.ink
  rounded(ctx, 34, 34, 1012, 1372, 42)
  ctx.fill()
  ctx.fillStyle = theme.paper
  rounded(ctx, 56, 56, 968, 1328, 28)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = theme.accent
  rounded(ctx, 76, 76, 184, 54, 27)
  ctx.fill()
  ctx.fillStyle = theme.paper
  ctx.font = `800 20px ${SANS}`
  ctx.fillText('MYOPIA / 3D', 168, 111)
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.muted
  ctx.font = `600 19px ${SANS}`
  ctx.fillText('本局记录卡 · KANSHAN DOOR', 986, 111)

  ctx.textAlign = 'center'
  ctx.fillStyle = rgba(theme.accent, 0.13)
  ctx.font = `900 172px ${SANS}`
  ctx.fillText('FOCUS', 540, 455)
  ctx.fillStyle = rgba(theme.accent2, 0.15)
  rounded(ctx, 240, 158, 600, 508, 42)
  ctx.fill()
  ctx.strokeStyle = rgba(theme.accent, 0.7)
  ctx.lineWidth = 4
  ctx.stroke()
  drawMotif(ctx, theme)

  ctx.fillStyle = theme.ink
  ctx.font = `700 18px ${SANS}`
  ctx.fillText(imprint.kind === 'keepsake' ? '刘看山递来的本局记录卡' : '本局失焦记录', 540, 438)
  ctx.font = `800 ${imprint.title.length > 6 ? 62 : 72}px ${SERIF}`
  ctx.fillText(imprint.title, 540, 522)
  ctx.fillStyle = theme.muted
  ctx.font = `500 27px ${SERIF}`
  drawCenteredLines(ctx, imprint.line, 540, 586, 620, 38)

  ctx.fillStyle = theme.accent
  rounded(ctx, 340, 710, 400, 38, 19)
  ctx.fill()
  ctx.fillStyle = theme.paper
  ctx.font = `800 16px ${SANS}`
  ctx.fillText('第一章记录 · 你的站位', 540, 736)
  ctx.fillStyle = theme.ink
  ctx.font = `800 ${record.title.length > 7 ? 52 : 66}px ${SERIF}`
  ctx.fillText(record.title, 540, 838)
  ctx.strokeStyle = rgba(theme.accent, 0.46)
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(162, 874); ctx.lineTo(918, 874); ctx.stroke()
  ctx.font = `700 35px ${SERIF}`
  drawCenteredLines(ctx, record.line, 540, 942, 740, 48)

  ctx.fillStyle = theme.muted
  ctx.font = `600 19px ${SANS}`
  ctx.fillText(imprint.kind === 'keepsake' ? '随机旅途收藏 · 不是人格判定' : '互动玩法失败记录 · 非原文续写', 540, 1060)
  ctx.font = `500 17px ${SANS}`
  ctx.fillText('开放首章，记录止于原文截断处。', 540, 1094)

  ctx.fillStyle = theme.ink
  rounded(ctx, 76, 1160, 928, 200, 22)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent2
  ctx.font = `700 27px ${SERIF}`
  ctx.fillText('扫二维码，进入盐选宇宙', 116, 1222)
  ctx.fillStyle = rgba(theme.paper, 0.78)
  ctx.font = `19px ${SANS}`
  ctx.fillText('看山任意门 · 每次打开，都是另一段故事', 116, 1270)
  ctx.fillStyle = rgba(theme.paper, 0.52)
  ctx.font = `16px ${SANS}`
  ctx.fillText('固定入口 · 不带走你的存档或本局记录', 116, 1314)
  ctx.textAlign = 'center'
  try {
    const code = await loadImage(await QRCode.toDataURL(portalUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#10291f', light: '#fffdf7' },
    }))
    ctx.fillStyle = '#fffdf7'
    rounded(ctx, 834, 1188, 150, 150, 16)
    ctx.fill()
    ctx.drawImage(code, 850, 1204, 118, 118)
  } catch {
    // The saved card remains useful even if a restrictive browser blocks a Canvas data URL.
  }
  return canvas
}

function asBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('生成记录卡失败')),
    'image/png',
  ))
}

const CARD_FILENAME = '近视眼勇闯恐怖游戏-本局记录卡.png'

/**
 * Finish the expensive work before the player taps Share. In particular,
 * Canvas-to-PNG and QR rendering must not sit in front of navigator.share(),
 * because mobile browsers can drop the transient user activation after an
 * awaited task.
 */
export async function prepareMyopiaShareCard(
  ending: MyopiaEnding,
  imprint: MyopiaJourneyImprint,
): Promise<PreparedMyopiaShareCard> {
  const portalUrl = buildMyopiaPortalUrl()
  const canvas = await createMyopiaShareCard(ending, imprint, portalUrl)
  const blob = await asBlob(canvas)
  const file = new File([blob], CARD_FILENAME, { type: 'image/png' })
  const record = chapterRecordFor(ending)
  const shareData: ShareData = {
    title: imprint.kind === 'keepsake' ? `我的近视眼本局记录卡：${imprint.title}` : '我的近视眼互动失焦记录',
    text: imprint.kind === 'keepsake'
      ? `我在《近视眼勇闯恐怖游戏》收到「${imprint.title}」，第一章记下的是「${record.title}」。你会怎么选？`
      : '我在《近视眼勇闯恐怖游戏》的惊悚值到达阈值，本局在这里停下。你会怎么选？',
    // This is always the fixed portal door. It carries no ending, fear, card,
    // or progress state.
    url: portalUrl,
  }
  return { canvas, blob, file, shareData }
}

/** Trigger a download from a prepared PNG, without rendering a second card. */
export function savePreparedMyopiaShareCard(prepared: PreparedMyopiaShareCard): void {
  const url = URL.createObjectURL(prepared.blob)
  const download = document.createElement('a')
  download.href = url
  download.download = CARD_FILENAME
  download.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000)
}

type NavigatorWithShare = {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
}

/**
 * Open the native sheet immediately while the click is still user-activated.
 * Unsupported file sharing falls back to downloading the same prepared PNG;
 * it never redraws or changes the selected card.
 */
export function sharePreparedMyopiaShareCard(
  prepared: PreparedMyopiaShareCard,
): Promise<'shared' | 'saved'> {
  const navigatorWithShare = navigator as NavigatorWithShare
  // A plain navigator.share is not evidence that this browser will share a
  // file. Fail closed to this same PNG rather than quietly sending text only.
  let canShareFile = false
  if (navigatorWithShare.share && navigatorWithShare.canShare) {
    try {
      canShareFile = navigatorWithShare.canShare({ files: [prepared.file] })
    } catch {
      canShareFile = false
    }
  }
  if (!canShareFile || !navigatorWithShare.share) {
    savePreparedMyopiaShareCard(prepared)
    return Promise.resolve('saved')
  }

  const data: ShareData = { ...prepared.shareData, files: [prepared.file] }
  try {
    // Do not put an await before this call. See prepareMyopiaShareCard above.
    const nativeShare = navigatorWithShare.share(data)
    return nativeShare.then(
      () => 'shared' as const,
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        // A few browsers expose share() but reject a file despite canShare().
        // The player still receives this exact image rather than a regenerated one.
        savePreparedMyopiaShareCard(prepared)
        return 'saved' as const
      },
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return Promise.reject(error)
    savePreparedMyopiaShareCard(prepared)
    return Promise.resolve('saved')
  }
}

export async function saveMyopiaShareCard(
  ending: MyopiaEnding,
  imprint: MyopiaJourneyImprint,
  card?: HTMLCanvasElement,
) {
  if (!card) {
    savePreparedMyopiaShareCard(await prepareMyopiaShareCard(ending, imprint))
    return
  }
  const blob = await asBlob(card)
  savePreparedMyopiaShareCard({
    canvas: card,
    blob,
    file: new File([blob], CARD_FILENAME, { type: 'image/png' }),
    shareData: { url: buildMyopiaPortalUrl() },
  })
}

export async function shareMyopiaShareCard(
  ending: MyopiaEnding,
  imprint: MyopiaJourneyImprint,
  card?: HTMLCanvasElement,
) {
  if (!card) return sharePreparedMyopiaShareCard(await prepareMyopiaShareCard(ending, imprint))
  const blob = await asBlob(card)
  const record = chapterRecordFor(ending)
  const prepared: PreparedMyopiaShareCard = {
    canvas: card,
    blob,
    file: new File([blob], CARD_FILENAME, { type: 'image/png' }),
    shareData: {
      title: imprint.kind === 'keepsake' ? `我的近视眼本局记录卡：${imprint.title}` : '我的近视眼互动失焦记录',
      text: imprint.kind === 'keepsake'
        ? `我在《近视眼勇闯恐怖游戏》收到「${imprint.title}」，第一章记下的是「${record.title}」。你会怎么选？`
        : '我在《近视眼勇闯恐怖游戏》的惊悚值到达阈值，本局在这里停下。你会怎么选？',
      url: buildMyopiaPortalUrl(),
    },
  }
  return sharePreparedMyopiaShareCard(prepared)
}

export async function copyMyopiaShareLink(): Promise<void> {
  await copyText(buildMyopiaPortalUrl())
}

export function returnToMyopiaPortal(): void {
  window.location.assign(buildMyopiaPortalUrl())
}
