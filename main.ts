import { Hono } from 'hono'
import { Video } from './video.ts'

const app = new Hono()

app.get('/', (c) => c.text('Hello World'))

app.get('/video/subtitle', async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query('bvid');

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
        sessdata: cookies['sessdata'] || '',
        bili_jct: cookies['bili_jct'] || '',
        buvid3: cookies['buvid3'] || '',
        dedeuserid: cookies['dedeuserid'] || '',
        ac_time_value: cookies['ac_time_value'] || ''
      } 
    });

    // 调用 video 模块获取字幕
    const subtitle = await video.getSubtitle();
    
    return c.json({
      code: 200,
      data: subtitle
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