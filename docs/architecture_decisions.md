# 项目架构决策 (Architecture Decisions)

## 音乐搜索与下载策略 (Search & Download Strategy)

**日期**: 2026-01-20

**规则**:
1.  **搜索 (Search)**: 必须优先使用 **QQ 音乐** 的数据源。
    - 原因: QQ 音乐拥有更符合中文用户习惯的热门歌曲排行和元数据。
    - 实现: 使用 `QQMusicSource` 调用 `qq-music-api` 获取歌名、歌手、专辑等信息。

2.  **下载 (Download)**: 必须使用 **YouTube (via youtube-dl)** 作为音频源。
    - 原因: 避免版权限制，利用 YouTube 丰富的音频资源。
    - 实现: 获取到 QQ 音乐的元数据后，不直接从 QQ 下载，而是将 "歌名 + 歌手" 作为关键词在 YouTube 上搜索，并下载匹配度最高的视频音频。

**禁止**:
- 禁止尝试破解或直接使用 QQ 音乐的加密音频流下载链接（容易失效）。
- 禁止在没有搜索 QQ 音乐的情况下直接在 YouTube 上盲搜（除非用户明确指定）。
