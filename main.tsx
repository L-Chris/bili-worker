import { Hono } from 'hono'
import { serveStatic } from "https://deno.land/x/hono/middleware.ts";
import { Video } from './video.ts'
import { App } from './app.tsx'

const app = new Hono()

app.use("/static/*", serveStatic({ root: "./" }));

app.get('/', (c) => {
  return c.html(<App/>)
})

app.get('/video/subtitle', async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query('bvid');
    const type = c.req.query('type') || '0' // 0 - data为所有字幕汇总后的文本、1 - 资源原数据为对象

    // 参数验证
    if (!bvid) {
      return c.json({
        code: 400,
        message: '缺少必要参数 bvid'
      }, 400);
    }

    // 从 cookie 中获取凭据
    const cookie = c.req.header('cookie') || '';
    const cookies = Object.fromEntries(
      cookie.split(';')
        .map(item => item.trim().split('='))
        .filter(item => item.length === 2)
    );

    const video = new Video({ 
      bvid, 
      credential: {
        sessdata: cookies['sessdata'] || Deno.env.get('sessdata') || '',
        bili_jct: cookies['bili_jct'] || Deno.env.get('bili_jct') || '',
        buvid3: cookies['buvid3'] || Deno.env.get('buvid3') || '',
        dedeuserid: cookies['dedeuserid'] || Deno.env.get('dedeuserid') || '',
        ac_time_value: cookies['ac_time_value'] || Deno.env.get('ac_time_value') || ''
      } 
    });

    // 调用 video 模块获取字幕
    const subtitle = await video.getSubtitle();
    const data = (type === '0' && Array.isArray(subtitle?.body)) ? subtitle.body.reduce((pre: string, cur: { content: string }) => pre + cur.content, '') : subtitle
    
    return c.json({
      code: data ? 200 : 400,
      data
    });
    
  } catch (error) {
    console.error('获取字幕失败:', error);
    return c.json({
      code: 500,
      message: '获取字幕失败'
    }, 500);
  }
});

Deno.serve({ port: 8000 }, app.fetch)