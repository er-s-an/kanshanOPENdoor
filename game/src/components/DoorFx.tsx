// 门缝光过渡：场景切换时一道暖光从屏幕中央扫过（~450ms，可点穿，不挡操作）
import { useEffect, useState } from 'react';

export function DoorFx({ token }: { token: number }) {
  const [run, setRun] = useState(token > 0);
  const [artOk, setArtOk] = useState(true);
  useEffect(() => {
    if (token > 0) {
      setRun(true);
      const id = window.setTimeout(() => setRun(false), 520);
      return () => clearTimeout(id);
    }
  }, [token]);
  if (!run) return null;
  return <div key={token} className="doorfx" aria-hidden>{artOk ? <img className="doorfx__art" src="/art/portal/liu-kanshan-opening-door-transition.jpg" alt="" loading="lazy" onError={() => setArtOk(false)} /> : null}</div>;
}
