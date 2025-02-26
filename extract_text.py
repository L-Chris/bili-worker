def parse_time(time_str):
    """将 ASS 格式的时间字符串转换为秒数"""
    h, m, s = time_str.split(':')
    seconds = float(h) * 3600 + float(m) * 60 + float(s)
    return seconds

def extract_subtitle_info(input_file, output_file):
    """从 ASS 文件中提取字幕信息并写入新文件"""
    subtitles = []
    
    # 读取 ASS 文件
    with open(input_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.startswith('Dialogue:'):
                # 分割对话行
                parts = line.strip().split(',', 9)  # 最多分割9次
                if len(parts) >= 10:
                    start_time = parts[1]
                    end_time = parts[2]
                    text = parts[9].strip()
                    subtitles.append((start_time, end_time, text))
    
    # 写入新文件
    with open(output_file, 'w', encoding='utf-8') as f:
        for start, end, text in subtitles:
            f.write(f"{start},{end},{text}\n")

# 使用示例
input_file = './output/xml.ass'
output_file = './output/xml.txt'
extract_subtitle_info(input_file, output_file)