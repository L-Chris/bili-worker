import { Hono } from "hono";
import { serveStatic } from "https://deno.land/x/hono/middleware.ts";
import { Video } from "./video.ts";
import { App } from "./app.tsx";
import { createParser } from "eventsource-parser";

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
  const subtitle = await video.getSubtitle();
  const data = (params.type === "0" && Array.isArray(subtitle?.body))
    ? subtitle.body.reduce(
      (pre: string, cur: { content: string }) => pre + cur.content,
      "",
    )
    : subtitle;
  return {
    title: video.info.title,
    subtitle: data,
    owner: video.info.owner.name,
  };
}

app.post("/video/summary", async (c) => {
  // 获取查询参数
  const bvid = c.req.query("bvid");
  const cookie = c.req.header("cookie") || "";

  // 参数验证
  if (!bvid) {
    return c.json({
      code: 400,
      message: "缺少必要参数 bvid",
    }, 400);
  }

  const data = await getVideoSubtitle({ bvid, type: "0", cookie });
  if (!data) {
    return c.json({
      code: "400",
      message: "获取字幕失败",
    });
  }

  if (!data.subtitle) {
    return c.json({
      code: "200",
      message: "视频无字幕",
      data,
    });
  }

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
            content: data.subtitle,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    },
  );

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
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
        type?: 'text' | 'conversation'
        extra?: Record<string, string>
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
      send({ type: 'conversation', extra: data })
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

Deno.serve({ port: 8000 }, app.fetch);
