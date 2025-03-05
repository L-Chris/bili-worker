const API_BASE_URL = "https://member.bilibili.com/x/bcut/rubick-interface"

const FAKE_HEADERS = {
    // "Origin": "https://member.bilibili.com",
    // "Referer": "https://member.bilibili.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Cache-Control": "no-cache"
}

export async function uploadAudio (file: Blob): Promise<string> {
  // 1. 创建资源
  const createResp = await fetch(
    `${API_BASE_URL}/resource/create`,
    {
      method: 'POST',
      headers: {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `BV1rXNme6E96.mp3`,
        type: 2,
        size: file.size,
        ResourceFileType: 'mp3',
        model_id: '7'
      })
    }
  )
  const createBody = await await createResp.json()
  const createData: ResourceCreateResponse = createBody.data

  // 2. 分片上传
  const etags: string[] = []
  const uploadPromises = createData.upload_urls.map(async (url, index) => {
    const start = index * createData.per_size
    const end = Math.min(start + createData.per_size, file.size)
    const chunk = file.slice(start, end)

    const res = await fetch(url, {
      method: 'PUT',
      body: chunk,
      headers: FAKE_HEADERS
    })

    const etag = res.headers.get('etag')
    if (etag) {
      etags[index] = etag
    }
  })
  await Promise.all(uploadPromises)

  // 3. 完成上传
  const completeResp = await fetch(
    `${API_BASE_URL}/resource/create/complete`,
    {
      method: 'POST',
      headers: {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        InBossKey: createData.in_boss_key,
        ResourceId: createData.resource_id,
        etags: etags.filter(_ => _).join(','),
        UploadId: createData.upload_id,
        model_id: '7'
      })
    }
  )
  const completeBody = await completeResp.json()
  const completeData: ResourceCompleteResponse = completeBody.data

  return completeData.download_url
}

export async function createTranscriptionTask (resource: string): Promise<string> {
  const resp = await fetch(`${API_BASE_URL}/task`, {
    method: 'POST',
    headers: {
      ...FAKE_HEADERS,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      resource: resource,
      model_id: '7'
    })
  })
  const taskRes = await resp.json()
  const data: TaskCreateResponse = taskRes.data
  return data.task_id
}

export async function checkTaskStatus (taskId: string): Promise<ResultResponse> {
  const resp = await fetch(
    `${API_BASE_URL}/task/result?task_id=${taskId}&model_id=7`,
    {
      method: 'GET',
      headers: FAKE_HEADERS
    }
  )
  const res = await resp.json()
  return res.data
}
/**
 * 轮询任务状态直到完成或失败
 * @param taskId 任务ID
 * @param interval 轮询间隔(毫秒)，默认1000ms
 * @param maxAttempts 最大尝试次数，默认60次
 * @returns 任务最终结果
 */
export async function pollTaskUntilComplete(
  taskId: string,
  interval: number = 5000,
  maxAttempts: number = 60
): Promise<ResultResponse> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await checkTaskStatus(taskId);
    
    // 任务完成或失败时返回结果
    if (result.state === ResultState.COMPLETE || 
        result.state === ResultState.ERROR) {
      return result;
    }
    
    // 等待指定时间后继续下一次轮询
    await new Promise(resolve => setTimeout(resolve, interval));
    attempts++;
  }

  throw new Error(`轮询任务超时: ${taskId}`);
}


interface ResourceCreateResponse {
  resource_id: string
  title: string
  type: number
  in_boss_key: string
  size: number
  upload_urls: string[]
  upload_id: string
  per_size: number
}

interface ResourceCompleteResponse {
  resource_id: string
  download_url: string
}

interface TaskCreateResponse {
  resource: string
  result: string
  task_id: string
}

export enum ResultState {
  STOP = 0,
  RUNNING = 1,
  ERROR = 3,
  COMPLETE = 4
}

interface ResultResponse {
  task_id: string
  result: string
  remark: string
  state: ResultState
}

export interface ResultData {
  statusCode: number
  version: string
  utterances: {
    end_time: number
    music: number
    punc: number
    start_time: number
    transcript: string
    words: { start_time: number; end_time: number; label: string }[]
  }[]
}
