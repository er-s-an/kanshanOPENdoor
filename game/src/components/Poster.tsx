// 结局海报：Canvas 绘制（故事名 + 结局名 + 人格关键词 + 二维码占位），可保存 PNG
import { useEffect, useRef } from 'react';
import type { EndingMeta } from '../types';
import type { Report } from '../lib/report';
import { FOX } from '../lib/config';

const W = 720;
const H = 1160;
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';
const SANS = 'system-ui,-apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

/** 结局评级展示文案（结局页徽章与海报共用） */
export const ENDING_RATING_LABEL: Record<NonNullable<EndingMeta['rating']>, string> = {
  normal: '普通结局',
  rare: '稀有 ★★',
  legend: '传说 ★★★',
  egg: '彩蛋 ✦',
};

export function Poster({ storyTitle, report }: { storyTitle: string; report: Report }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const data = `${storyTitle}|${report.meta.title}|${report.words.join('/')}|${report.chapterCount}|${report.choices.length}|${report.badge}|${report.clueFound}/${report.clueTotal}|${report.meta.rating || ''}`;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    if (!c) return;
    draw(c);
  }, [data]);

  const download = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `看山任意门-${storyTitle}-${report.meta.title}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  };

  function draw(c: CanvasRenderingContext2D) {
    // 底色
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0e1524');
    bg.addColorStop(0.55, '#0a0f1a');
    bg.addColorStop(1, '#05070d');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // 噪点
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      c.fillRect(x, y, 1.4, 1.4);
    }
    // 光晕
    const glow = c.createRadialGradient(W / 2, 120, 40, W / 2, 120, 560);
    glow.addColorStop(0, 'rgba(255,210,125,0.16)');
    glow.addColorStop(1, 'rgba(255,210,125,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, 560);

    // 双线边框
    c.strokeStyle = 'rgba(230,214,190,0.55)';
    c.lineWidth = 2;
    c.strokeRect(36, 36, W - 72, H - 72);
    c.strokeStyle = 'rgba(230,214,190,0.16)';
    c.strokeRect(52, 52, W - 104, H - 104);

    // 顶部
    c.textAlign = 'center';
    c.fillStyle = 'rgba(233,237,245,0.92)';
    c.font = `20px ${SANS}`;
    c.fillText(`${FOX} 看山任意门 · 穿越盐言故事`, W / 2, 118);
    c.fillStyle = 'rgba(233,237,245,0.5)';
    c.font = `26px ${SERIF}`;
    c.fillText(storyTitle, W / 2, 168);

    // 结局
    c.fillStyle = 'rgba(255,210,125,0.85)';
    c.font = `600 30px ${SANS}`;
    c.fillText('结 局', W / 2, 300);
    const t = report.meta.title || '故事终了';
    c.fillStyle = '#f4ede2';
    c.font = `700 84px ${SERIF}`;
    wrapTitle(c, t, 400, 6);
    if (report.meta.tone) {
      c.fillStyle = 'rgba(233,237,245,0.6)';
      c.font = `28px ${SERIF}`;
      c.fillText(`—— ${report.meta.tone} ——`, W / 2, 610);
    }

    // 结局评级徽章：仅当剧本为结局标注 rating 时绘制
    const rating = report.meta.rating;
    if (rating) {
      const label = ENDING_RATING_LABEL[rating];
      c.font = `600 26px ${SANS}`;
      const rw = c.measureText(label).width + 56;
      const rh = 48;
      const rx = W / 2 - rw / 2;
      const ry = 496;
      if (rating === 'legend') {
        c.fillStyle = 'rgba(255,210,125,0.94)';
        rrect(c, rx, ry, rw, rh, 24);
        c.fill();
        c.fillStyle = '#20180a';
        c.fillText(label, W / 2, ry + 32);
      } else {
        c.strokeStyle = rating === 'normal' ? 'rgba(233,237,245,0.35)' : 'rgba(255,210,125,0.78)';
        c.lineWidth = 2;
        if (rating === 'egg') c.setLineDash([10, 8]);
        rrect(c, rx, ry, rw, rh, 24);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = rating === 'normal' ? 'rgba(233,237,245,0.62)' : 'rgba(255,210,125,0.92)';
        c.fillText(label, W / 2, ry + 32);
      }
    }

    // Explicit chapter scope; no rarity claim.
    c.fillStyle = 'rgba(255,210,125,0.85)';
    c.font = `26px ${SANS}`;
    c.fillText(report.badge, W / 2, 656);

    // 分隔
    c.fillStyle = 'rgba(255,210,125,0.7)';
    c.font = `22px ${SANS}`;
    c.fillText('◆   ◆   ◆', W / 2, 690);

    // 人格关键词 chips
    const words = report.words.slice(0, 4);
    c.font = `26px ${SERIF}`;
    const chipH = 58;
    let x = W / 2 - ((words.length * 176 + (words.length - 1) * 24)) / 2;
    const y = 760;
    for (const w of words) {
      c.strokeStyle = 'rgba(255,210,125,0.7)';
      c.lineWidth = 2;
      rrect(c, x, y, 164, chipH, 29);
      c.stroke();
      c.fillStyle = '#f4ede2';
      c.fillText(w, x + 82, y + 39);
      x += 188;
    }
    c.fillStyle = 'rgba(233,237,245,0.55)';
    c.font = `24px ${SANS}`;
    c.fillText('你的穿越记录', W / 2, 900);

    // 统计
    c.font = `26px ${SANS}`;
    c.fillStyle = 'rgba(233,237,245,0.72)';
    const cluePart = report.clueTotal > 0 ? ` · 线索 ${report.clueFound}/${report.clueTotal}` : '';
    c.fillText(`走过 ${Math.max(report.chapterCount, 1)} 个章节 · ${report.choices.length} 次抉择${cluePart}`, W / 2, 948);

    // 底部
    c.fillStyle = 'rgba(233,237,245,0.4)';
    c.font = `20px ${SANS}`;
    c.fillText('ZHIHU HACKATHON 2026 · 刘看山引路', W / 2, H - 96);
  }

  function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function wrapTitle(c: CanvasRenderingContext2D, text: string, y: number, maxLen: number) {
    const lines: string[] = [];
    let cur = '';
    for (const ch of text) {
      if (cur.length >= maxLen) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    const slice = lines.slice(0, 2);
    const lineH = 110;
    const startY = y - ((slice.length - 1) * lineH) / 2;
    slice.forEach((l, i) => c.fillText(l, W / 2, startY + i * lineH));
  }

  return (
    <div className="poster">
      <canvas ref={canvasRef} className="poster__canvas" aria-label="结局海报" />
      <button className="btn btn--primary btn--lg" onClick={download}>
        保存海报 ⤓
      </button>
    </div>
  );
}
