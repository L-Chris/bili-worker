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
