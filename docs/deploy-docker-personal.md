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
