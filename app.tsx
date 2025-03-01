import jsx from 'hono/jsx'
// 前端组件（Islands）
export function App() {
  return (
    <html>
      <body>
        <div>
          <input id="bvid" type="text" />
          <button id="btn" type="button">获取字幕</button>
        </div>
        <div id="content"></div>
        <script src="/static/main.js"></script>
      </body>
    </html>
  )
}