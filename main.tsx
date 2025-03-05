import { Hono } from "hono";
import { serveStatic } from "https://deno.land/x/hono/middleware.ts";
import { Video } from "./video.ts";
import { App } from "./app.tsx";
import { createParser } from "eventsource-parser";
import { formatTimestamp } from "./utils.ts";
import { createTranscriptionTask, pollTaskUntilComplete, ResultData, ResultState, uploadAudio } from './bcut.ts'

const app = new Hono();

app.use("/static/*", serveStatic({ root: "./" }));

app.get("/", (c) => {
  return c.html(<App />);
});

async function getVideoSubtitle(params: {
  bvid: string;
  type?: string;
  cookie: string;
}) {
  const cookies = Object.fromEntries(
    params.cookie.split(";")
      .map((item) => item.trim().split("="))
      .filter((item) => item.length === 2),
  );

  const video = new Video({
    bvid: params.bvid,
    credential: {
      sessdata: cookies?.sessdata || Deno.env.get("sessdata") || "",
      bili_jct: cookies?.bili_jct || Deno.env.get("bili_jct") || "",
      buvid3: cookies?.buvid3 || Deno.env.get("buvid3") || "",
      dedeuserid: cookies?.dedeuserid || Deno.env.get("dedeuserid") || "",
      ac_time_value: cookies?.ac_time_value || Deno.env.get("ac_time_value") ||
        "",
    },
  });

  // 调用 video 模块获取字幕
  await video.getInfo()
  const [subtitle, urlRes] = await Promise.all([
    video.getSubtitle(),
    video.get_download_url()
  ])
  // 格式化时间戳为 HH:MM:SS,MS 格式
  const data = (params.type === "0" && Array.isArray(subtitle?.body))
    ? subtitle.body.map((cur: { content: string; from: number; to: number }) => {
        const fromTime = formatTimestamp(cur.from);
        const toTime = formatTimestamp(cur.to);
        return `[${fromTime},${toTime}]${cur.content}`;
      }).join('\n')
    : subtitle;

    const audioArr = urlRes?.dash?.audio
    if (!audioArr?.length) return
    const audio = audioArr[audioArr.length - 1]
    let audioUrl = ''
    if (audio.backupUrl?.[0].indexOf('upos-sz') > 0) {
      audioUrl = audio.baseUrl
    } else {
      audioUrl = audio.backupUrl?.[0]
    }
  return {
    title: video.info.title,
    audioUrl,
    subtitle: data,
    owner: video.info.owner.name,
    tag: `${video.info.tname}-${video.info.tname_v2}`,
    desc: video.info.desc,
  };
}

app.post("/video/summary", async (c) => {
  // 获取查询参数
  const bvid = c.req.query("bvid");
  const cookie = c.req.header("cookie") || "";

  // 参数验证
  if (!bvid) {
    return createStreamResponse('error', '缺少必要参数 bvid', {});
  }

  const data = await getVideoSubtitle({ bvid, type: "0", cookie });
  if (!data) {
    return createStreamResponse('error', '获取字幕失败', {});
  }

  if (!data.subtitle) {
    return createStreamResponse('error', '视频无字幕', data);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const req = await fetch(
    "https://qwen-rethinkos.deno.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authorization": "Bearer " + Deno.env.get("OPENAI_API_KEY") || "",
      },
      body: JSON.stringify({
        model: "qwen-max-latest",
        messages: [
          {
            role: "system",
            content:
              "你是一个视频内容总结助手，请简要总结以下视频字幕内容的主要观点：",
          },
          {
            role: "user",
            content: `标题：${data.title}
作者：${data.owner}
标签：${data.tag}
简介：${data.desc}
字幕：${data.subtitle}
`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    },
  );

  const stream = new ReadableStream({
    async start(controller) {
      const created = Date.now() / 1000;
      const message = {
        id: "",
        model: "",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: { content: "", type: "", extra: {} },
          finish_reason: null,
        }],
        created,
      };

      const send = (params: {
        content?: string;
        type?: "text" | "conversation";
        extra?: Record<string, string>;
      }) => {
        message.choices[0].delta.content = params.content || "";
        message.choices[0].delta.type = params.type || "text";
        message.choices[0].delta.extra = params.extra || {};
        const data = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
        controller.enqueue(data);
      };

      const parser = createParser({
        onEvent(event) {
          try {
            if (event.data === "[DONE]") {
              const doneData = encoder.encode(`data: [DONE]\n\n`);
              controller.enqueue(doneData);
              controller.close();
              return;
            }

            const result = JSON.parse(event.data);
            const delta = result?.choices?.[0]?.delta;
            if (delta?.content) {
              send({ content: delta?.content });
            }
          } catch (err) {
            console.error("Error processing chunk:", err);
            controller.error(err);
          }
        },
      });
      send({ type: "conversation", extra: data });
      const reader = req.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          parser.feed(decoder.decode(value));
        }
      } catch (err) {
        console.error("Error reading stream:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

app.get("/video/subtitle", async (c) => {
  try {
    // 获取查询参数
    const bvid = c.req.query("bvid");
    const type = c.req.query("type") || "0"; // 0 - data为所有字幕汇总后的文本、1 - 资源原数据为对象
    const cookie = c.req.header("cookie") || "";

    // 参数验证
    if (!bvid) {
      return c.json({
        code: 400,
        message: "缺少必要参数 bvid",
      }, 400);
    }
    const data = await getVideoSubtitle({ bvid, type, cookie });

    return c.json({
      code: data?.subtitle ? 200 : 400,
      data: data?.subtitle,
    });
  } catch (error) {
    console.error("获取字幕失败:", error);
    return c.json({
      code: 500,
      message: "获取字幕失败",
    }, 500);
  }
});

app.get('/video/playurl', async (c) => {
  const bvid = c.req.query("bvid");

  const cookies = Object.fromEntries(
    (c.req.header("cookie") || "").split(";")
      .map((item) => item.trim().split("="))
      .filter((item) => item.length === 2),
  );
  const video = new Video({
    bvid,
    credential: {
      sessdata: cookies?.sessdata || Deno.env.get("sessdata") || "",
      bili_jct: cookies?.bili_jct || Deno.env.get("bili_jct") || "",
      buvid3: cookies?.buvid3 || Deno.env.get("buvid3") || "",
      dedeuserid: cookies?.dedeuserid || Deno.env.get("dedeuserid") || "",
      ac_time_value: cookies?.ac_time_value || Deno.env.get("ac_time_value") ||
        "",
    },
  });

  const data = await video.get_download_url();

  return c.json({
    code: 200,
    data
  })
})

app.post('/video/detect_text', async (c) => {
  // 从请求中获取FormData
  const formData = await c.req.formData();
  // 获取音频文件
  const audioFile = formData.get('audio');
  
  if (!audioFile || !(audioFile instanceof File)) {
    return c.json({
      code: 400,
      message: '请上传音频文件',
      data: ''
    });
  }

  // 将File对象转换为Blob格式
  const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type || 'audio/mp3' });
  const result = await uploadAudio(audioBlob);
  if (!result) return c.json({
    code: 400,
    message: '上传音频失败',
    data: ''
  })
  const taskId = await createTranscriptionTask(result)
  if (!taskId) return c.json({
    code: 400,
    message: '创建任务失败',
    data: ''
  })
  const statusRes = await pollTaskUntilComplete(taskId)

  if (statusRes.state === ResultState.ERROR || !statusRes.result) return c.json({
    code: 400,
    message: '获取字幕失败',
    data: ''
  })

  const resultData = JSON.parse(statusRes.result) as ResultData
  const data = resultData.utterances.map((item) => {
    return `[${formatTimestamp(item.start_time / 1000)},${formatTimestamp(item.end_time / 1000)}]${item.transcript}`
  }).join('\n')

  return c.json({
    code: 200,
    data
  });
})

// 创建统一的流响应函数
const createStreamResponse = (type: string, content: string, data: Record<string, any>) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const created = Date.now() / 1000;
      const baseMessage = {
        id: "",
        model: "",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: { content: "", type: "", extra: {} },
          finish_reason: null,
        }],
        created,
      };
      baseMessage.choices[0].delta.type = type;
      baseMessage.choices[0].delta.content = content;
      baseMessage.choices[0].delta.extra = data;
      // 发送初始消息
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(baseMessage)}\n\n`),
      );
      // 发送结束标记
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
};

Deno.serve({ port: 8000 }, app.fetch);
