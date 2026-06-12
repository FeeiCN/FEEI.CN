---
slug: /status
title: FEEI.CN运行状态
icon: simple-checked-icon
---

## 脚本运行状态

| 任务 | 运行状态 | 运行时间 | 输出页面 |
| --- | --- | --- | --- |
| AI 使用数据 | 成功 | 2026-06-12 12:20:01 | [AI 使用数据](/ai-usage-data) |
| 健康数据 | 成功 | 2026-06-11 07:30:14 | [健康数据](/health-data) |
| 微信读书划线入 issue | 成功 | 2026-06-12 19:52:28 |  |
| 微信读书数据同步 | 成功 | 2026-06-12 14:28:09 |  |
| 港股打新数据 | 成功 | 2026-06-12 06:10:05 | [港股打新数据](/hk-ipo-data) |
| 财务自由数据 | 成功 | 2026-06-12 06:00:03 | [个股账号资产数据](/stock-data)<br />[指数账号资产数据](/index-data) |
| 阅读日历 | 成功 | 2026-06-11 19:40:06 | [阅读数据](/read-data) |

<!-- status-page-data
{
  "financial-assets": {
    "name": "财务自由数据",
    "outputs": [
      {
        "slug": "/stock-data",
        "title": "个股账号资产数据"
      },
      {
        "slug": "/index-data",
        "title": "指数账号资产数据"
      }
    ],
    "run_time": "2026-06-12 06:00:03",
    "script": "scripts/account_assets.py",
    "status": "成功"
  },
  "health-data": {
    "name": "健康数据",
    "outputs": [
      {
        "slug": "/health-data",
        "title": "健康数据"
      }
    ],
    "run_time": "2026-06-11 07:30:14",
    "script": "scripts/sync_health_data.mjs",
    "status": "成功"
  },
  "hk-ipo": {
    "name": "港股打新数据",
    "outputs": [
      {
        "slug": "/hk-ipo-data",
        "title": "港股打新数据"
      }
    ],
    "run_time": "2026-06-12 06:10:05",
    "script": "scripts/hk_ipo.py",
    "status": "成功"
  },
  "llm-usage": {
    "name": "AI 使用数据",
    "outputs": [
      {
        "slug": "/ai-usage-data",
        "title": "AI 使用数据"
      }
    ],
    "run_time": "2026-06-12 12:20:01",
    "script": "scripts/sync_llm_usage.py",
    "status": "成功"
  },
  "reading-heatmap": {
    "name": "阅读日历",
    "outputs": [
      {
        "slug": "/read-data",
        "title": "阅读数据"
      }
    ],
    "run_time": "2026-06-11 19:40:06",
    "script": "scripts/export_weread_daily_activity.py",
    "status": "成功"
  },
  "weread-daily": {
    "name": "微信读书数据同步",
    "outputs": [],
    "run_time": "2026-06-12 14:28:09",
    "script": "scripts/export_weread_data.py",
    "status": "成功"
  },
  "weread-highlights": {
    "name": "微信读书划线入 issue",
    "outputs": [],
    "run_time": "2026-06-12 19:52:28",
    "script": "scripts/import_weread_latest_highlight.py",
    "status": "成功"
  }
}
-->