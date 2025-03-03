import { Hono } from 'hono'
import { serveStatic } from "https://deno.land/x/hono/middleware.ts";
import { Video } from './video.ts'
import { App } from './app.tsx'

const app = new Hono()

app.use("/static/*", serveStatic({ root: "./" }));

app.get('/', (c) => {
  return c.html(<App/>)
})

async function getVideoSubtitle(params: {
  bvid: string
  type?: string
  cookie: string
}) {
  const cookies = Object.fromEntries(
    params.cookie.split(';')
      .map(item => item.trim().split('='))
      .filter(item => item.length === 2)
  );

  const video = new Video({
    bvid: params.bvid,
    credential: {
      sessdata: cookies?.sessdata || Deno.env.get('sessdata') || '',
      bili_jct: cookies?.bili_jct || Deno.env.get('bili_jct') || '',
      buvid3: cookies?.buvid3 || Deno.env.get('buvid3') || '',
      dedeuserid: cookies?.dedeuserid || Deno.env.get('dedeuserid') || '',
      ac_time_value: cookies?.ac_time_value || Deno.env.get('ac_time_value') || ''
    }
  })

    // 调用 video 模块获取字幕
    const subtitle = await video.getSubtitle();
    const data = (params.type === '0' && Array.isArray(subtitle?.body)) ? subtitle.body.reduce((pre: string, cur: { content: string }) => pre + cur.content, '') : subtitle
    return {
      title: video.info.title,
      subtitle: data,
      owner: video.info.owner.name,
    }
}

app.get('/video/summary', async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query('bvid');
    const cookie = c.req.header('cookie') || '';

    // 参数验证
    if (!bvid) {
      return c.json({
        code: 400,
        message: '缺少必要参数 bvid'
      }, 400);
    }

    const data = await getVideoSubtitle({ bvid, type: '0', cookie })
    if (!data) return c.json({
      code: '400',
      message: '获取字幕失败',
    })

    if (!data.subtitle) return c.json({
      code: '200',
      message: '视频无字幕',
      data
    })

    // 调用 AI 接口总结视频内容
    const response = await fetch('https://qwen-rethinkos.deno.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': 'Bearer ' + Deno.env.get('OPENAI_API_KEY') || ''
      },
      body: JSON.stringify({
        model: 'qwen-max-latest',
        messages: [
          {
            role: 'system',
            content: '你是一个视频内容总结助手，请简要总结以下视频字幕内容的主要观点：'
          },
          {
            role: 'user',
            content: data.subtitle
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    const result = await response.json();
    const summary = result.choices[0].message.content;

    return c.json({
      code: 200,
      data: {
        ...data,
        summary: summary
      }
    });

  } catch(err) {
    console.log(err)
    return c.json({
      code: 500,
      message: '获取视频总结失败'
    }, 500);
  }
})

app.get('/video/subtitle', async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query('bvid');
    const type = c.req.query('type') || '0' // 0 - data为所有字幕汇总后的文本、1 - 资源原数据为对象
    const cookie = c.req.header('cookie') || '';

    // 参数验证
    if (!bvid) {
      return c.json({
        code: 400,
        message: '缺少必要参数 bvid'
      }, 400);
    }
    const data = await getVideoSubtitle({ bvid, type, cookie })
    
    return c.json({
      code: data?.subtitle ? 200 : 400,
      data: data?.subtitle
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