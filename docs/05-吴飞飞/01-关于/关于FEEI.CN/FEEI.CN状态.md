---
slug: /status
title: FEEI.CN运行状态
icon: simple-checked-icon
---

## 脚本运行状态

| 任务 | 运行状态 | 运行时间 | 输出页面 |
| --- | --- | --- | --- |
| 健康数据 | 成功 | 2026-06-11 07:30:14 | [健康数据](/health-data) |
| 港股打新数据 | 成功 | 2026-06-11 06:10:05 | [港股打新数据](/hk-ipo-data) |
| 财务自由数据 | 成功 | 2026-06-11 06:00:02 | [个股账号资产数据](/stock-data)<br />[指数账号资产数据](/index-data) |
| 阅读日历 | 成功 | 2026-06-11 14:40:04 | [阅读数据](/read-data) |

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
    "run_time": "2026-06-11 06:00:02",
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
    "run_time": "2026-06-11 06:10:05",
    "script": "scripts/hk_ipo.py",
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
    "run_time": "2026-06-11 14:40:04",
    "script": "scripts/export_weread_daily_activity.py",
    "status": "成功"
  }
}
-->