---
slug: /iphone-ui-automation
title: 自动化操作 iPhone
icon: phone-icon
description: 用 Appium、XCUITest 和 WebDriverAgent 控制未越狱 iPhone，导出页面树、截图和可见 UI 信息。
---

未越狱 iPhone 的通用 UI 自动化，最稳的路径是 Appium 调 XCUITest，再由 WebDriverAgent 控制真机。它能读到当前屏幕的可访问性元素、文本、坐标和截图，适合做 App 回归测试、跨 App 操作、页面信息采集。

它读不到其他 App 的私有数据库，也不能绕过系统权限弹窗。能自动化的是「屏幕上可见、系统允许暴露给 UI 测试的东西」。

## 环境准备

Mac 上安装基础工具：

```bash
brew install libimobiledevice ios-deploy
npm install -g appium
appium driver install xcuitest
python3 -m pip install Appium-Python-Client
```

iPhone 需要完成三件事：

- 连接 Mac 后点击「信任这台电脑」。
- 打开「设置」里的开发者模式。
- 首次运行 WebDriverAgent 时，按系统提示信任开发者证书。

检查本机环境和设备：

```bash
python3 scripts/ios_appium_capture.py --check
```

查看设备 UDID：

```bash
python3 scripts/ios_appium_capture.py --list-devices
```

## 运行一次采集

先启动 Appium：

```bash
appium
```

另开一个终端，采集 Safari 当前页面：

```bash
python3 scripts/ios_appium_capture.py --bundle-id com.apple.mobilesafari
```

打开指定网页后采集：

```bash
python3 scripts/ios_appium_capture.py \
  --bundle-id com.apple.mobilesafari \
  --safari-url https://feei.cn \
  --find FEEI
```

如果同时连接多台设备，明确指定 UDID：

```bash
python3 scripts/ios_appium_capture.py \
  --udid 00000000-0000000000000000 \
  --bundle-id com.apple.mobilesafari
```

默认输出到 `/tmp/ios-appium-capture/`：

- `*.xml`：当前页面的 UI 元素树。
- `*.png`：当前屏幕截图。
- `*.json`：设备、bundle id、窗口尺寸、capabilities 和输出文件路径。

## 支付宝理财持有明细截图

目标是打开支付宝，进入理财，再点击总资产，把全部持有明细按屏滚动截图下来：

```bash
appium
python3 scripts/ios_appium_capture.py --alipay-assets
```

脚本默认使用支付宝 iOS bundle id：

```text
com.alipay.iphoneclient
```

默认输出到 `/tmp/alipay-assets-capture/`：

- `*-holding-detail-01.png`、`*-holding-detail-02.png`：持有明细滚动截图。
- `*-holding-detail-01.xml`、`*-holding-detail-02.xml`：每一屏对应的 UI 元素树。
- `*-summary.json`：本次导航步骤、截图列表和停止原因。
- `*-error-screen.png`：流程失败时停留页面的现场截图。
- `static/data/invest/YYYY/MM/DD/alipay.json`：按运行当天日期沉淀的投资持仓结构化数据。

支付宝页面会因为版本、账号、弹窗和安全策略变化。脚本按这些可访问性文本导航：

```text
理财 / 财富
总资产 / 资产总额 / 我的资产 / 资产
全部持有 / 持有明细 / 持有 / 查看全部
```

实际跑通后，支付宝的关键入口不是页面上肉眼看到的「我的资产」文案，而是总资产页里可访问性树暴露出来的 `总资产：...元` 按钮。完整路径是：

```text
支付宝首页 -> 理财 -> 总资产 -> 总资产：...元 -> 全部持有
```

脚本会先判断当前是否已经在资产相关页面。如果已经在「总资产」或「全部持有」页面，就跳过前面的入口，避免重复点击返回或误点标题。进入总资产页后，脚本会先滚到页顶，再优先点击 `总资产：` 这个可访问性元素；找不到时才用顶部金额区域坐标兜底。

遇到登录、人脸、密码、验证等安全校验时，脚本只等待手动完成，不会输入密码或绕过校验。默认等待 120 秒：

```bash
python3 scripts/ios_appium_capture.py \
  --alipay-assets \
  --manual-timeout 180
```

如果已经手动打开到支付宝「总资产」或「全部持有」页面，可以跳过导航，直接从当前页面滚动截图：

```bash
python3 scripts/ios_appium_capture.py \
  --alipay-assets \
  --skip-navigation \
  --max-screens 80
```

完整真机运行命令通常是：

```bash
python3 scripts/ios_appium_capture.py \
  --alipay-assets \
  --udid 00000000-0000000000000000 \
  --xcode-org-id YOUR_TEAM_ID \
  --updated-wda-bundle-id com.example.WebDriverAgentRunner \
  --allow-provisioning-updates \
  --allow-provisioning-device-registration \
  --manual-timeout 180 \
  --max-screens 80 \
  --step-wait 2 \
  --nav-timeout 25
```

多台设备同时连接时指定 UDID：

```bash
python3 scripts/ios_appium_capture.py \
  --alipay-assets \
  --udid 00000000-0000000000000000
```

如果中断，先看 `*-error-screen.png` 和 `*-error-screen.xml`。页面文本变了就用 `--skip-navigation`，手动进到目标页面后让脚本负责完整滚动截图。

## 支付宝持仓数据沉淀

支付宝持仓采集完成后，脚本会同时做两类输出。

临时采集现场保留在 `/tmp/alipay-assets-capture/`。这里保留完整截图、XML 页面树、summary 和错误现场，适合排查自动化是否点对页面。

长期数据沉淀在站点静态数据目录：

```text
static/data/invest/YYYY/MM/DD/alipay.json
```

脚本按本机当天日期自动创建目录。需要覆盖输出路径时再传 `--invest-output`：

```bash
python3 scripts/ios_appium_capture.py \
  --alipay-assets \
  --invest-output static/data/invest/2026/06/23/alipay.json
```

已经有 `*-summary.json` 时，不需要重新操作手机，可以直接从已有 XML 重新提取并写入站点数据：

```bash
python3 scripts/ios_appium_capture.py \
  --extract-existing-summary /tmp/alipay-assets-capture/20260622T162128Z-summary.json
```

`alipay.json` 的顶层结构：

```json
{
  "capturedAt": "2026-06-23T00:23:02+08:00",
  "source": "alipay",
  "sourceSummary": "/tmp/alipay-assets-capture/xxx-summary.json",
  "assetRecords": [],
  "holdingRecords": [],
  "holdingCount": 15,
  "holdingAmountSum": 1538856.48
}
```

`assetRecords` 是总资产页的分类汇总，例如总资产、余额宝、基金、帮你投、储蓄养老。`holdingRecords` 是「全部持有」里的逐项持仓。

单条持仓字段：

```json
{
  "name": "华泰保兴尊睿6个月持有期债券A",
  "tags": ["基金", "稳健理财"],
  "amountText": "734,995.35",
  "amount": 734995.35,
  "dayProfitText": "+397.65",
  "dayProfit": 397.65,
  "holdingProfitText": "+1,495.21",
  "holdingProfit": 1495.21,
  "cumulativeProfitText": "+1,495.21",
  "cumulativeProfit": 1495.21,
  "assetRatioText": "47.76%",
  "assetRatio": 47.76,
  "holdingReturnRateText": "+0.20%",
  "holdingReturnRate": 0.2
}
```

验证采集是否完整，先看三个条件：

- `summary.json` 的导航里出现 `tapHoldingDetails: 全部持有`。
- `holding-detail-*.xml` 里能看到 `全部持有`，并且最后一屏包含页面底部免责声明或末尾内容。
- `holdingRecords` 的 `amount` 合计等于 `assetRecords` 里的总资产金额。

## 技术实现要点

脚本的核心分三层。

第一层是 Appium/XCUITest 连接真机，生成 WebDriverAgent 会话。签名相关参数通过 `xcodeOrgId`、`updatedWDABundleId` 和 `allowProvisioningUpdates` 传给 Appium，解决免费 Apple ID 或个人 Team 下 WebDriverAgent 首次安装的问题。

第二层是页面导航。支付宝大量页面是 WebView，但可访问性树里仍会暴露一部分 `name`、`label`、`value` 和坐标。脚本用 `accessibility id` 和 iOS predicate 查找文本；文本不稳定时，用页面树里的坐标作为兜底。总资产页的真实入口就是通过 XML 反查出来的 `总资产：...元` 按钮。

第三层是数据提取。每一屏滚动时保存 XML 和 PNG，后续从 XML 的 `XCUIElementTypeStaticText` 中按坐标恢复表格：

```text
名称/金额 | 日收益 | 持有收益 | 累计收益
```

持仓页的每一行是固定布局。脚本用名称行的 `y` 坐标向下找金额、日收益、持有收益、累计收益，再向下找占比和收益率。跨屏边界处同一持仓可能出现两次，脚本按 `(name, amountText)` 合并，补齐上一屏缺失的占比或收益率字段。

自动停止依赖页面签名。每滚动一屏，脚本根据 XML 中的文本、坐标、尺寸生成 hash；如果签名重复，就认为已经到底或页面不再滚动。这个判断比固定滚动次数更稳定。

## 操作自己的 App

把 `--bundle-id` 换成目标 App 的 bundle id：

```bash
python3 scripts/ios_appium_capture.py --bundle-id com.example.myapp
```

如果 Appium 启动失败，优先查这几个点：

- `xcodebuild -version` 能正常输出。
- `appium driver list --installed` 里有 `xcuitest`。
- iPhone 已解锁，并且已信任当前 Mac。
- Xcode 的 Team 签名能安装 WebDriverAgent。
- Appium 日志里没有 `xcodebuild failed` 或证书相关错误。

## 获取信息的方式

页面树里常见字段：

```text
type
name
label
value
enabled
visible
x
y
width
height
```

自动化脚本后续可以基于这些字段定位元素：

```python
el = driver.find_element("accessibility id", "搜索")
el.click()

input_el = driver.find_element("class name", "XCUIElementTypeTextField")
input_el.send_keys("hello")
```

如果只是想确认某段文案是否出现在屏幕上，可以直接用脚本的 `--find`：

```bash
python3 scripts/ios_appium_capture.py \
  --bundle-id com.apple.mobilesafari \
  --find 搜索
```

## 故障定位

`--check` 能快速判断缺少哪个依赖：

```bash
python3 scripts/ios_appium_capture.py --check
```

需要看 WebDriverAgent 详细日志时：

```bash
python3 scripts/ios_appium_capture.py \
  --bundle-id com.apple.mobilesafari \
  --show-xcode-log
```

证书和签名问题通常需要打开 Xcode，让 WebDriverAgent 使用自己的 Apple ID Team 重新签名。设备信任、开发者模式、签名这三类问题解决后，Appium 才能稳定控制真机。
