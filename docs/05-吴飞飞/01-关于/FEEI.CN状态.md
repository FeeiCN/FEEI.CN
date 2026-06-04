---
slug: /status
title: FEEI.CN状态
icon: simple-checked-icon
---

## 脚本运行状态

| 任务 | 运行状态 | 运行时间 | 输出页面 |
| --- | --- | --- | --- |
| 健康数据 | 成功 | 2026-06-04 21:21:46 | [健康数据](/health-data) |
| 财务自由数据 | 成功 | 2026-06-04 21:16:27 | [个股账号资产数据](/stock-data)<br />[指数账号资产数据](/index-data) |

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
    "run_time": "2026-06-04 21:16:27",
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
    "run_time": "2026-06-04 21:21:46",
    "script": "scripts/sync_health_data.mjs",
    "status": "成功"
  }
}
-->