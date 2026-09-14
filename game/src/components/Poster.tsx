// 1080 × 1440 share card. Dynamic copy stays in Canvas/DOM so image models
// never need to render Chinese text, and the card still works without an LLM.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EndingMeta } from '../types';
import type { PersonaResult } from '../lib/persona.mjs';
import { buildPersonaShareUrl } from '../lib/persona.mjs';

const W = 1080;
const H = 1440;
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
  persona: PersonaResult,
  shareUrl: string,
) {
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#d9d2c4';
  c.fillRect(0, 0, W, H);
  seededTexture(c, `${storyTitle}|${persona.code}`);

  const accent = accentByPersona[persona.code];
  c.fillStyle = '#10291f';
  roundedRect(c, 34, 34, 1012, 1372, 42);
  c.fill();
  c.fillStyle = '#f2ecdf';
  roundedRect(c, 56, 56, 968, 1328, 28);
  c.fill();
  c.fillStyle = accent;
  roundedRect(c, 76, 76, 150, 54, 27);
  c.fill();
  c.fillStyle = '#fffaf0';
  c.font = `800 23px ${SANS}`;
  c.textAlign = 'center';
  c.fillText(persona.code, 151, 111);

  c.textAlign = 'right';
  c.fillStyle = '#657269';
  c.font = `600 19px ${SANS}`;
  c.letterSpacing = '3px';
  c.fillText('本局获得 · KANSHAN TYPE', 986, 111);
  c.letterSpacing = '0px';

  c.textAlign = 'center';
  c.fillStyle = `${accent}18`;
  c.font = `900 230px ${SANS}`;
  c.fillText(persona.code, 540, 438);

  c.save();
  c.translate(540, 164);
  c.fillStyle = '#e2dacb';
  roundedRect(c, -300, 0, 600, 530, 42);
  c.fill();
  c.strokeStyle = `${accent}99`;
  c.lineWidth = 4;
  c.stroke();
  if (character) {
    const ratio = Math.min(540 / character.naturalWidth, 490 / character.naturalHeight);
    const width = character.naturalWidth * ratio;
    const height = character.naturalHeight * ratio;
    c.drawImage(character, -width / 2, 24 + (490 - height) / 2, width, height);
  } else {
    c.fillStyle = '#153128';
    c.font = `700 44px ${SERIF}`;
    c.fillText('刘看山正在赶来', 0, 275);
  }
  c.restore();

  c.fillStyle = '#6f776f';
  c.font = `600 20px ${SANS}`;
  c.letterSpacing = '6px';
  c.fillText('看山调查人格', 540, 758);
  c.letterSpacing = '0px';
  c.fillStyle = '#10291f';
  c.font = `800 82px ${SERIF}`;
  c.fillText(persona.name, 540, 858);

  c.strokeStyle = `${accent}77`;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(162, 910);
  c.lineTo(918, 910);
  c.stroke();

  c.fillStyle = '#203d32';
  c.font = `700 42px ${SERIF}`;
  drawLines(c, splitLines(c, persona.shareLine, 760, 2), 540, 990, 64);

  c.fillStyle = '#6f776f';
  c.font = `24px ${SERIF}`;
  c.fillText(`《${storyTitle}》`, 540, 1122);

  c.fillStyle = '#10291f';
  roundedRect(c, 76, 1194, 928, 166, 22);
  c.fill();
  c.fillStyle = '#f2d79a';
  c.font = `700 27px ${SERIF}`;
  c.fillText('你会把同一件事查成什么？', 540, 1250);
  c.fillStyle = 'rgba(242,236,223,.76)';
  c.font = `19px ${SANS}`;
  c.fillText('看山任意门 · kanshan.makebook.hk2048.online', 540, 1295);
  c.fillStyle = 'rgba(242,236,223,.46)';
  c.font = `16px ${SANS}`;
  c.fillText('娱乐性结果 · 不是心理测量', 540, 1333);

  // Keep the actual URL in the share payload; the saved card only needs a
  // readable destination rather than a long query string.
  void shareUrl;
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
      try { character = await loadImage(persona.asset); } catch { /* text fallback remains exportable */ }
      if (!active) return;
      drawCard(context, character, storyTitle, persona, shareUrl);
      setReady(true);
      setFeedback(character ? '分享卡已排好，可以保存或转发。' : '角色图暂时没赶上，文字版分享卡仍可保存。');
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
