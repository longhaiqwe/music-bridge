# MusicBridge 部署指南

## 🚀 部署到 Render（推荐）

### 为什么选择 Render？
- ✅ 支持 Docker
- ✅ 美国节点，可访问 YouTube
- ✅ 自动从 GitHub 部署
- ⚠️ 免费版会休眠，Starter 方案 $7/月

### 部署步骤

#### 1. 推送代码到 GitHub

```bash
cd /Users/longhai/Code/music/music-bridge
git add .
git commit -m "Add cloud deployment support"
git push origin main
```

#### 2. 在 Render 创建服务

1. 访问 https://render.com 并登录
2. 点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库
4. 选择 `music-bridge` 仓库
5. Render 会自动检测 `Dockerfile`

#### 3. 配置环境变量

在 Render Dashboard 的 Environment 页面添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NETEASE_COOKIES` | 你的网易云 Cookie | 从本地 `cookie.json` 复制 |
| `YOUTUBE_COOKIE_FILE` | YouTube cookies 文件路径（推荐） | 例如 `/app/cookies.txt` |
| `YOUTUBE_COOKIES` | YouTube Cookie（回退） | JSON 格式 |
| `YOUTUBE_COOKIES_FROM_BROWSER` | 是否允许回退到浏览器 cookies | 默认 `true`，建议生产设为 `false` |
| `YOUTUBE_COOKIES_BROWSER` | 浏览器类型 | 默认 `chrome` |
| `YOUTUBE_EXTRACTOR_ARGS` | 传给 yt-dlp 的 extractor args（可选） | 用于 PO Token / player client |
| `YTDLP_SLEEP_REQUESTS` | yt-dlp 请求间隔（可选） | 例如 `2` |
| `YTDLP_MIN_SLEEP_INTERVAL` | 下载间隔下限（可选） | 例如 `5` |
| `YTDLP_MAX_SLEEP_INTERVAL` | 下载间隔上限（可选） | 例如 `10` |

**获取网易云 Cookie：**
```bash
# 在本地运行项目，扫码登录后，查看 cookie.json
cat cookie.json
# 复制 "cookie" 字段的值
```

#### 4. 部署完成后

- Render 会给你一个 URL，如 `https://music-bridge-xxx.onrender.com`
- 在手机浏览器打开这个 URL 即可使用

---

## 📱 手机使用

1. 在手机浏览器保存网址：`https://你的域名.onrender.com`
2. 打开页面，直接使用歌手同步或单曲搜索功能
3. 歌曲会自动上传到你的网易云云盘

---

## ⚠️ 注意事项

### Cookie 过期问题

网易云 Cookie 有时效性，如果发现上传失败：
1. 在本地重新运行项目并扫码登录
2. 复制新的 Cookie 到 Render 环境变量
3. 重新部署

### YouTube 下载稳定性建议

推荐优先级：
1. 提供专用 `cookies.txt`，并通过 `YOUTUBE_COOKIE_FILE` 指向它
2. 如仍被 YouTube 拦截，再配置 `YOUTUBE_EXTRACTOR_ARGS` 给 yt-dlp 传入 YouTube 的 extractor args（例如 PO Token provider）
3. `--cookies-from-browser` 仅作为兜底，不建议长期依赖日常浏览器会话

如果你在本地导出 `cookies.txt`，建议使用单独的浏览器会话或无痕窗口，导出后不要继续在同一会话里打开 YouTube。

本地可以直接使用：

```bash
npm run youtube:cookies:export
npm run youtube:cookies:check
npm run youtube:pot:install
npm run youtube:pot:server
npm run youtube:pot:doctor
```

`youtube:cookies:*`、`youtube:pot:doctor` 以及应用里的 YouTube 下载链路会自动拉起本地 `bgutil` server；`youtube:pot:server` 更适合需要单独查看 provider 日志时使用。

### 成本

| 方案 | 价格 | 特点 |
|------|------|------|
| Free | $0 | 15分钟无访问会休眠，唤醒需 30 秒 |
| Starter | $7/月 | 不休眠，推荐 |

---

## 🔧 本地开发

```bash
# 安装依赖
npm install

# 运行开发服务器
npm run dev

# 访问 http://localhost:3000
```

## 📦 依赖

- Node.js 20+
- ffmpeg
- yt-dlp
- Python 3 (yt-dlp 依赖)
