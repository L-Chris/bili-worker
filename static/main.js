const bvid = document.getElementById('bvid')
const btn = document.getElementById('btn')
btn.addEventListener('click', () => {
    const bvidValue = bvid.value
    if (bvidValue) {
        fetch(`/video/subtitle?bvid=${bvidValue}`)
            .then(res => res.json())
            .then(data => {
                if (data.code !== 200) return
                const content = document.getElementById('content')
                content.innerHTML = data.data
            })
    }
})