// 1080 × 1440 share card. Dynamic copy stays in Canvas/DOM so image models
// never need to render Chinese text, and the card still works without an LLM.
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { EndingMeta } from '../types';
import type { PersonaResult } from '../lib/persona.mjs';
import { buildPersonaShareUrl } from '../lib/persona.mjs';

const W = 1080;
const H = 1440;
const CANONICAL_PORTAL_URL = 'https://kanshan.makebook.hk2048.online/';
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';
const SANS = 'system-ui,-apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

/** 结局评级展示文案（结局页徽章与海报共用） */
export const ENDING_RATING_LABEL: Record<NonNullable<EndingMeta['rating']>, string> = {
  normal: 'NORMAL END · 留存路线',
  rare: 'OPEN END · 继续追查',
  legend: 'GOOD END · 公开留证',
  egg: 'HIDDEN END · 地理偏移',
  bad: 'BAD END · 论证失焦',
};

interface PosterProps {
  storyId: string;
  storyTitle: string;
  persona: PersonaResult;
}

type ShareNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

interface CardTheme {
  outerA: string;
  outerB: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  pattern: 'burst' | 'orbit' | 'grid' | 'vault' | 'waves' | 'signals' | 'stamp' | 'halo';
}

const themeByPersona: Record<PersonaResult['code'], CardTheme> = {
  FIRE: { outerA: '#ff5124', outerB: '#7d1309', paper: '#fff0d8', ink: '#351008', muted: '#93513d', accent: '#ff3917', accent2: '#ffd33d', pattern: 'burst' },
  ANON: { outerA: '#0b1f47', outerB: '#1f5488', paper: '#dff5ff', ink: '#081d42', muted: '#39657d', accent: '#0faec4', accent2: '#bdf6ff', pattern: 'orbit' },
  CLEAN: { outerA: '#005341', outerB: '#08a477', paper: '#e4fff4', ink: '#003d33', muted: '#297665', accent: '#00aa78', accent2: '#c8ff5c', pattern: 'grid' },
  CTRL: { outerA: '#2d174c', outerB: '#7952c4', paper: '#f4eaff', ink: '#311a55', muted: '#765a91', accent: '#7f48ff', accent2: '#f0b7ff', pattern: 'vault' },
  ECHO: { outerA: '#5c1740', outerB: '#d64774', paper: '#ffe8f0', ink: '#57132f', muted: '#9f516c', accent: '#ff477e', accent2: '#ffd04b', pattern: 'waves' },
  ASKR: { outerA: '#063260', outerB: '#0086a6', paper: '#e2f8ff', ink: '#083755', muted: '#2f7086', accent: '#00abc9', accent2: '#f8e65b', pattern: 'signals' },
  FAIR: { outerA: '#463307', outerB: '#c68b0f', paper: '#fff5cd', ink: '#422f00', muted: '#806a32', accent: '#eca800', accent2: '#ffdc4d', pattern: 'stamp' },
  FEEL: { outerA: '#5e2938', outerB: '#e97880', paper: '#ffe9e5', ink: '#562433', muted: '#9d6170', accent: '#e55f7a', accent2: '#ffca7b', pattern: 'halo' },
};

function rgba(hex: string, opacity: number) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((char) => `${char}${char}`).join('') : value;
  const parsed = Number.parseInt(full, 16);
  return `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${opacity})`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('刘看山素材加载失败'));
    image.src = src;
  });
}

function createPortalCode() {
  return QRCode.toDataURL(CANONICAL_PORTAL_URL, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: '#10291f', light: '#fffdf7' },
  });
}

function roundedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function splitLines(c: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (c.measureText(`${line}${char}`).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines - 1) break;
    } else line += char;
  }
  const used = lines.join('').length;
  const remainder = text.slice(used);
  if (remainder) {
    let finalLine = remainder;
    while (c.measureText(finalLine).width > maxWidth && finalLine.length > 1) finalLine = finalLine.slice(0, -1);
    if (finalLine.length < remainder.length) finalLine = `${finalLine.slice(0, -1)}…`;
    lines.push(finalLine);
  }
  return lines.slice(0, maxLines);
}

function drawLines(c: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number) {
  lines.forEach((line, index) => c.fillText(line, x, y + index * lineHeight));
}

function seededTexture(c: CanvasRenderingContext2D, seedText: string, color: string) {
  let seed = [...seedText].reduce((sum, char) => (sum * 31 + (char.codePointAt(0) || 0)) >>> 0, 2166136261);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  c.fillStyle = rgba(color, 0.055);
  for (let index = 0; index < 920; index += 1) c.fillRect(random() * W, random() * H, 1.5, 1.5);
}

function drawPattern(c: CanvasRenderingContext2D, theme: CardTheme, code: PersonaResult['code']) {
  c.save();
  c.translate(540, 410);
  c.strokeStyle = rgba(theme.accent2, 0.28);
  c.fillStyle = rgba(theme.accent2, 0.16);
  c.lineWidth = 4;
  if (theme.pattern === 'burst') {
    for (let index = 0; index < 14; index += 1) {
      const angle = (Math.PI * 2 * index) / 14;
      c.beginPath(); c.moveTo(Math.cos(angle) * 160, Math.sin(angle) * 160); c.lineTo(Math.cos(angle) * 420, Math.sin(angle) * 420); c.stroke();
    }
  } else if (theme.pattern === 'orbit') {
    for (const radius of [210, 310, 410]) { c.beginPath(); c.ellipse(0, 0, radius, radius * .46, Math.PI / 6, 0, Math.PI * 2); c.stroke(); }
  } else if (theme.pattern === 'grid') {
    for (let index = -440; index <= 440; index += 80) { c.beginPath(); c.moveTo(index, -280); c.lineTo(index, 280); c.stroke(); c.beginPath(); c.moveTo(-440, index * .58); c.lineTo(440, index * .58); c.stroke(); }
  } else if (theme.pattern === 'vault') {
    for (let index = 0; index < 8; index += 1) { c.save(); c.rotate(index * Math.PI / 4); c.fillRect(210, -18, 210, 36); c.restore(); }
    c.beginPath(); c.arc(0, 0, 132, 0, Math.PI * 2); c.stroke();
  } else if (theme.pattern === 'waves') {
    for (let index = -2; index <= 2; index += 1) { c.beginPath(); c.arc(0, index * 54, 250, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
  } else if (theme.pattern === 'signals') {
    for (let index = 0; index < 9; index += 1) { c.beginPath(); c.arc(-320 + index * 80, 130 - (index % 3) * 72, 13, 0, Math.PI * 2); c.fill(); }
    for (let index = 0; index < 4; index += 1) { c.beginPath(); c.arc(0, 0, 150 + index * 70, -Math.PI * .74, -Math.PI * .26); c.stroke(); }
  } else if (theme.pattern === 'stamp') {
    for (let index = 0; index < 3; index += 1) { c.save(); c.rotate((index - 1) * .22); c.strokeRect(-250 + index * 150, -210 + index * 50, 260, 260); c.restore(); }
  } else {
    for (const radius of [140, 230, 320, 410]) { c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.stroke(); }
  }
  c.restore();
  void code;
}

function drawCard(
  c: CanvasRenderingContext2D,
  character: HTMLImageElement | null,
  portalCode: HTMLImageElement | null,
  storyTitle: string,
  persona: PersonaResult,
) {
  c.clearRect(0, 0, W, H);
  const theme = themeByPersona[persona.code];
  const background = c.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, theme.outerA);
  background.addColorStop(1, theme.outerB);
  c.fillStyle = background;
  c.fillRect(0, 0, W, H);
  seededTexture(c, `${storyTitle}|${persona.code}`, theme.ink);
  drawPattern(c, theme, persona.code);

  c.fillStyle = theme.ink;
  roundedRect(c, 34, 34, 1012, 1372, 42);
  c.fill();
  c.fillStyle = theme.paper;
  roundedRect(c, 56, 56, 968, 1328, 28);
  c.fill();
  c.fillStyle = theme.accent;
  roundedRect(c, 76, 76, 150, 54, 27);
  c.fill();
  c.fillStyle = theme.paper;
  c.font = `800 23px ${SANS}`;
  c.textAlign = 'center';
  c.fillText(persona.code, 151, 111);

  c.textAlign = 'right';
  c.fillStyle = theme.muted;
  c.font = `600 19px ${SANS}`;
  c.letterSpacing = '3px';
  c.fillText('本局获得 · KANSHAN TYPE', 986, 111);
  c.letterSpacing = '0px';

  c.textAlign = 'center';
  c.fillStyle = rgba(theme.accent, .13);
  c.font = `900 230px ${SANS}`;
  c.fillText(persona.code, 540, 438);

  c.save();
  c.translate(540, 148);
  c.fillStyle = rgba(theme.accent2, .16);
  roundedRect(c, -300, 0, 600, 530, 42);
  c.fill();
  c.strokeStyle = rgba(theme.accent, .64);
  c.lineWidth = 4;
  c.stroke();
  c.restore();

  // Each investigation type gets a distinct art motif inside the portrait
  // window, so the card is still recognizable when it is small in a feed.
  c.save();
  roundedRect(c, 240, 148, 600, 530, 42);
  c.clip();
  drawPattern(c, theme, persona.code);
  c.restore();

  c.save();
  c.translate(540, 148);
  if (character) {
    const ratio = Math.min(540 / character.naturalWidth, 490 / character.naturalHeight);
    const width = character.naturalWidth * ratio;
    const height = character.naturalHeight * ratio;
    c.drawImage(character, -width / 2, 24 + (490 - height) / 2, width, height);
  } else {
    c.fillStyle = theme.ink;
    c.font = `700 44px ${SERIF}`;
    c.fillText('刘看山正在赶来', 0, 275);
  }
  c.restore();

  c.fillStyle = theme.muted;
  c.font = `700 17px ${SANS}`;
  c.letterSpacing = '6px';
  c.fillText('正在穿越', 540, 718);
  c.letterSpacing = '0px';
  c.fillStyle = theme.ink;
  const storyFont = storyTitle.length > 9 ? 48 : storyTitle.length > 6 ? 56 : 66;
  c.font = `800 ${storyFont}px ${SERIF}`;
  c.fillText(`《${storyTitle}》`, 540, 796);

  c.fillStyle = theme.accent;
  roundedRect(c, 348, 826, 384, 38, 19);
  c.fill();
  c.fillStyle = theme.paper;
  c.font = `800 16px ${SANS}`;
  c.letterSpacing = '2px';
  c.fillText(`看山调查人格 · ${persona.code}`, 540, 852);
  c.letterSpacing = '0px';

  c.fillStyle = theme.ink;
  c.font = `800 70px ${SERIF}`;
  c.fillText(persona.name, 540, 942);

  c.strokeStyle = rgba(theme.accent, .46);
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(162, 978);
  c.lineTo(918, 978);
  c.stroke();

  c.fillStyle = theme.ink;
  c.font = `700 38px ${SERIF}`;
  drawLines(c, splitLines(c, persona.shareLine, 760, 2), 540, 1040, 56);

  c.fillStyle = theme.muted;
  c.font = `600 20px ${SANS}`;
  c.fillText(persona.route.replaceAll(' · ', '  /  '), 540, 1152);

  c.fillStyle = theme.ink;
  roundedRect(c, 76, 1192, 928, 168, 22);
  c.fill();
  c.fillStyle = theme.accent2;
  c.font = `700 27px ${SERIF}`;
  c.textAlign = 'left';
  c.fillText('扫二维码，进入盐选宇宙', 116, 1250);
  c.fillStyle = rgba(theme.paper, .78);
  c.font = `19px ${SANS}`;
  c.fillText('看山任意门 · 每次打开，都是另一段故事', 116, 1295);
  c.fillStyle = rgba(theme.paper, .52);
  c.font = `16px ${SANS}`;
  c.fillText('固定入口 · 不带走你的存档', 116, 1333);
  c.textAlign = 'center';
  if (portalCode) {
    c.fillStyle = '#fffdf7';
    roundedRect(c, 844, 1208, 142, 142, 16);
    c.fill();
    c.drawImage(portalCode, 858, 1222, 114, 114);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器没有生成图片')), 'image/png');
  });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('复制失败');
}

export function Poster({ storyId, storyTitle, persona }: PosterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'save' | 'share' | 'copy' | null>(null);
  const [feedback, setFeedback] = useState('');
  const shareUrl = useMemo(() => buildPersonaShareUrl(storyId, persona.code), [storyId, persona.code]);
  const signature = `${storyTitle}|${persona.code}|${persona.shareLine}|${shareUrl}`;

  useEffect(() => {
    let active = true;
    setReady(false);
    setFeedback('正在排版本局分享卡…');
    void (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      const context = canvas.getContext('2d');
      if (!context) {
        if (active) setFeedback('当前浏览器无法绘制图片，但仍可复制故事入口。');
        return;
      }
      await document.fonts?.ready;
      let character: HTMLImageElement | null = null;
      let portalCode: HTMLImageElement | null = null;
      try { character = await loadImage(persona.asset); } catch { /* text fallback remains exportable */ }
      try { portalCode = await loadImage(await createPortalCode()); } catch { /* the card still exports if the browser blocks Canvas data URLs */ }
      if (!active) return;
      drawCard(context, character, portalCode, storyTitle, persona);
      setReady(true);
      setFeedback(character && portalCode ? '分享卡已排好：二维码回到看山任意门，系统分享保留本局入口。' : '分享卡已排好，可以保存或从系统分享面板发出。');
    })();
    return () => { active = false; };
  }, [signature, persona, shareUrl, storyTitle]);

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || busy) return;
    setBusy('save');
    try {
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `看山调查人格-${persona.code}-${storyTitle}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setFeedback('PNG 已保存。把它发出去，也不会带走你的剧情存档。');
    } catch {
      setFeedback('图片没有保存成功，可以先复制故事入口再试一次。');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (busy) return;
    setBusy('copy');
    try {
      await copyText(shareUrl);
      setFeedback('故事入口已复制。链接只含故事和人格类型，不含你的存档。');
    } catch {
      setFeedback('自动复制失败，请长按下方链接手动复制。');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (busy) return;
    const shareNavigator = navigator as ShareNavigator;
    if (!shareNavigator.share) {
      await copy();
      return;
    }
    setBusy('share');
    try {
      const data: ShareData = {
        title: `我的看山调查人格：${persona.name}`,
        text: `我在《${storyTitle}》拿到了「${persona.name}」：${persona.shareLine} 你会把同一件事查成什么？`,
        url: shareUrl,
      };
      const canvas = canvasRef.current;
      if (canvas && ready && shareNavigator.canShare) {
        const blob = await canvasToBlob(canvas);
        const file = new File([blob], `看山调查人格-${persona.code}.png`, { type: 'image/png' });
        if (shareNavigator.canShare({ files: [file] })) data.files = [file];
      }
      await shareNavigator.share(data);
      setFeedback('分享面板已打开。');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setFeedback('已取消分享，卡片还在这里。');
      else {
        try {
          await copyText(shareUrl);
          setFeedback('系统分享暂时不可用，故事入口已经复制。');
        } catch {
          setFeedback('分享没有完成，请长按下方链接手动复制。');
        }
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="poster" aria-labelledby="poster-title">
      <div className="poster__heading">
        <div><p>已生成 · 1080 × 1440</p><h3 id="poster-title">保存或分享这张人格卡</h3></div>
        <span>{persona.code}</span>
      </div>
      <canvas ref={canvasRef} className="poster__canvas" aria-label={`${persona.name}调查人格分享卡预览`} />
      <div className="poster__actions">
        <button className="btn btn--primary" disabled={!ready || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '正在生成图片…' : '保存图片'}</button>
        <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void share()}>{busy === 'share' ? '正在打开分享…' : '分享这张卡'}</button>
      </div>
      <label className="poster__link">
        <span>朋友打开后会先回到刘看山的故事入口</span>
        <span className="poster__link-row"><input readOnly value={shareUrl} aria-label="可复制的故事入口" /><button type="button" disabled={Boolean(busy)} onClick={() => void copy()}>{busy === 'copy' ? '复制中…' : '复制链接'}</button></span>
      </label>
      <p className="poster__privacy">链接不包含你的选择、对话、知乎身份或剧情存档。</p>
      <p className="poster__status" aria-live="polite">{feedback}</p>
    </section>
  );
}
