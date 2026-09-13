// 兼容旧场景的氛围层；不再用滚动监听制造视差。
import { memo, useMemo, useState } from 'react';

export function colorFor(id: string, i = 0): { a: string; b: string } {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
  h = (h + i * 47) % 360;
  return { a: `hsl(${h} 34% 15%)`, b: `hsl(${(h + 52) % 360} 46% 26%)` };
}

function resolveImage(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `/${src.replace(/^\.?\//, '')}`;
}

const Art = memo(function Art({ id, image, label }: { id: string; image?: string; label?: string }) {
  const c = useMemo(() => colorFor(id), [id]);
  const [imgOk, setImgOk] = useState(true);
  const [imgLoad, setImgLoad] = useState(false);
  const hasImage = Boolean(image) && imgOk;

  return (
    <div className={hasImage ? 'art art--img' : 'art'}>
      <div
        className="art__inner"
        style={
          hasImage
            ? undefined
            : {
                background: `radial-gradient(130% 100% at 50% 0%, ${c.a} 0%, ${c.b} 52%, transparent 82%), radial-gradient(95% 65% at 50% 115%, ${c.b} 0%, transparent 74%)`,
              }
        }
      >
        {hasImage ? (
          <>
            <img
              src={resolveImage(image as string)}
              alt={label || ''}
              className="art__img"
              style={imgLoad ? undefined : { opacity: 0 }}
              onLoad={() => setImgLoad(true)}
              onError={() => setImgOk(false)}
            />
            <div className="art__veil" />
          </>
        ) : (
          <>
            <div className="art__noise" aria-hidden />
            <div className="art__haze" aria-hidden />
          </>
        )}
      </div>
    </div>
  );
});

export default Art;
