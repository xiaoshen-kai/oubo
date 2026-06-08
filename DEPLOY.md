# 部署说明

这个项目是 Next.js 应用，适合部署到单台 Linux 服务器。推荐组合：

- Node.js 20 或 22
- PM2
- Nginx
- HTTPS 证书，例如 Certbot

## 1. 上传项目

把项目上传到服务器，例如：

```bash
/opt/geo-tool
```

进入项目目录：

```bash
cd /opt/geo-tool
```

## 2. 安装依赖

```bash
npm install
```

## 3. 配置环境变量

生产环境必须设置 `DATA_SECRET`，用于加密模型 API Key。

```bash
export DATA_SECRET='换成一串足够长的随机密钥'
```

注意：`DATA_SECRET` 一旦用于生产环境，不要随意更换。更换后，已保存的模型 API Key 可能无法解密。

## 4. 构建

```bash
npm run build
```

构建产物会写入 `.next-build`。

## 5. 用 PM2 启动

```bash
npm install -g pm2
DATA_SECRET='换成一串足够长的随机密钥' pm2 start npm --name geo-tool -- run start
pm2 save
pm2 startup
```

应用默认监听 `3001` 端口。

查看运行状态：

```bash
pm2 status
pm2 logs geo-tool
```

重启：

```bash
pm2 restart geo-tool
```

## 6. 配置 Nginx

示例配置：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  client_max_body_size 100M;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

检查并重载：

```bash
nginx -t
systemctl reload nginx
```

## 7. 配置 HTTPS

使用 Certbot 的示例：

```bash
certbot --nginx -d your-domain.com
```

## 8. 数据和备份

这个项目当前使用本地文件保存业务数据：

- `data/db.json`
- `data/uploads`

这两个路径必须持久化，并且需要定期备份。

建议每天至少备份一次：

```bash
tar -czf geo-tool-data-$(date +%F).tar.gz data
```

迁移服务器时，至少迁移：

```bash
data/db.json
data/uploads
public/oubo-logo.jpg
```

## 9. 更新发布

上传新代码后：

```bash
cd /opt/geo-tool
npm install
npm run build
pm2 restart geo-tool
```

## 注意事项

- 当前数据是单机文件存储，不要同时运行多个应用实例。
- `data` 目录不要放进会被覆盖的发布目录中，正式部署时建议单独备份或挂载。
- 如果首次部署后仍使用默认管理员账号，请登录后立即修改密码。
