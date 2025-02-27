import { aid2bvid, bvid2aid } from "./utils.ts";

class Video {
    private bvid: string = ''
    private aid: number = 0

    constructor(options: {
        bvid?: string
        aid?: number
    } | string) {
        if (typeof options === 'string') {
            this.bvid = options
            this.aid = bvid2aid(this.bvid)
        } else if (options.bvid) {
            this.bvid = options.bvid
            this.aid = bvid2aid(this.bvid)
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

        return res.json()
    }
}

export {
    Video
}