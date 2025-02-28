import { Hono } from 'hono'
import { Video } from './video.ts'

const app = new Hono()

app.get('/', (c) => c.text('Hello World'))

app.get('/video/subtitle', async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query('bvid');
    const sessdata = c.req.query('sessdata') || ''
    const bili_jct = c.req.query('bili_jct') || ''
    const buvid3 = c.req.query('buvid3') || ''
    const dedeuserid = c.req.query('dedeuserid') || ''
    const ac_time_value = c.req.query('ac_time_value') || ''

    // 参数验证
    if (!bvid) {
      return c.json({
        code: 400,
        message: '缺少必要参数 bvid'
      }, 400);
    }

    const video = new Video({ bvid, credential: {
        sessdata,
        bili_jct,
        buvid3,
        dedeuserid,
        ac_time_value
    } })

    // 调用 video 模块获取字幕
    const subtitles = await video.getSubtitle();
    
    return c.json({
      code: 200,
      data: subtitles
    });
    
  } catch (error) {
    console.error('获取字幕失败:', error);
    return c.json({
      code: 500,
      message: '获取字幕失败'
    }, 500);
  }
});