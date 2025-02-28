import { Api, Credential } from "./network.ts";
import { aid2bvid, bvid2aid } from "./utils.ts";
import videoApi from "./api/video.json" with { type: "json" };


class Video {
    private bvid: string = ''
    private aid: number = 0
    public info: any
    public player_info: any
    private credential: Credential | undefined

    constructor(options: {
        bvid?: string
        aid?: number
        credential?: ICredential
    } | string) {
        if (typeof options === 'string') {
            this.bvid = options
            this.aid = bvid2aid(this.bvid)
        } else if (options.bvid) {
            this.bvid = options.bvid
            this.aid = bvid2aid(this.bvid)
            if (options.credential) {
                this.credential = new Credential(options.credential)
            }
        } else if (options.aid) {
            this.aid = options.aid
            this.bvid = aid2bvid(this.aid)
            if (options.credential) {
                this.credential = new Credential(options.credential)
            }
        }
    }

    async getInfo() {
        const api = new Api({
            ...videoApi.info.info,
            params: {
                aid: this.aid,
                bvid: this.bvid
            },
            credential: this.credential
        });

        const body = await api.request();
        this.info = body;
        return body;
    }

    async getPlayerInfo(params?: {
        cid?: string
        epid?: string
    }) {
        if (!this.info) await this.getInfo();

        const cid = params?.cid || this.info.cid

        const requestParams = {
            aid: this.aid,
            cid,
            bvid: this.bvid,
            web_location: '1315873'
        } as Record<string, any>

        if (params?.epid) {
            requestParams.epid = params.epid
        }

        const api = new Api({
            ...videoApi.info.get_player_info,
            params: requestParams,
            credential: this.credential
        });

        const body = await api.request();
        this.player_info = body;
        return body;
    }

    async getSubtitle(params: {
        page_index?: number
        cid?: number
        lan_name?: string
        lan_code?: string
    } = {}) {
        if (!this.player_info) await this.getPlayerInfo();
        const lan_name = params.lan_name || '中文（自动生成）'
        const lan_code = params.lan_code || 'ai-zh'

        // 从 player_info 中获取字幕信息
        const subtitles = this.player_info?.subtitle?.subtitles || [];
        
        // 如果没有字幕，返回空数组
        if (subtitles.length === 0) return

        // 根据语言代码查找字幕
        const targetSubtitle = params.lan_code ? 
            subtitles.find((sub: any) => sub.lan_doc === lan_name || sub.lan === lan_code) : 
            subtitles[0];

        if (!targetSubtitle?.subtitle_url) return

        // 获取字幕内容
        const subtitle_url = /^https:/.test(targetSubtitle?.subtitle_url) ? `https:${targetSubtitle?.subtitle_url}` : targetSubtitle.subtitle_url
        const api = new Api({
            url: subtitle_url,
            method: 'GET',
            credential: this.credential
        })

        const subtitleData = await api.request({ raw: true });
        return subtitleData;
    }
}


interface ICredential {
    sessdata: string
    bili_jct: string
    buvid3: string
    dedeuserid: string
    ac_time_value: string
}

export {
    Video
}
