# OTA 包链接解析器

`top.360nenz.ota-link` 是一个中文 Myriad Tapp，用于查询公开 OTA 目录并提取固件包下载链接。

## 功能

- 查询 OnePlus、OPPO、Realme、小米、Redmi 与 POCO OTA 记录
- 启动时实时读取 OTA API，以“设备 → 地区 → 固件版本”三级联动下拉筛选
- 保留手动查询兜底，可输入设备、地区、型号或发布 ID 查找目录尚未出现在下拉中的版本
- 识别目录已提供的直接固件包地址
- 为 OPlus 创建一次性短期网页会话，复用网页的 `resolve_json` 流程生成带签名的临时下载直链
- 请求小米厂商入口，并从嵌套 JSON 中提取 `.zip` 等固件包地址
- 将目录中的 `OP 15` 等简称在界面中展开显示为 `OnePlus 15` 等全称
- 厂商临时入口失效时保留并标注官方 `source_url`
- 展示版本、型号、安全补丁、构建时间、大小、MD5 和发布 ID
- 一键复制解析后的下载链接或原始厂商入口
- 跟随 Myriad 深色与浅色主题

## 数据来源与限制

目录来自 [OTA API](https://roms.danielspringer.at/api/ota.php?help=1)。API 本身只返回 `source_url`，不会解析重定向或生成临时 CDN 链接。对 OPlus 记录，本 Tapp 会按网页的真实逻辑先提交设备、地区和版本序号，取得短期 `k` 与 CSRF，再在同一个一次性 PHP 会话中请求 `resolve_json` 生成带签名直链；不会写死 Cookie、CSRF 或签名链接。小米记录继续从厂商响应中提取固件包 URL。

厂商下载地址可能带签名与有效期。OPlus 签名链接由网页按需生成，过期后应在 Tapp 中重新解析；网页限流、令牌过期或厂商接口异常时，页面会保留目录中的官方源地址。小米链接也可能在一段时间后过期。下载和刷机均有风险，请核对型号、地区、MD5 与包类型。

Manifest 显式声明空的 `settings: []`，用于兼容将缺省设置反序列化为 `null` 的 Myriad 部署；否则声明式 API 可能返回 `Invalid Tapp settings declaration`。

## 己方服务测试教程

测试服务：<https://myriad.360nenz.top/>

### 1. 校验并打包

在仓库根目录执行：

```powershell
npm --prefix tapp-cli ci
node tapp-cli/bin/myriad-tapp.mjs check apps/top.360nenz.ota-link --json
node tapp-cli/bin/myriad-tapp.mjs pack apps/top.360nenz.ota-link --out apps/top.360nenz.ota-link/dist/top.360nenz.ota-link.tapp --json
```

以上三条命令可直接复制执行。第三条成功后即可上传产物：

```text
apps/top.360nenz.ota-link/dist/top.360nenz.ota-link.tapp
```

如需同时运行仓库级检查：

    node --test apps/top.360nenz.ota-link/tests/parser.test.cjs
    node scripts/validate-app.mjs --app top.360nenz.ota-link --json
    node scripts/sync-index.mjs validate --app top.360nenz.ota-link --json
    npm --prefix tapp-cli test

### 2. 在己方服务安装

1. 登录 <https://myriad.360nenz.top/>。
2. 进入 Tapp 管理或 Tapp 商店页面。
3. 选择“从文件安装”并上传 `top.360nenz.ota-link.tapp`。
4. 安装确认页应只申请网络请求、通知、主题和安全外链权限。
5. 安装后打开“OTA 包链接解析器”。

从 1.0.0 更新到 1.0.1 时必须重新批准权限，并确认授权列表包含 network:fetch。如果旧安装仍显示“目录加载失败”，先卸载旧版，再上传新包安装。

当前目录的 `base_url` 保持指向官方上游，便于后续提交合并；因此上游合并前，请在己方服务使用上述 `.tapp` 文件安装方式测试。若一定要测试 Fork 商店源，需要在测试分支把 `index.json` 的 `base_url` 临时改为 `https://raw.githubusercontent.com/360NENZ/tapp-store/main`，推送后再把该分支的 `index.json` URL 配置为商店源；不要把这个测试专用 `base_url` 带入上游 PR。

### 3. 功能测试

建议依次测试：

1. 等待目录加载完成，确认设备下拉显示 `OnePlus 15` 而非 `OP 15`，再依次选择 `OnePlus 15 → CN → PLK110_16.0.10.500(CN01)`。
2. 点击“解析下载链接”，确认结果提示“已通过 OTA 网页生成带签名的临时下载直链”，且链接包含厂商签名查询参数。
3. 切换不同设备，确认“地区”和“固件版本”下拉会清空并只展示该设备的有效选项。
4. 选择小米设备（例如 `Xiaomi 15 → EEA`），确认下载链接为 `ultimateota.d.miui.com` 的 `.zip` 地址。
5. 切换到“手动查询”，输入 `model=CPH2653`，查询并从匹配版本下拉中选择一个版本解析。
6. 在手动模式按发布 ID 精确查询，确认只返回对应 OTA 记录。
7. 复制下载链接，粘贴到文本框核对地址完整性。
8. 对网页限流或厂商已失效的入口，确认页面显示橙色回退提示且仍可复制源地址。
9. 点击“重新加载目录”，确认下拉选项会从 OTA API 重新获取，而不是使用写死的 PHP 列表。
10. 切换 Myriad 深色/浅色主题，确认页面颜色同步变化。

## Git 提交约定

使用中文 Conventional Commit，并创建签名提交：

```powershell
git add apps/top.360nenz.ota-link index.json
git commit -S -m "feat(tapp): 新增 OTA 包链接解析器"
```

如需标注共同作者，在提交正文末尾添加：

```text
Co-authored-by: 姓名 <邮箱>
```

## 权限

| 权限 | 用途 |
| --- | --- |
| `network:fetch` | 查询 OTA 目录并请求厂商下载入口 |
| `ui:notification` | 显示复制与错误提示 |
| `ui:theme` | 跟随 Myriad 主题 |
| `ui:openUrl` | 打开 OTA API 官方文档 |

## 更新日志

### v1.0.2 (2026-08-17)

- 复用 OTA 网页的短期会话、`k`、CSRF 与 `resolve_json` 流程，为 OPlus 按需生成带签名下载直链
- 将界面中的 `OP` 设备简称展开为 `OnePlus` 全称，同时保持底层 API 查询参数兼容

### v1.0.1 (2026-08-17)

- 显式声明空的 `settings` 数组，修复部分 Myriad 部署返回 `Invalid Tapp settings declaration`
- 补充从仓库根目录直接校验和生成可上传 `.tapp` 包的命令

### v1.0.0 (2026-08-17)

- 首次发布 OTA 目录选择、手动查询兜底与厂商下载链接解析
