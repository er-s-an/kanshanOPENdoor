import { useState, type CSSProperties } from 'react';
import type { InvestigationItem, Scene } from '../types';

function resolveImage(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `/${src.replace(/^\.?\//, '')}`;
}

function hotspotStyle(item: InvestigationItem): CSSProperties | null {
  const hotspot = item.discover?.hotspot;
  if (!hotspot) return null;
  const values = [hotspot.x, hotspot.y, hotspot.width, hotspot.height];
  if (!values.every(Number.isFinite) || hotspot.width <= 0 || hotspot.height <= 0) return null;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const left = clamp(hotspot.x);
  const top = clamp(hotspot.y);
  const width = Math.min(clamp(hotspot.width), 1 - left);
  const height = Math.min(clamp(hotspot.height), 1 - top);
  if (width <= 0 || height <= 0) return null;
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}

interface InvestigationSceneProps {
  scene: Scene;
  items: InvestigationItem[];
  disabled?: boolean;
  onDiscover: (item: InvestigationItem) => void;
}

/**
 * Hotspots are ordinary buttons positioned over an uncropped scene image. Their
 * accessible labels use only authored non-spoiler hints, never hidden item data.
 */
export function InvestigationScene({ scene, items, disabled = false, onDiscover }: InvestigationSceneProps) {
  const [failed, setFailed] = useState(false);
  if (!scene.image || failed) {
    return scene.image ? <p className="investigation__scene-fallback" role="status">场景图暂时没有加载。仍可使用文字搜寻完成调查。</p> : null;
  }
  const hotspots = items.flatMap((item) => {
    const style = hotspotStyle(item);
    const modes = item.discover?.modes;
    return style && (!modes?.length || modes.includes('look')) ? [{ item, style }] : [];
  });
  return (
    <figure className="investigation__scene">
      <div className="investigation__scene-frame">
        <img src={resolveImage(scene.image)} alt={scene.imageAlt || ''} onError={() => setFailed(true)} />
        <div className="investigation__hotspots" aria-label="场景中的可调查区域">
          {hotspots.map(({ item, style }, index) => (
            <button
              type="button"
              className="investigation__hotspot"
              key={item.id}
              style={style}
              disabled={disabled}
              onClick={() => onDiscover(item)}
              aria-label={item.discover?.hint || `调查区域 ${index + 1}`}
            >
              <span aria-hidden>＋</span>
            </button>
          ))}
        </div>
      </div>
      {scene.imageAlt ? <figcaption>{scene.imageAlt}</figcaption> : null}
    </figure>
  );
}
