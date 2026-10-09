# DreamLand 服务器部署（容器 + HTTPS 反代）

本目录提供 **TLS 终止** 与 **一键起栈** 的部署配置。后端镜像由仓库根目录
`Dockerfile` 构建（`docker build -f Dockerfile -t dreamland/server:dev .`）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `Caddyfile` | Caddy 2 站点配置：自动签发/续期证书，反代到 `dreamland:8000`，SSE 不缓冲 |
| `docker-compose.tls.yml` | DreamLand + Caddy 组合栈；只有 Caddy 对外发布 80/443 |
| `secrets.json` | **本地密钥文件，不入 Git**（`.gitignore` 已覆盖）。以只读方式挂载到 `/run/secrets/dreamland-secrets.json` |

## 启动

```bash
cd deploy

# 1) 上游接口密钥（可选但推荐）
cat > secrets.json <<'JSON'
{ "api_key_openai": "sk-...", "api_key_deepseek": "sk-..." }
JSON
chmod 600 secrets.json

# 2) 会话签名密钥（32 字节以上随机值，避免写入 config.yaml）
export DREAMLAND_COOKIE_SECRET="$(openssl rand -base64 48)"
export DREAMLAND_DOMAIN="chat.example.com"
export DREAMLAND_TLS_EMAIL="ops@example.com"

# 3) 起栈（域名需已解析到本机，且 80/443 可达）
docker compose -f docker-compose.tls.yml up -d

# 4) 验证
curl -fsS "https://${DREAMLAND_DOMAIN}/version"
```

本机演练（不申请公网证书，使用 Caddy 内部 CA 自签）：

```bash
DREAMLAND_DOMAIN=localhost CADDY_TLS=internal \
  docker compose -f docker-compose.tls.yml up -d
curl -fk https://localhost/version
```

## 关键取舍

- **只有 Caddy 暴露端口**：DreamLand 容器用 `expose: 8000`，不发布到宿主机，因此不存在明文 HTTP 入口。
- **IP 白名单**：反代后面 DreamLand 只能看到代理地址，逐 IP 白名单失去意义，所以栈内用
  `DREAMLAND_WHITELIST_MODE=false`；边界由「Caddy 站点地址精确匹配 + TLS + （可选）Basic 认证」承担。
  如需应用层再兜一层，设置 `DREAMLAND_HOST_WHITELIST_ENABLED=true` 并把公网域名写进
  `DREAMLAND_HOST_WHITELIST_HOSTS='["chat.example.com"]'`。
- **Basic 认证**：公网测试期建议开启：
  ```bash
  DREAMLAND_BASIC_AUTH_MODE=true \
  DREAMLAND_BASIC_AUTH_USER=ops \
  DREAMLAND_BASIC_AUTH_PASSWORD="$(openssl rand -base64 24)" \
  docker compose -f docker-compose.tls.yml up -d
  ```
- **非 root 运行**：镜像以 `USER node`（UID/GID 1000）运行，并带 `tini` 作为 init。
  `data/`、`config/`、`plugins/` 是宿主机 bind mount，必须允许 UID 1000 写入，例如：
  ```bash
  sudo chown -R 1000:1000 ./data ./config ./plugins
  ```
  若不方便改宿主机权限，可临时以 root 启动并对目录做一次性 chown：
  ```bash
  docker compose -f docker-compose.tls.yml run --rm --user root --entrypoint sh \
    dreamland -c 'chown -R node:node /home/node/app/data /home/node/app/config /home/node/app/plugins'
  ```
- **配置与密钥**：所有设置走 `DREAMLAND_*` 环境变量（见根 `README.md` 的环境变量表），
  容器内的 `config.yaml` 不需要保存任何明文密钥。

## 不附加反代（只用后端镜像）

```bash
docker build -f Dockerfile -t dreamland/server:dev .
docker compose -f docker/docker-compose.yml up -d
curl -fsS http://localhost:8000/version
```

该方式只适用于本机/内网；对外提供服务请使用上面的 Caddy 栈。
