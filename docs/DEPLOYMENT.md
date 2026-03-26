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
| `YOUTUBE_COOKIES_FROM_BROWSER` | 是否启用浏览器 cookies | 默认 `true` |
| `YOUTUBE_COOKIES_BROWSER` | 浏览器类型或 profile | 例如 `chrome:Profile 2` |
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

当前项目只保留 `--cookies-from-browser` 方案，不再支持 `cookies.txt` / `YOUTUBE_COOKIES`。

推荐做法：
1. 在本机桌面环境里登录目标浏览器 profile
2. 配置 `YOUTUBE_COOKIES_BROWSER` 指向该 profile
3. 如仍被 YouTube 拦截，再配置 `YOUTUBE_EXTRACTOR_ARGS` 给 yt-dlp 传入 YouTube 的 extractor args（例如 PO Token provider）

本地可以直接使用：

```bash
npm run youtube:pot:install
npm run youtube:pot:server
npm run youtube:pot:doctor
```

`youtube:pot:doctor` 以及应用里的 YouTube 下载链路会自动拉起本地 `bgutil` server；`youtube:pot:server` 更适合需要单独查看 provider 日志时使用。

注意：云端容器通常没有可复用的桌面浏览器 profile，因此 browser-based YouTube auth 更适合本地桌面运行环境。

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
