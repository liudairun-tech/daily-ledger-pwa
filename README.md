# 每日账本

一个面向 iPhone 的离线优先个人收支 PWA。首次通过 HTTPS 打开后，可从 Safari 添加到主屏幕，不需要 Apple 开发者账号或定期重新签名。

## 功能

- 收入、支出、退款和账户间转账
- 支付宝、微信 CSV/TXT/ZIP 导入，银行卡通用 CSV 列映射
- 支付截图与小票本地 OCR，识别结果先审核再入账
- 文件哈希、外部流水号和跨来源同额近时交易去重
- 本月汇总、最近七日趋势、分类支出图表、搜索与筛选
- IndexedDB 本地存储，离线运行，无账号、无遥测、无账目上传
- AES-256-GCM 加密全量备份及 CSV 导出

## 本地运行

需要 Node.js 22 和 pnpm：

```bash
pnpm install
pnpm dev
```

质量检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 部署到 GitHub Pages

1. 创建公开仓库并推送到 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。
3. `Test and deploy Pages` 工作流会先检查、测试和构建，再发布 `dist`。
4. 在 iPhone Safari 打开 Pages 地址，点击分享按钮，选择“添加到主屏幕”。

## 使用说明

### 快速记账

打开底部“记账”，先输入金额，再选择类型、账户和分类。`/#/add` 是固定快速入口，可在 iPhone“快捷指令”中用“打开 URL”绑定到 Siri 或操作按钮。

### 账单与截图

在“导入”选择支付宝、微信导出的 CSV/TXT/ZIP，或从照片中选择支付截图。所有记录先进入预览；黄色项目是疑似重复项，必须人工确认。OCR 首次运行会下载中文识别模型，图片本身不会上传。

银行卡格式各异。选择通用 CSV 后，需要指定日期、金额、收支方向、商户、备注和流水号对应的列。

### 备份与恢复

在“设置”输入至少 8 位密码并导出 `.ledger` 文件，然后通过系统保存面板存入 iCloud Drive。密码不会被保存，丢失后无法恢复。CSV 适合阅读，不包含完整的账户、规则和导入审计信息。

恢复备份会替换当前设备里的账本，应用会在操作前再次确认。

## 隐私边界

账目、导入文件和 OCR 文字保存在当前浏览器的 IndexedDB。应用不包含后端接口或分析代码。清理 Safari 网站数据可能删除账本，因此请定期导出加密备份。

PWA 无法读取支付宝、微信、银行卡或系统通知，也不能作为原生 iOS 分享扩展出现。“自动化”仅指账单解析、截图识别、分类建议、去重与快捷入口。

## 开源参考

产品交互参考了 [Dime](https://github.com/rarfell/dimeApp)，导入导出参考了 [Expenso-iOS](https://github.com/sameersyd/Expenso-iOS)，OCR 流程参考了 [MyReceiptKeeperApp](https://github.com/panpiii/MyReceiptKeeperApp)。本项目为独立实现，不复制 Dime 的 GPLv3 源代码。

本项目采用 [MIT License](LICENSE)。
