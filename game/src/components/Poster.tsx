// 1080 × 1440 share card. Dynamic copy stays in Canvas/DOM so image models
// never need to render Chinese text, and the card still works without an LLM.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EndingMeta } from '../types';
import type { Report } from '../lib/report';
import type { PersonaResult } from '../lib/persona.mjs';
import { buildPersonaShareUrl } from '../lib/persona.mjs';

const W = 1080;
const H = 1440;
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';
const SANS = 'system-ui,-apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

/** 结局评级展示文案（结局页徽章与海报共用） */
export const ENDING_RATING_LABEL: Record<NonNullable<EndingMeta['rating']>, string> = {
  normal: '普通结局',
  rare: '稀有 · 二星',
  legend: '传说 · 三星',
  egg: '彩蛋结局',
};

interface PosterProps {
  storyId: string;
  storyTitle: string;
  report: Report;
  persona: PersonaResult;
}

type ShareNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

const accentByPersona: Record<PersonaResult['code'], string> = {
  FIRE: '#d36f48', ANON: '#486a66', CLEAN: '#5a7465', CTRL: '#6a665b',
  ECHO: '#ba7650', ASKR: '#4f6f78', FAIR: '#6d7251', FEEL: '#8c6f68',
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('刘看山素材加载失败'));
    image.src = src;
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

function seededTexture(c: CanvasRenderingContext2D, seedText: string) {
  let seed = [...seedText].reduce((sum, char) => (sum * 31 + (char.codePointAt(0) || 0)) >>> 0, 2166136261);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  c.fillStyle = 'rgba(28, 49, 40, .06)';
  for (let index = 0; index < 920; index += 1) c.fillRect(random() * W, random() * H, 1.5, 1.5);
}

function drawCard(
  c: CanvasRenderingContext2D,
  character: HTMLImageElement | null,
  storyTitle: string,
  report: Report,
  persona: PersonaResult,
  shareUrl: string,
) {
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#efeadd';
  c.fillRect(0, 0, W, H);
  seededTexture(c, `${storyTitle}|${persona.code}`);

  const accent = accentByPersona[persona.code];
  c.fillStyle = '#153128';
  c.fillRect(0, 0, W, 520);
  c.fillStyle = accent;
  c.fillRect(0, 0, 24, H);
  c.fillStyle = 'rgba(239,234,221,.07)';
  c.font = `800 278px ${SANS}`;
  c.textAlign = 'left';
  c.fillText(persona.code, 42, 430);

  c.fillStyle = '#f3d797';
  c.font = `600 24px ${SANS}`;
  c.letterSpacing = '5px';
  c.fillText('看山任意门 · 本局调查人格', 76, 82);
  c.letterSpacing = '0px';

  c.fillStyle = 'rgba(239,234,221,.78)';
  c.font = `28px ${SERIF}`;
  c.fillText(`《${storyTitle}》`, 76, 134);

  c.save();
  c.translate(650, 54);
  c.rotate(-0.025);
  c.fillStyle = '#e3d9c3';
  roundedRect(c, 0, 0, 350, 420, 40);
  c.fill();
  c.strokeStyle = 'rgba(243,215,151,.7)';
  c.lineWidth = 3;
  c.stroke();
  if (character) {
    const ratio = Math.min(324 / character.naturalWidth, 388 / character.naturalHeight);
    const width = character.naturalWidth * ratio;
    const height = character.naturalHeight * ratio;
    c.drawImage(character, (350 - width) / 2, 20 + (388 - height) / 2, width, height);
  } else {
    c.fillStyle = '#153128';
    c.font = `700 36px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText('刘看山', 175, 205);
    c.font = `22px ${SANS}`;
    c.fillText('正在赶来', 175, 246);
  }
  c.restore();

  c.textAlign = 'left';
  c.fillStyle = accent;
  c.font = `800 30px ${SANS}`;
  c.fillText(persona.code, 76, 608);
  c.fillStyle = '#153128';
  c.font = `800 84px ${SERIF}`;
  c.fillText(persona.name, 76, 700);
  c.fillStyle = '#52635b';
  c.font = `600 26px ${SANS}`;
  c.fillText(persona.route, 80, 752);

  c.fillStyle = '#fffdf6';
  roundedRect(c, 72, 790, 936, 164, 28);
  c.fill();
  c.fillStyle = accent;
  c.font = `700 31px ${SERIF}`;
  drawLines(c, splitLines(c, persona.roast, 820, 2), 112, 850, 49);

  c.fillStyle = '#243c33';
  c.font = `30px ${SERIF}`;
  drawLines(c, splitLines(c, persona.praise, 860, 2), 84, 1012, 46);

  c.fillStyle = '#153128';
  c.font = `700 24px ${SANS}`;
  c.fillText('这张卡来自你的关键选择', 84, 1118);
  c.font = `24px ${SANS}`;
  c.fillStyle = '#52635b';
  persona.proofLines.slice(0, 3).forEach((line, index) => {
    c.fillStyle = accent;
    c.fillRect(86, 1154 + index * 48, 8, 8);
    c.fillStyle = '#52635b';
    c.fillText(line, 112, 1164 + index * 48);
  });

  c.strokeStyle = 'rgba(21,49,40,.18)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(84, 1298);
  c.lineTo(996, 1298);
  c.stroke();
  c.fillStyle = '#153128';
  c.font = `700 21px ${SANS}`;
  c.fillText('你会把同一件事查成什么？', 84, 1334);
  const readableUrl = decodeURI(shareUrl.replace(/^https?:\/\//, ''));
  c.fillStyle = '#52635b';
  c.font = `16px ${SANS}`;
  const linkLines = splitLines(c, readableUrl, 900, 2);
  drawLines(c, linkLines, 84, 1366, 20);
  c.fillStyle = '#7a817d';
  c.font = `16px ${SANS}`;
  c.textAlign = 'right';
  c.fillText(`${report.badge} · 娱乐性结果，不是心理测量`, 996, 1410);
  c.textAlign = 'left';
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

export function Poster({ storyId, storyTitle, report, persona }: PosterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'save' | 'share' | 'copy' | null>(null);
  const [feedback, setFeedback] = useState('');
  const shareUrl = useMemo(() => buildPersonaShareUrl(storyId, persona.code), [storyId, persona.code]);
  const signature = `${storyTitle}|${report.meta.title}|${report.badge}|${persona.code}|${shareUrl}`;

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
      try { character = await loadImage(persona.asset); } catch { /* text fallback remains exportable */ }
      if (!active) return;
      drawCard(context, character, storyTitle, report, persona, shareUrl);
      setReady(true);
      setFeedback(character ? '分享卡已排好，可以保存或转发。' : '角色图暂时没赶上，文字版分享卡仍可保存。');
    })();
    return () => { active = false; };
  }, [signature, persona, report, shareUrl, storyTitle]);

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
        text: `${persona.roast} 你会把同一件事查成什么？`,
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
        <div><p>1080 × 1440</p><h3 id="poster-title">把这局变成一张卡</h3></div>
        <span>{persona.code}</span>
      </div>
      <canvas ref={canvasRef} className="poster__canvas" aria-label={`${persona.name}调查人格分享卡预览`} />
      <div className="poster__actions">
        <button className="btn btn--primary" disabled={!ready || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '正在生成 PNG…' : '保存 PNG'}</button>
        <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void share()}>{busy === 'share' ? '正在打开分享…' : '分享给朋友'}</button>
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
