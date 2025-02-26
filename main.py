from bilibili_api import Credential, sync, video, ass

credential = Credential(
    sessdata="4b0dd0a9%2C1756010699%2C2a405%2A22CjD3F40ig9s7PJ69L6cfdtYSYm6oKw8X3iDrXvUMwEkm73XOMGuV26bXt1ywFB5BI6kSVkVYTnppX2pxemlSRzRVR0lNSC1id3RRVjhSRHFCeEI2SnNHa1VMWXM2STdjZWdGTFB2UzUyeThBRzltUXhnb1p1NV9UaTY2dVdULXA4b3FGRFdDY2tRIIEC",
    bili_jct="402ba2d89be801abb036d418828393cf",
    buvid3="0C0F3AF2-9918-5E7B-CF1B-934B62E67ABD75593infoc",
    dedeuserid="383432060",
    ac_time_value="b55b1c2beacf0a5bb81848f0fc683722"
)

v = video.Video('BV1zWPseMEGT')

sync(ass.make_ass_file_subtitle(
    obj=v, # 生成弹幕文件的对象
    page_index=0, # 哪一个分 P (从 0 开始)
    out="output/xml.ass", # 输出文件地址
    credential=credential,
))