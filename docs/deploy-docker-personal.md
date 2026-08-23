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

如果想自动读取项目根 `VERSION` 文件的内容作为 tag（例如文件内容是 `1.0.0`，则镜像为 `leileihog/hog-new-api:1.0.0`，不必手动改数字）：

```powershell
$ver = (Get-Content VERSION).Trim()
docker build --platform linux/amd64 -t "leileihog/hog-new-api:$ver" .
docker push "leileihog/hog-new-api:$ver"
```

> 这样镜像 tag 始终与 `VERSION` 文件保持一致；版本的写入与完整注入机制见下文「构建时注入版本号（推荐）」。

## 关于推送哪个仓库（两个远程）

本地配置了三个远程（`git remote -v` 可查）：

| 远程名 | 地址 | 用途 |
|---|---|---|
| `origin` | `Mr-Groundhog/new-api` | 上游项目镜像 |
| `mine` | `Mr-Groundhog/hog-api-gateway` | 自己的二次开发仓库 |
| `upstream` | `QuantumNous/new-api` | 官方新 API 仓库（拉新代码用） |

当前两个自有仓库的 `develop` 分支内容一致，平时推到哪个都行；如果想长期固定推送到某一个，把默认推送远程指过去即可：

```powershell
# 之后直接 git push 就会推到 mine（hog-api-gateway）
git remote set-pushdefault mine

# 改回默认推 origin（new-api）
git remote set-pushdefault origin

# 查看当前默认推送远程
git remote -v
```

切换远程不会影响本地已构建的 Docker 镜像（镜像由本地工作目录打包，与推送到哪个 git 仓库无关），只影响代码留档的位置。需要时也可以显式指定推送目标：`git push mine develop`。

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
Set-Content VERSION "1.0.0-$(Get-Date -Format 'MMdd-HHmm')"

$env:DOCKER_BUILDKIT="0"
docker build -t leileihog/hog-new-api:latest -t "leileihog/hog-new-api:$(Get-Content VERSION)" .
Remove-Item Env:DOCKER_BUILDKIT
docker push leileihog/hog-new-api --all-tags
```

## 版本号是怎么注入的

版本号不是 `docker build` 的参数，而是构建前写入项目根的 `VERSION` 文件，Dockerfile 在构建时读取它，共三处引用：

1. `COPY ./VERSION /build/VERSION` — 把版本号文件拷进构建上下文
2. Go 后端通过 ldflags 注入：`go build -ldflags "-X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'"`，运行后在 `/api/status` 返回的 `version` 字段里可见
3. 前端构建时作为 `VITE_REACT_APP_VERSION` 环境变量打进 React 应用，会显示在页面上

版本号格式为 `<版本号>-<MMdd-HHmm>`（如 `1.0.0-0823-1530`）；同时打 `latest` 和版本 tag 两个标签、`--all-tags` 一起推送，版本 tag 可用于回滚。升级主版本号时直接改 `Set-Content` 里的 `1.0.0` 即可。

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
