# oubo / GEO Content Ops

GEO Content Ops 是一个面向客户内容运营的管理工具，支持客户管理、关键词管理、知识库上传、提示词模板、生成任务和文章审稿。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- 本地文件数据存储

## 本地启动

```bash
npm install
npm run dev
```

默认访问：

```txt
http://localhost:3001
```

## 生产构建

```bash
npm run build
npm run start
```

生产环境建议设置：

```bash
DATA_SECRET='一串足够长的随机密钥'
```

`DATA_SECRET` 用于加密模型 API Key，上线后不要随意更换。

## 数据存储

当前项目使用本地文件保存业务数据：

- `data/db.json`：用户、客户、关键词、提示词、任务、文章、模型配置
- `data/uploads`：上传的知识库文件

这些数据不会提交到 GitHub。部署时需要在服务器上持久化并定期备份 `data` 目录。

## 部署

普通服务器部署说明见：

```txt
DEPLOY.md
```

推荐组合：

- Node.js 20 或 22
- PM2
- Nginx
- HTTPS
