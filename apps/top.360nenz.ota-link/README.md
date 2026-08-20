# OTA 包链接解析器

`top.360nenz.ota-link` 是一个中文 Myriad Tapp，用于查询公开 OTA 目录并提取固件包下载链接。

## 功能

- 查询 OnePlus、OPPO、Realme、小米、Redmi 与魅族 OTA 记录
- 启动时实时读取 SmartTool 目录，以“包类型 → 品牌 → 系列 → 机型 → 固件版本”五级联动下拉筛选
- 保留手动查询兜底，可完整输入包类型、品牌、系列、机型和版本
- 识别目录已提供的直接固件包地址
- 为 OPlus 创建一次性短期网页会话，复用网页的 `resolve_json` 流程生成带签名的临时下载直链
- 请求小米厂商入口，并从嵌套 JSON 中提取 `.zip` 等固件包地址
- 将目录中的 `OP 15` 等简称在界面中展开显示为 `OnePlus 15` 等全称
- 对 HTTP 包地址和落地页等非标准返回保留结果并明确标注，不因格式异常停止
- 展示来源、HTTPS/HTTP 状态和动态签名状态
- 一键复制解析后的下载链接
- 跟随 Myriad 深色与浅色主题

## 数据来源与限制

SmartTool 的五级目录和下载解析来自 VioletTool 接口；Daniel Springer 的 [OTA API](https://roms.danielspringer.at/api/ota.php?help=1) 是第三方、只读的 OnePlus ROM/固件归档目录，不是官方目录。该 API 只返回 `source_url`，不会解析重定向或生成临时 CDN 链接。对 OPlus 记录，本 Tapp 会按网页的真实逻辑先提交设备、地区和版本序号，取得短期 `k` 与 CSRF，再在同一个一次性 PHP 会话中请求 `resolve_json` 生成带签名直链；不会写死 Cookie、CSRF 或签名链接。小米记录继续从厂商响应中提取固件包 URL。

厂商下载地址可能带签名与有效期。OPlus 签名链接由网页按需生成，过期后应在 Tapp 中重新解析；网页限流、令牌过期或厂商接口异常时会继续尝试下一数据源。小米链接也可能在一段时间后过期。下载和刷机均有风险，请自行核对型号、地区、校验值与包类型。

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

从旧版更新时确认授权列表包含 `network:fetch`。如果旧安装仍显示“目录加载失败：Invalid Tapp settings declaration”，先卸载旧版，再上传新包安装。

当前 Manifest 中的 `fixedLink` 指向 `https://ota-api.360nenz.top/`，这是自有 API 的预留地址；部署独立 API 后才会命中固定缓存，未部署或返回 404 时 Tapp 会自动跳过并继续 Daniel/VioletTool。当前目录的 `base_url` 保持指向官方上游，便于后续提交合并；因此上游合并前，请在己方服务使用上述 `.tapp` 文件安装方式测试。若一定要测试 Fork 商店源，需要在测试分支把 `index.json` 的 `base_url` 临时改为 `https://raw.githubusercontent.com/360NENZ/tapp-store/main`，推送后再把该分支的 `index.json` URL 配置为商店源；不要把这个测试专用 `base_url` 带入上游 PR。

### 3. 功能测试

建议依次测试：

1. 等待第三方目录状态加载完成，再按 `全量包 → OnePlus → 数字系列 → [C16动态解析]OnePlus 15 → PLK110_16.0.10.500(CN01)` 逐级选择；确认机型显示为 `OnePlus 15`。
2. 点击“解析下载链接”，确认结果按“自有 API → Daniel Springer 第三方站 → VioletTool”的顺序命中，并展示实际来源。
3. 切换品牌、系列或机型，确认所有下级选项会清空并重新懒加载。
4. 测试 `PLK110_16.0.3.502(CN01)`，若自有 API 尚未部署，确认 Tapp 会自动继续后续来源而非直接报错停止。
5. 测试 `OnePlus / 数字系列 / [普通]一加9 / ColorOS 11.2 A.03`；若返回 `http://download.h2os.com/...zip`，结果应标注“HTTP（需谨慎）”且仍可复制。
6. 切换到“手动输入兜底”，完整填写五个字段并解析，确认目录中暂未更新的机型仍可查询。
7. 复制下载链接并粘贴到文本编辑器，核对长查询参数没有截断。
8. 点击“重新加载目录”，确认会清空本地列表缓存；再次选择条件后重新请求 VioletTool 目录。
9. 切换 Myriad 深色/浅色主题，确认表单、状态和结果卡片均可读。

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
| `ui:openUrl` | 打开 Daniel Springer 第三方 OTA API 文档 |

## 更新日志

### v1.1.0 (2026-08-20)

- 改为包类型、品牌、系列、机型、版本五级懒加载下拉，并保留完整手动输入兜底
- 自有 API 固定/有效动态缓存优先，再尝试 Daniel Springer 第三方目录和 VioletTool
- HTTP 返回地址不再让界面停止，明确显示为需谨慎的非 HTTPS 地址
- 修复 `Tapp.ui.showNotification` 兼容性和第三方目录数组响应解析

### v1.0.2 (2026-08-17)

- 复用 OTA 网页的短期会话、`k`、CSRF 与 `resolve_json` 流程，为 OPlus 按需生成带签名下载直链
- 将界面中的 `OP` 设备简称展开为 `OnePlus` 全称，同时保持底层 API 查询参数兼容

### v1.0.1 (2026-08-17)

- 显式声明空的 `settings` 数组，修复部分 Myriad 部署返回 `Invalid Tapp settings declaration`
- 补充从仓库根目录直接校验和生成可上传 `.tapp` 包的命令

### v1.0.0 (2026-08-17)

- 首次发布 OTA 目录选择、手动查询兜底与厂商下载链接解析
