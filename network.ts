import { crypto } from "https://deno.land/std/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std/encoding/hex.ts";

/**
 * 凭据类，用
 * 于各种请求操作的验证
 */
export class Credential {
    private sessdata: string | null;
    private bili_jct: string | null;
    private buvid3: string | null;
    private dedeuserid: string | null;
    private ac_time_value: string | null;

    /**
     * 各字段获取方式查看：https://nemo2011.github.io/bilibili-api/#/get-credential.md
     * 
     * @param sessdata 浏览器 Cookies 中的 SESSDATA 字段值
     * @param bili_jct 浏览器 Cookies 中的 bili_jct 字段值
     * @param buvid3 浏览器 Cookies 中的 BUVID3 字段值
     * @param dedeuserid 浏览器 Cookies 中的 DedeUserID 字段值
     * @param ac_time_value 浏览器 Cookies 中的 ac_time_value 字段值
     */
    constructor({
        sessdata = null,
        bili_jct = null,
        buvid3 = null,
        dedeuserid = null,
        ac_time_value = null,
    }: {
        sessdata?: string | null;
        bili_jct?: string | null;
        buvid3?: string | null;
        dedeuserid?: string | null;
        ac_time_value?: string | null;
    }) {
        this.sessdata = sessdata 
            ? (sessdata.includes('%') ? sessdata : encodeURIComponent(sessdata))
            : null;
        this.bili_jct = bili_jct;
        this.buvid3 = buvid3;
        this.dedeuserid = dedeuserid;
        this.ac_time_value = ac_time_value;
    }

    /**
     * 获取请求 Cookies 字典
     * @returns 请求 Cookies 字典
     */
    getCookies(): Record<string, string> {
        const cookies: Record<string, string> = {
            "SESSDATA": this.sessdata || "",
            "buvid3": this.buvid3 || "",
            "bili_jct": this.bili_jct || "",
            "ac_time_value": this.ac_time_value || "",
        };

        if (this.dedeuserid) {
            cookies["DedeUserID"] = this.dedeuserid;
        }

        return cookies;
    }
}

/**
 * 请求配置接口
 */
interface RequestConfig {
    method: string;
    url: string;
    params?: Record<string, any>;
    data?: Record<string, any> | string;
    files?: Record<string, any>;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
}

// wbi 加密用的常量
const OE = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

// 添加 APP 相关常量
const APPKEY = "1d8b6e7d45233436";
const APPSEC = "560c52ccd288fed045859ed18bffd973";

/**
 * 获取导航数据
 */
async function getNav(credential?: Credential): Promise<any> {
    const api = new Api({
        url: 'https://api.bilibili.com/x/web-interface/nav',
        method: 'GET',
        credential: credential
    });
    return await api.request();
}

/**
 * 获取 wbi 混合密钥
 */
async function getMixinKey(credential?: Credential): Promise<string> {
    const data = await getNav(credential);
    const wbiImg = data.wbi_img;

    const split = (key: string) => {
        const parts = wbiImg[key].split('/');
        return parts[parts.length - 1].split('.')[0];
    };

    const ae = split('img_url') + split('sub_url');
    const le = OE.reduce((s, i) => s + (ae[i] || ''), '');
    return le.slice(0, 32);
}

/**
 * wbi 加密
 */
function encWbi(params: Record<string, any>, mixinKey: string): Record<string, any> {
    // 创建新的参数对象
    const newParams = { ...params };
    delete newParams.w_rid;  // 重试时先把原有 w_rid 去除
    
    // 添加时间戳
    newParams.wts = Math.floor(Date.now() / 1000);
    
    // 添加 web_location
    if (!newParams.web_location) {
        newParams.web_location = 1550101;
    }

    // 对参数进行排序和编码
    const sortedParams = Object.entries(newParams).sort(([a], [b]) => a.localeCompare(b));
    const queryString = new URLSearchParams(
        sortedParams.map(([k, v]) => [k, String(v)])
    ).toString();

    // 计算 w_rid
    newParams.w_rid = md5(queryString + mixinKey);
    
    return newParams;
}

/**
 * wbi2 加密
 */
function encWbi2(params: Record<string, any>): Record<string, any> {
    const dmRand = "ABCDEFGHIJK";
    const getRandomStr = () => {
        const chars = [...dmRand];
        return Array.from({ length: 2 }, () => 
            chars.splice(Math.floor(Math.random() * chars.length), 1)[0]
        ).join('');
    };

    return {
        ...params,
        dm_img_list: "[]",
        dm_img_str: getRandomStr(),
        dm_cover_img_str: getRandomStr(),
        dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}'
    };
}

/**
 * APP 签名加密
 */
function encSign(params: Record<string, any>): Record<string, any> {
    const newParams = {
        ...params,
        appkey: APPKEY
    };
    
    // 参数排序
    const sortedParams = Object.fromEntries(
        Object.entries(newParams).sort(([a], [b]) => a.localeCompare(b))
    );
    
    // 生成查询字符串
    const queryString = new URLSearchParams(
        Object.entries(sortedParams).map(([k, v]) => [k, String(v)])
    ).toString();
    
    // 计算签名
    sortedParams.sign = md5(queryString + APPSEC);
    
    return sortedParams;
}

/**
 * 用于请求的 Api 类
 */
export class Api {
    private url: string;
    private method: string;
    private comment: string;
    private wbi: boolean;
    private wbi2: boolean;
    private biliTicket: boolean;
    private verify: boolean;
    private noCsrf: boolean;
    private jsonBody: boolean;
    private ignoreCode: boolean;
    private sign: boolean;
    private data: Record<string, any>;
    private params: Record<string, any>;
    private files: Record<string, any>;
    private headers: Record<string, any>;
    private credential: Credential;

    /**
     * @param options Api 配置选项
     */
    constructor(options: {
        url: string;
        method: string;
        comment?: string;
        wbi?: boolean;
        wbi2?: boolean;
        biliTicket?: boolean;
        verify?: boolean;
        noCsrf?: boolean;
        jsonBody?: boolean;
        ignoreCode?: boolean;
        sign?: boolean;
        data?: Record<string, any>;
        params?: Record<string, any>;
        files?: Record<string, any>;
        headers?: Record<string, any>;
        credential?: Credential;
    }) {
        this.url = options.url;
        this.method = options.method.toUpperCase();
        this.comment = options.comment || "";
        this.wbi = options.wbi || false;
        this.wbi2 = options.wbi2 || false;
        this.biliTicket = options.biliTicket || false;
        this.verify = options.verify || false;
        this.noCsrf = options.noCsrf || false;
        this.jsonBody = options.jsonBody || false;
        this.ignoreCode = options.ignoreCode || false;
        this.sign = options.sign || false;
        
        this.data = options.data || {};
        this.params = options.params || {};
        this.files = options.files || {};
        this.headers = options.headers || {};
        this.credential = options.credential || new Credential({});
    }

    /**
     * 准备请求配置
     */
    private async prepareRequest(): Promise<RequestConfig> {
        // 处理布尔值
        const newParams: Record<string, any> = {};
        const newData: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(this.params)) {
            if (typeof value === 'boolean') {
                newParams[key] = Number(value);
            } else if (value != null) {
                newParams[key] = value;
            }
        }
        
        for (const [key, value] of Object.entries(this.data)) {
            if (typeof value === 'boolean') {
                newData[key] = Number(value);
            } else if (value != null) {
                newData[key] = value;
            }
        }
        
        this.params = newParams;
        this.data = newData;

        // 验证凭据
        if (this.verify && !this.credential.getCookies().SESSDATA) {
            throw new Error("该接口需要 SESSDATA");
        }

        // 非 GET 请求且需要 CSRF 时验证 bili_jct
        if (this.method !== "GET" && !this.noCsrf && !this.credential.getCookies().bili_jct) {
            throw new Error("该接口需要 bili_jct");
        }

        if (this.params.jsonp === 'jsonp') {
            this.params.callback = 'callback'
        }

        // 处理 cookies
        const cookies = this.credential.getCookies();
        cookies["opus-goback"] = "1";

        // 添加 wbi2 加密
        if (this.wbi2) {
            this.params = encWbi2(this.params);
        }

        // 添加 wbi 加密
        if (this.wbi) {
            const mixinKey = await getMixinKey(this.credential);
            this.params = encWbi(this.params, mixinKey);
        }

        if (this.biliTicket) {
            // todo
            cookies.bili_ticket_expires = String(Math.floor(Date.now() / 1000) + 2 * 86400);
        }

        // APP 鉴权
        if (this.sign) {
            if (this.method in ["POST", "DELETE", "PATCH"]) {
                this.data = encSign(this.data);
            } else {
                this.params = encSign(this.params);
            }
        }

        // 构建配置
        const config: RequestConfig = {
            method: this.method,
            url: this.url,
            params: this.params,
            data: this.data,
            files: this.files,
            cookies,
            headers: Object.keys(this.headers).length === 0 ? DEFAULT_HEADERS : this.headers
        };

        // JSON body
        if (this.jsonBody) {
            config.headers = {
                ...config.headers,
                'Content-Type': 'application/json'
            };
            config.data = JSON.stringify(config.data);
        }

        return config;
    }

    /**
     * 处理响应
     */
    private async processResponse(response: Response, raw = false): Promise<any> {
        // 检查响应长度
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) === 0) {
            return null;
        }

        const respData = await response.json();

        console.log(respData)

        if (raw) {
            return respData;
        }

        // 检查状态
        const ok = respData.OK;
        if (!this.ignoreCode) {
            if (ok === undefined) {
                const code = respData.code;
                if (code === undefined) {
                    throw new Error("API 返回数据未含 code 字段");
                }
                if (code !== 0) {
                    const msg = respData.msg || respData.message || "接口未返回错误信息";
                    throw new Error(`${code}: ${msg}`);
                }
            } else if (ok !== 1) {
                throw new Error("API 返回数据 OK 不为 1");
            }
        }

        // 提取数据
        let realData = respData;
        if (ok === undefined) {
            realData = respData.data ?? respData.result;
        }
        return realData;
    }

    /**
     * 发送请求
     */
    async request(options: { raw?: boolean; byte?: boolean } = {}): Promise<any> {
        const { raw = false, byte = false } = options;
        
        const config = await this.prepareRequest();
        const url = new URL(config.url);
        
        // 添加查询参数
        if (config.params) {
            Object.entries(config.params).forEach(([key, value]) => {
                url.searchParams.append(key, String(value));
            });
        }

        try {
            let body
            if (!['GET', 'HEAD'].includes(config.method)) {
                body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data)
            }

            const response = await fetch(url.toString(), {
                method: config.method,
                headers: {
                    ...config.headers,
                    Cookie: Object.entries(config.cookies || {})
                        .map(([key, value]) => `${key}=${value}`)
                        .join('; ')
                },
                ...(config.data ? { body } : {})
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (byte) {
                return await response.arrayBuffer();
            }

            return this.processResponse(response, raw);
            
        } catch (error) {
            console.error('请求失败:', error);
            throw error;
        }
    }
}

// 默认请求头
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://www.bilibili.com'
};

/**
 * MD5 工具函数
 */
function md5(str: string): string {
    const hash = new Uint8Array(
        crypto.subtle.digestSync(
            "MD5",
            new TextEncoder().encode(str)
        )
    );
    return encodeHex(hash);
}
