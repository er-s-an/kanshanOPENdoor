// 本地假上游：模拟知乎直答的 OpenAI 兼容 SSE，供无网络 / 无密钥时联调网关。
// 启动：npm run dev:mock（监听 127.0.0.1:8791）
// 网关：ZHIDA_BASE_URL=http://127.0.0.1:8791/v1 npm run dev:gateway
// 行为：玩家消息包含“船票” → 老周交出真相（goalAchieved=true）；否则继续推脱（false）。
import http from 'node:http';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { messages } = JSON.parse(body);
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = (lastUser?.content || '').toLowerCase();
    const achieved = userText.includes('船票') || userText.includes('十年前');
    const reply = achieved
      ? '老周往船板上一坐，烟斗里的火星明明灭灭：也罢。你问的那班船，十年前就沉在雾里——船票是假的，摆渡却是真的。你非要跟着走，我不拦你。'
      : '老周低头擦着桨，声音被雾泡软了：现在还不是说这个的时候。雾没散，问了也是白问。';
    const full = `${reply}\n{"goalAchieved": ${achieved}}`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const step = 4;
    let i = 0;
    const timer = setInterval(() => {
      if (i >= full.length) {
        clearInterval(timer);
        res.write(': keep-alive\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      sse({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: 'zhida-fast-1p5', choices: [{ index: 0, delta: { content: full.slice(i, i + step) }, finish_reason: null }] });
      i += step;
    }, 8);
  });
});
server.listen(8791, '127.0.0.1', () => console.log('mock zhida upstream: http://127.0.0.1:8791/v1/chat/completions'));
