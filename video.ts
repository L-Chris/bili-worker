import { aid2bvid, bvid2aid } from "./utils.ts";


class Video {
    private bvid: string = ''
    private aid: number = 0
    public info: any
    public player_info: any
    private credential: ICredential | undefined

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
            this.credential = options.credential
        } else if (options.aid) {
            this.aid = options.aid
            this.bvid = aid2bvid(this.aid)
        }
    }

    async getInfo() {
        const params = new URLSearchParams({
            aid: this.aid.toString(),
            bvid: this.bvid
        });

        const res = await fetch(`https://api.bilibili.com/x/web-interface/view?${params.toString()}`, {
            method: 'get',
        })

        const body = await res.json()

        this.info = body

        return body
    }

    async getPlayerInfo() {
        if (!this.info) await this.getInfo()

        const params = new URLSearchParams({
            aid: this.aid.toString(),
            cid: this.info.cid,
            bvid: this.bvid,
            web_location: '1315873'
        });

        const res = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${params.toString()}`, {
            method: 'get',
        })

        const body = await res.json()

        this.player_info = body

        return body
    }

    async getSubtitle(params: {
        page_index?: number
        cid?: number
        out?: string
        lan_name?: string
        lan_code?: string
    }) {
        if (!this.player_info) await this.getPlayerInfo()
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
