const bvid = document.getElementById('bvid')
const btn = document.getElementById('btn')
const copyBtn = document.getElementById('copy')
const content = document.getElementById('content')

btn.addEventListener('click', () => {
    const bvidValue = bvid.value
    if (bvidValue) {
        fetch(`/video/subtitle?bvid=${bvidValue}`)
            .then(res => res.json())
            .then(data => {
                if (data.code !== 200) return
                content.innerHTML = data.data
            })
    }
})

copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(content.textContent)
        .then(() => {
            alert('内容已复制到剪贴板！');
        })
})