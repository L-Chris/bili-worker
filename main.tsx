import { Hono } from "hono";
import { serveStatic } from "https://deno.land/x/hono/middleware.ts";
import { Video } from "./video.ts";
import { App } from "./app.tsx";
import { createParser } from "eventsource-parser";
import { formatTimestamp } from "./utils.ts";
import {
  createTranscriptionTask,
  FAKE_HEADERS,
  pollTaskUntilComplete,
  ResultData,
  ResultState,
  uploadAudio,
} from "./bcut.ts";
import { Credential } from "./network.ts";

const app = new Hono();

app.use("/static/*", serveStatic({ root: "./" }));

app.get("/", (c) => {
  return c.html(<App />);
});

app.post("/video/summary", async (c) => {
  // 获取查询参数
  const bvid = c.req.query("bvid");
  const cookie = c.req.header("cookie") || "";
  let videoData = {
    title: "",
    subtitle: "",
    tag: "",
    owner: "",
    desc: "",
  };

  const contentType = c.req.header("Content-Type") || "";
  let audioFile = null;

  // 只有在 Content-Type 为 multipart/form-data 时才解析 FormData
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    audioFile = formData.get("audio");
  }

  // 参数验证
  if (!bvid) {
    return createStreamResponse("error", "缺少必要参数 bvid", {});
  }

  if (audioFile) {
    const formData = await c.req.formData();
    videoData.title = formData.get("title") as string;
    videoData.desc = formData.get("desc") as string;
    videoData.tag = formData.get("tag") as string;
    videoData.owner = formData.get("owner") as string;
    videoData.desc = formData.get("desc") as string;
    const audioRes = await getAudioSubtitle(audioFile);

    if (!audioRes.data || audioRes.code !== 200) {
      return createStreamResponse("error", "解析音频失败", {});
    }
    videoData.subtitle = audioRes.data;
  } else {
    const data = await getVideoSubtitle({ bvid, type: "0", cookie });
    if (!data) {
      return createStreamResponse("error", "获取字幕失败", {});
    }

    if (!data.subtitle) {
      return createStreamResponse("error", "视频无字幕", data);
    }

    videoData = data;
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
            content: `标题：${videoData.title}
作者：${videoData.owner}
标签：${videoData.tag}
简介：${videoData.desc}
字幕：${videoData.subtitle}
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
      send({ type: "conversation", extra: videoData });
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

app.get("/video/playurl", async (c) => {
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
    data,
  });
});

app.post("/video/detect_text", async (c) => {
  // 从请求中获取FormData
  const formData = await c.req.formData();
  // 获取音频文件
  const audioFile = formData.get("audio");
  const res = await getAudioSubtitle(audioFile);
  return c.json(res);
});

app.get("/video/redirect", async(c) => {
  const credential = new Credential({
    sessdata: Deno.env.get("sessdata") || "",
    bili_jct: Deno.env.get("bili_jct") || "",
    buvid3: Deno.env.get("buvid3") || "",
    dedeuserid: Deno.env.get("dedeuserid") || "",
    ac_time_value: Deno.env.get("ac_time_value") || "",
  })
  const res = await fetch('https://cm.bilibili.com/cm/api/fees/pc/sync/v2?msg=a%7C5614%2Cb%7Cbilibili%2Cc%7C1%2Cd%7C0%2Ce%7CCMm47wQQoca%2BGBiG1M1eIKgDKAEw2O%2BsATjuK0IgMTc0MTIzMDgyMzc4NnExNzJhMjdhMTExYTM2cTkwOTFI6rLHy9YyUgblub%2Flt55aBuW5v%2BS4nGIG5Lit5Zu9aANwAHiAgICA8FiAAQGIAQCSAQwxMjEuOC4yMjcuMjegAagDqAHuA7IBIIcYSDpZS0UhRoqyQ7dyocV3Wz7Pzz07%2Bbx4QsbGLimrugH%2BA2h0dHBzOi8vd3d3LmJpbGliaWxpLmNvbS92aWRlby9CVjEzYUNGWVBFcks%2FdHJhY2tpZD13ZWJfcGVnYXN1c185LnJvdXRlci13ZWItcGVnYXN1cy0xOTUzMDI3LThmZGI3Y2Q1Zi05c2Jmbi4xNzQxMjMwODIzNzc0LjM2NCZ0cmFja19pZD1wYmFlcy52NDZXV0MxVF9rbmdPMk5xVFZvMWhQQkdncU9mMTFMZG9KNGRpYVJna0RINUZCMjNGdlBCeGdyLXRfRVIyYVN5bUVNNnFIUG80bkpwbWFDUDBoSFZjR01DOUhYVEJmUERqa1p3Ykc2QWt1QXRtUG9jMTVVSm50SkJmVUQtN0tGRXV4dG1SeHN5T2tXbzZpQkZWcENyeEpMVGlSQVRqclE1NnJ3VlpGSWJMVFlrZUVMZ1VBNXRmWkhETHNueUFvNm0mY2FpZD1fX0NBSURfXyZyZXNvdXJjZV9pZD1fX1JFU09VUkNFSURfXyZzb3VyY2VfaWQ9NTYxNCZmcm9tX3NwbWlkPV9fRlJPTVNQTUlEX18mcmVxdWVzdF9pZD0xNzQxMjMwODIzNzg2cTE3MmEyN2ExMTFhMzZxOTA5MSZjcmVhdGl2ZV9pZD0xOTg0MDQ2MTQmbGlua2VkX2NyZWF0aXZlX2lkPTE5ODQwNDYxNMIBAjQw0gEA2AHHBeABgJTr3APoAdCGA%2FABAPgBqAOAAkCIAgCSAgCYApqdkwmgAv6NAqgC%2FdQBsAI1uAIAwAIAyAKQTuoCAPgC89QBiAMKkgMAqAMAsAMAuAMAyAMA0gPNAXsiMSI6IjE5ODQwNDYxNCIsIjExIjoiMjMxIiwiMTIiOiI1NjE0IiwiMTMiOiIyNDAyNTg2IiwiMTQiOiI5OTMiLCIxNSI6IjEwMDEiLCIxNiI6IjI0MDI1ODZfMjcyNTEiLCIyIjoiMjgzMjM0NCIsIjI0IjoiMSIsIjMiOiIyODMyMzQ0IiwiNCI6IjAiLCI1IjoiMCIsIjYiOiIyODMyMzQ0IiwiNyI6IjExMzcxMTM4OTg3MzAwMSIsIjgiOiIxODAzMzg4ODczIn3gAwDoAwDwAwD6AwVvdGhlcoIECW51bGw6bnVsbIgEqAOQBACgBACqBAcIueW1EBAEuAQKwAQJ0AQA2AQA4gSzATU2LnsicHNJZCI6NDQ3NzQsInYyIjoiWXY4NVdRY1dWZ3AyWVJRVGNvVjlwaFJMMEJXalZDZkU4Rm5JdkJ4ZXdNOEVjMHUzR0Ytb0dYZ2JuUDlvWkNCSkdTZGZTZGxwSGJqTUEzTEtPaHRKcHZsV3NnMkRwUExrTEEifTs2My57InBzSWQiOjM4NzAwLCJ2MiI6IlNnIn07NzAueyJwc0lkIjoyODM0MiwidjIiOiJBZyJ96AQA8AQA%2BgTwBXsiYWNjZWxlcmF0ZV9mYWN0b3IiOjEuMCwiYWNjZWxlcmF0ZV9pZCI6MCwiYWRfdHlwZV9maXgiOiJjcG0iLCJhZHZ2X2luZm8iOiJ7XCJhZGp1c3RfYmVmb3JlX2Nvc3RcIjpcIjQyNC40MTdcIixcImFkanVzdF9yYXRpb1wiOlwiMS4wMDBcIixcImJhbGFuY2VyX2lkXCI6MCxcImJhbGFuY2VyX3JhdGlvXCI6XCIwLjAwMFwiLFwiY2hhcmdlX2V4cF9rZXlfZGVwdGhcIjpcIlwiLFwiY2hhcmdlX2V4cF9rZXlfbGlnaHRcIjpcIl9mbHlfY3BhX29ubGluZV9jaGFyZ2U5XCIsXCJjb3N0X2RpZmZcIjpcIjAuMDAwXCJ9IiwiYml6X3R5cGUiOjMsImJpel90eXBlX2ZpeCI6MywiYm9vc3RfaW5mbyI6IntcImJpZFwiOjQyNCxcImJvb3N0X2JpZFwiOjAsXCJjb3N0XCI6MTMzLjQ5OTQyMDE2NjAxNTYzLFwiaWRcIjoxMDAwMSxcIm9yaV9iaWRcIjo0MjQsXCJzY29yZVwiOlwiMS40MFwifSIsImNwYSI6IntcImNwYV9sZXZlbFwiOjIsXCJjcGFfc2V0XCI6MTB9IiwiY3BhVGFyZ2V0VHlwZSI6OSwiZnJvbVRyYWNraWQiOiJ3ZWJfcGVnYXN1c185LnJvdXRlci13ZWItcGVnYXN1cy0xOTUzMDI3LThmZGI3Y2Q1Zi05c2Jmbi4xNzQxMjMwODIzNzc0LjM2NCIsImlubmVyIjowLCJtaW5pX2dhbWVfaWQiOiIiLCJtb2RlbFNjb3JlIjoie1wiY3RyXCI6XCI0OTQuMTUxOTc4XCIsXCJmaW5hbF9wY3RyXCI6XCI0OTQuMTUxOTc4XCIsXCJmaW5hbF9wY3ZyXCI6XCIxMDAwMC4wMDAwMDBcIn0iLCJ2aWRlb191cF9taWQiOjE4MDMzODg4NzN9gAUAkAUokAUzkAVDkAVIkAVJkAVykAWMAZAFswGQBbQBkAXQAZAF0QGQBdcBkAXYAZAFiQKQBY4CkAWaApAFqQKQBaoCkAXAApAFwgKQBcMCkAXFApAFywKQBc4CkAXTApAF1gKQBdcCkAXYApAF2QKQBdoCkAXbApAF3wKQBeECkAXjApAF5AKQBeUCkAXmApAF8AKQBfUCkAX7ApAF%2FwKQBY0DkAWUA5AFmAOQBZkDkAWaA5AFmwOQBaADkAWlA5AFpwOQBawDkAWwA5AFtgOQBbcDkAXAA5AFwQOQBc0DkAXgA5AF8wOQBfUDkAX4A5AF%2FwOQBbQEkAXdBJAFxgWQBY8GkAWmBpAF4QaQBZMHoAXppoD4t%2B0ZuAUJwAWa0pIByAUH4AUB%2Cf%7Cclick_sync_3%2Cg%7C1%2Ch%7C1%2Ci%7C383432060%2Cj%7C%2Ck%7C1741230807387%2Cl%7C5636%2Cm%7C1741230807237%2Cn%7C1%2Co%7C0%2Cp%7Cad_card&ts=1741230807387&spm_id_from=333.1007.tianma.3-2-6.click', {
    method: 'HEAD',
    headers: {
      ...FAKE_HEADERS,
      cookie: Object.entries(credential.getCookies() || {})
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
    }
  })

  return c.json({
    code: 200,
    data: res.headers.get('Location'),
  })
})

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
  await video.getInfo();
  const [subtitle, urlRes] = await Promise.all([
    video.getSubtitle(),
    video.get_download_url(),
  ]);
  // 格式化时间戳为 HH:MM:SS,MS 格式
  let data = "";
  if (params.type === "0" && Array.isArray(subtitle?.body)) {
    const hasHours = subtitle.body.some((item) => item.to >= 3600);
    data = subtitle.body.map(
      (cur: { content: string; from: number; to: number }) => {
        // 检查是否有超过一小时的时间戳
        const fromTime = formatTimestamp(cur.from, hasHours);
        const toTime = formatTimestamp(cur.to, hasHours);
        return `[${fromTime},${toTime}]${cur.content}`;
      },
    ).join("\n");
  } else {
    data = subtitle;
  }

  const audioArr = urlRes?.dash?.audio;
  if (!audioArr?.length) return;
  const audio = audioArr[audioArr.length - 1];
  let audioUrl = "";
  if (audio.backupUrl?.[0].indexOf("upos-sz") > 0) {
    audioUrl = audio.baseUrl;
  } else {
    audioUrl = audio.backupUrl?.[0];
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

async function getAudioSubtitle(audioFile: any) {
  if (!audioFile || !(audioFile instanceof File)) {
    return {
      code: 400,
      message: "请上传音频文件",
      data: "",
    };
  }

  // 将File对象转换为Blob格式
  const audioBlob = new Blob([await audioFile.arrayBuffer()], {
    type: audioFile.type || "audio/mp3",
  });
  const result = await uploadAudio(audioBlob);
  if (!result) {
    return {
      code: 400,
      message: "上传音频失败",
      data: "",
    };
  }
  const taskId = await createTranscriptionTask(result);
  if (!taskId) {
    return {
      code: 400,
      message: "创建任务失败",
      data: "",
    };
  }
  const statusRes = await pollTaskUntilComplete(taskId);

  if (statusRes.state === ResultState.ERROR || !statusRes.result) {
    return {
      code: 400,
      message: "获取字幕失败",
      data: "",
    };
  }

  const resultData = JSON.parse(statusRes.result) as ResultData;

  // 检查是否有超过一小时的时间戳
  const hasHours = resultData.utterances.some((item) =>
    item.end_time / 1000 >= 3600
  );

  const data = resultData.utterances.map((item) => {
    return `[${formatTimestamp(item.start_time / 1000, hasHours)},${
      formatTimestamp(item.end_time / 1000, hasHours)
    }]${item.transcript}`;
  }).join("\n");

  return {
    data,
    code: 200,
    message: "",
  };
}

// 创建统一的流响应函数
const createStreamResponse = (
  type: string,
  content: string,
  data: Record<string, any>,
) => {
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
