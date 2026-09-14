import QRCode from 'qrcode'

export type MyopiaEnding = {
  id: string
  title: string
  subtitle: string
  tone: 'good' | 'bad' | 'secret'
}

const W = 1080
const H = 1440
const CANONICAL_PORTAL_URL = 'https://kanshan.makebook.hk2048.online/'
export const MYOPIA_EXPERIENCE_ID = 'myopia-3d'
const SERIF = '"Songti SC","Noto Serif SC",serif'
const SANS = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'

type Theme = { outerA: string; outerB: string; paper: string; ink: string; muted: string; accent: string; accent2: string; record: string; line: string; motif: 'focus' | 'door' | 'pulse' | 'void' }

const themes: Record<string, Theme> = {
  chapterProtect: { outerA: '#582732', outerB: '#d77678', paper: '#ffe9e2', ink: '#4a202b', muted: '#9c5c68', accent: '#dd5d72', accent2: '#ffc36f', record: '向她走去', line: '看清以前，我先向她走近。', motif: 'door' },
  chapterCalm: { outerA: '#173b55', outerB: '#4f9ab1', paper: '#e6f7fb', ink: '#17384f', muted: '#548095', accent: '#2099b5', accent2: '#f3df72', record: '先让她停下', line: '我先让声音停在能被听见的地方。', motif: 'pulse' },
  chapterDistance: { outerA: '#33294e', outerB: '#936b9f', paper: '#f2eaff', ink: '#3a2857', muted: '#79668d', accent: '#8359cb', accent2: '#d8b6ff', record: '留出距离', line: '我给恐惧留出距离，也没让它替我说话。', motif: 'focus' },
  dead: { outerA: '#250b12', outerB: '#8b1a2c', paper: '#ffe7e4', ink: '#481018', muted: '#8b4b52', accent: '#b51f38', accent2: '#f7b2a5', record: '视野被黑暗吞没', line: '我看得太久，视野先被黑暗吞没。', motif: 'void' },
}

const themeFor = (ending: MyopiaEnding) => themes[ending.id] || themes.chapterDistance
const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }
const rgba = (hex: string, alpha: number) => { const value = Number.parseInt(hex.slice(1), 16); return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})` }

/**
 * A 3D page may run either below the portal (`/myopia-3d/`) or standalone
 * during authoring. Shared links must always return to a portal door, never
 * expose a save/ending state; the standalone case intentionally uses the
 * canonical deployed portal rather than its local game-only root.
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
  rounded(ctx, 240, 148, 600, 530, 42); ctx.clip()
  ctx.translate(540, 413)
  ctx.strokeStyle = rgba(theme.accent2, 0.3); ctx.fillStyle = rgba(theme.accent2, 0.17); ctx.lineWidth = 5
  if (theme.motif === 'door') {
    ctx.strokeRect(-170, -240, 340, 480); ctx.strokeRect(-120, -190, 240, 380)
    ctx.beginPath(); ctx.arc(96, 0, 14, 0, Math.PI * 2); ctx.fill()
  } else if (theme.motif === 'pulse') {
    for (let i = -3; i <= 3; i += 1) { ctx.beginPath(); ctx.arc(0, i * 40, 240, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke() }
  } else if (theme.motif === 'void') {
    for (let r = 80; r < 440; r += 70) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke() }
  } else {
    for (let r = 110; r < 430; r += 70) { ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.52, Math.PI / 5, 0, Math.PI * 2); ctx.stroke() }
  }
  ctx.restore()
}

export async function createMyopiaShareCard(ending: MyopiaEnding, portalUrl = buildMyopiaPortalUrl()): Promise<HTMLCanvasElement> {
  const theme = themeFor(ending)
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const gradient = ctx.createLinearGradient(0, 0, W, H)
  gradient.addColorStop(0, theme.outerA); gradient.addColorStop(1, theme.outerB)
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = theme.ink; rounded(ctx, 34, 34, 1012, 1372, 42); ctx.fill()
  ctx.fillStyle = theme.paper; rounded(ctx, 56, 56, 968, 1328, 28); ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = theme.accent; rounded(ctx, 76, 76, 184, 54, 27); ctx.fill()
  ctx.fillStyle = theme.paper; ctx.font = `800 20px ${SANS}`; ctx.fillText('MYOPIA / 3D', 168, 111)
  ctx.textAlign = 'right'; ctx.fillStyle = theme.muted; ctx.font = `600 19px ${SANS}`; ctx.fillText('首章记录 · KANSHAN DOOR', 986, 111)
  ctx.textAlign = 'center'; ctx.fillStyle = rgba(theme.accent, 0.13); ctx.font = `900 185px ${SANS}`; ctx.fillText('FOCUS', 540, 455)
  ctx.fillStyle = rgba(theme.accent2, 0.15); rounded(ctx, 240, 148, 600, 530, 42); ctx.fill(); ctx.strokeStyle = rgba(theme.accent, 0.7); ctx.lineWidth = 4; ctx.stroke()
  drawMotif(ctx, theme)
  ctx.fillStyle = theme.ink; ctx.font = `700 18px ${SANS}`; ctx.fillText('一米之外，皆是雾', 540, 444)
  ctx.font = `800 70px ${SERIF}`; ctx.fillText('视 野 记 录', 540, 528)
  ctx.fillStyle = theme.muted; ctx.font = `500 25px ${SERIF}`; ctx.fillText('看清需要代价，选择留下痕迹。', 540, 582)
  ctx.font = `700 17px ${SANS}`; ctx.fillText('正在穿越', 540, 720)
  ctx.fillStyle = theme.ink; ctx.font = `800 50px ${SERIF}`; ctx.fillText('《近视眼勇闯恐怖游戏》', 540, 790)
  ctx.fillStyle = theme.accent; rounded(ctx, 348, 826, 384, 38, 19); ctx.fill()
  ctx.fillStyle = theme.paper; ctx.font = `800 16px ${SANS}`; ctx.fillText('第一章记录 · 你的站位', 540, 852)
  ctx.fillStyle = theme.ink; ctx.font = `800 ${theme.record.length > 7 ? 54 : 70}px ${SERIF}`; ctx.fillText(theme.record, 540, 942)
  ctx.strokeStyle = rgba(theme.accent, 0.46); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(162, 978); ctx.lineTo(918, 978); ctx.stroke()
  ctx.font = `700 37px ${SERIF}`; ctx.fillText(theme.line, 540, 1040)
  ctx.fillStyle = theme.muted; ctx.font = `600 20px ${SANS}`; ctx.fillText('PS1 沉浸体验 · 开放首章', 540, 1152)
  ctx.fillStyle = theme.ink; rounded(ctx, 76, 1192, 928, 168, 22); ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent2; ctx.font = `700 27px ${SERIF}`; ctx.fillText('扫二维码，进入盐选宇宙', 116, 1250)
  ctx.fillStyle = rgba(theme.paper, 0.78); ctx.font = `19px ${SANS}`; ctx.fillText('看山任意门 · 每次打开，都是另一段故事', 116, 1295)
  ctx.fillStyle = rgba(theme.paper, 0.52); ctx.font = `16px ${SANS}`; ctx.fillText('固定入口 · 不带走你的存档', 116, 1333)
  ctx.textAlign = 'center'
  try {
    const code = await loadImage(await QRCode.toDataURL(portalUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: '#10291f', light: '#fffdf7' } }))
    ctx.fillStyle = '#fffdf7'; rounded(ctx, 844, 1208, 142, 142, 16); ctx.fill()
    ctx.drawImage(code, 858, 1222, 114, 114)
  } catch {
    // The saved card remains useful even if a restrictive browser blocks a Canvas data URL.
  }
  return canvas
}

function asBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成记录卡失败')), 'image/png'))
}

export async function saveMyopiaShareCard(ending: MyopiaEnding) {
  const blob = await asBlob(await createMyopiaShareCard(ending))
  const url = URL.createObjectURL(blob)
  const download = document.createElement('a')
  download.href = url; download.download = `近视眼勇闯恐怖游戏-${ending.id}.png`; download.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000)
}

export async function shareMyopiaShareCard(ending: MyopiaEnding) {
  const theme = themeFor(ending)
  const portalUrl = buildMyopiaPortalUrl()
  const navigatorWithShare = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean }
  if (!navigatorWithShare.share) { await saveMyopiaShareCard(ending); return 'saved' }
  const blob = await asBlob(await createMyopiaShareCard(ending, portalUrl))
  const file = new File([blob], `近视眼勇闯恐怖游戏-${ending.id}.png`, { type: 'image/png' })
  const data: ShareData = { title: `我的近视眼首章记录：${theme.record}`, text: `我在《近视眼勇闯恐怖游戏》留下了「${theme.record}」的第一章记录。你会怎么选？`, url: portalUrl }
  if (navigatorWithShare.canShare?.({ files: [file] })) data.files = [file]
  await navigatorWithShare.share(data)
  return 'shared'
}

export async function copyMyopiaShareLink(): Promise<void> {
  await copyText(buildMyopiaPortalUrl())
}

export function returnToMyopiaPortal(): void {
  window.location.assign(buildMyopiaPortalUrl())
}
