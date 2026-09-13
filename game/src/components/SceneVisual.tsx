import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Scene } from '../types';
import { colorFor } from './Art';
import '../scene-stage.css';

type SceneVisualVariant = 'narrative' | 'chat' | 'encounter' | 'ending';

interface SceneVisualProps {
  scene: Scene;
  fallbackLabel: string;
  variant?: SceneVisualVariant;
  className?: string;
}

const ASSET_ALTS: Readonly<Record<string, string>> = {
  'blue-training-hall.jpg': '深蓝灯光下的公司培训礼堂，员工们面向讲台就座',
  'blue-pantry.jpg': '昏暗茶水间里，两个人隔着操作台低声交谈',
  'blue-restroom.jpg': '冷白灯照着洗手池与镜面，水迹留在台面上',
  'blue-textbook.jpg': '培训教材摊开在桌上，蓝色血液的内容被重点标记',
  'blue-office-night.jpg': '夜间办公室只剩电脑屏幕与远处城市的冷光',
  'blue-exam.jpg': '两份培训试卷并排放在桌面，等待被仔细比对',
  'blue-trainer.jpg': '培训师站在冷色灯光下，神情克制而疏离',
  'blue-street-tail.jpg': '夜色街头，一个灰色身影隔着人群尾随',
  'blue-alley.jpg': '潮湿昏暗的死胡同尽头没有出口',
  'blue-evidence-desk.jpg': '线索与记录散放在桌面，等待整理成完整判断',
  'blue-ending-quiet.jpg': '城市夜色恢复平静，只留下克制的冷蓝灯光',
  'blue-ending-hot.jpg': '暖色灯光照亮人群，事件引发了公开回应',
  'blue-ending-fold.jpg': '画面在冷暗阴影中收束，真相仍被折叠',
  'blue-ending-egg.jpg': '异常光线照亮隐秘出口，暗示故事之外的线索',
};

function resolveImage(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `/${src.replace(/^\.?\//, '')}`;
}

export function sceneVisualAlt(scene: Scene, fallbackLabel: string): string {
  const authored = scene.imageAlt?.trim();
  if (authored) return authored;
  const assetName = scene.image?.split('/').at(-1)?.split('?')[0];
  if (assetName && ASSET_ALTS[assetName]) return ASSET_ALTS[assetName];
  const chapter = scene.chapter?.trim() || fallbackLabel;
  return `${chapter}的场景插画`;
}

/**
 * A foreground scene image with a reserved 3:2 frame. The placeholder remains
 * in flow while the asset decodes, so a slow or failed request cannot shift the
 * reading surface or remove scene context.
 */
export function SceneVisual({ scene, fallbackLabel, variant = 'narrative', className = '' }: SceneVisualProps) {
  const colors = useMemo(() => colorFor(scene.id), [scene.id]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(scene.image ? 'loading' : 'failed');
  const alt = sceneVisualAlt(scene, fallbackLabel);
  const image = scene.image ? resolveImage(scene.image) : '';

  useEffect(() => {
    setState(scene.image ? 'loading' : 'failed');
  }, [scene.id, scene.image]);

  const style = {
    '--scene-visual-a': colors.a,
    '--scene-visual-b': colors.b,
  } as CSSProperties;

  return (
    <figure
      className={`scene-visual scene-visual--${variant}${state === 'ready' ? ' is-ready' : ''}${state === 'failed' ? ' is-fallback' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {image && state !== 'failed' ? <img
        src={image}
        alt={alt}
        width="1600"
        height="1066"
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
      /> : null}
      <span className="scene-visual__placeholder" role={state === 'failed' ? 'img' : undefined} aria-label={state === 'failed' ? alt : undefined} aria-hidden={state !== 'failed'}>
        <span>{scene.image ? '场景画面暂未载入' : '这一幕由文字展开'}</span>
      </span>
    </figure>
  );
}
