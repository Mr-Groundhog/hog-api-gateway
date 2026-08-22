# 个人部署备忘：推送到 Docker Hub

> 适用对象：本机（Ferry 的 Windows 电脑）
> 目的：每次代码改完，将新的“最新版本”覆盖推送到 Docker Hub，供本机部署使用。

核心就两步：**重新构建 latest → 重新推送 latest**。

## 常规构建与推送

在项目根目录执行：

```powershell
# 进入项目目录
cd C:\Users\Ferry\Desktop\Project\new-api

# 重新构建；未写标签时默认就是 :latest
docker build --platform linux/amd64 -t leileihog/hog-new-api .

# 推送最新镜像
docker push leileihog/hog-new-api
```

这等价于显式写明 latest 标签：

```powershell
docker build --platform linux/amd64 -t leileihog/hog-new-api:latest .
docker push leileihog/hog-new-api:latest
```

## 关于登录

通常不用每次都执行 `docker login`，登录状态会保留。只有遇到 `unauthorized`、`denied`，或换了电脑时，才需要执行：

```powershell
docker login
```

## BuildKit 网络超时问题

由于当前的 BuildKit 有网络超时问题，若上次是靠传统构建器才成功，下次也沿用这个版本：

```powershell
cd C:\Users\Ferry\Desktop\Project\new-api
$env:DOCKER_BUILDKIT="0"
docker build -t leileihog/hog-new-api .
Remove-Item Env:DOCKER_BUILDKIT
docker push leileihog/hog-new-api
```

> 实际使用中一般用的是上面这个传统构建器方案：只要命令里带 `--platform linux/amd64`，BuildKit 就会报错，所以不用该参数，靠传统构建器在 amd64 机器上直接构建出 amd64 镜像。若新版 Docker Desktop 移除传统构建器导致此命令失败，再回头排查 BuildKit 的网络/平台问题。

## 构建时注入版本号（推荐）

VERSION 文件写入内容后，Dockerfile 会自动把它注入到 `/api/status` 返回的 `version` 字段，方便确认线上跑的是哪次构建（不写则 version 恒为空，无法排查版本新旧）。在构建前先写入版本号，并顺手打一个带版本的 tag 便于回滚：

```powershell
cd C:\Users\Ferry\Desktop\Project\new-api
Set-Content VERSION "hog-$(git rev-parse --short HEAD)-$(Get-Date -Format 'MMdd-HHmm')"

$env:DOCKER_BUILDKIT="0"
docker build -t leileihog/hog-new-api:latest -t "leileihog/hog-new-api:$(Get-Content VERSION)" .
Remove-Item Env:DOCKER_BUILDKIT
docker push leileihog/hog-new-api --all-tags
```

## 服务器上更新容器

`docker pull` 只更新本地镜像，不会更新正在运行的容器。每次更新必须删掉旧容器重建：

```bash
docker pull leileihog/hog-new-api:latest
docker stop new-api && docker rm new-api
docker run -d --name new-api <原有参数> leileihog/hog-new-api:latest
# 或使用 docker-compose 时：
# docker compose pull && docker compose up -d
```

> 排查线上是否为新版本：访问 `/api/status` 看 `version` 字段，或对比登录页是否出现新版功能（如 "Don't have an account?" 提示）。
