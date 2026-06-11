<div align="center">

![Logo](static/img/logo.webp)

# FEEI.CN

**吴飞飞（Feei）的个人知识与判断系统，已持续维护 10 年。**

> 把所有的时间、精力和金钱都投入到长期目标中。

[![GitHub stars](https://img.shields.io/github/stars/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/network/members)
[![Last commit](https://img.shields.io/github/last-commit/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/commits/main)
[![Docusaurus](https://img.shields.io/badge/Docusaurus-3.10-25c2a0?style=flat-square&logo=docusaurus&logoColor=white)](https://docusaurus.io/)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[在线站点](https://feei.cn) · [关于我](https://feei.cn/about) · [开始阅读](https://feei.cn/life-certainty)

</div>

---

## 这一切为什么开始

有一天，对着镜子，看到的是一个自己讨厌的自己——身体浮肿、精力下降，体检报告上的异常指标越来越多。

房贷还了 70 万，本金只减了 30 万。能力提升越来越慢，身边朋友被裁后至今没找到合适的工作。

**"还行"才是最让人停滞的陷阱。**

于是开始反问自己：到底在追求什么？想要的，是能穿越短期波动和偶然运气的东西，是在复杂变化中依然能一点点建立起来的确定性。

这个站点，就是那次反问之后的回答。

---

## 这是什么

**一个长期公开沉淀的判断与方法论系统。** 不是博客、不是简历、不是技术手册。

围绕四个长期方向持续记录——网络空间安全是主线，健康、事业、财富与人生，是对抗熵增的延伸观察。

| 方向 | 一句话 | 入口 |
| :--- | :--- | :--- |
| **健康幸福** | 长期系统：身体、心理、关系三位一体 | [/health](https://feei.cn/health) |
| **事业有成** | 把自我塑造成能持续做值得做的事的状态 | [/capability](https://feei.cn/capability) |
| **财务自由** | 把今天的收入转化为未来的选择权 | [/wealth](https://feei.cn/wealth) |
| **人生丰富** | 在效率之外保持对世界的好奇 | [/experience](https://feei.cn/experience) |

---

## 一些数字

| 指标 | 值 |
| :--- | :--- |
| 文档沉淀 | **274** 篇，覆盖 2016–2026 |
| Git 提交 | **451** 次，单一作者深度维护 |
| 自研 React 组件 | **18+** 个 |
| 自研 Docusaurus 插件 | **1** 个（`docMtimePlugin`） |
| 数据仪表盘 | **4** 个（阅读 / 健康 / 足迹 / LLM 用量） |

<!-- TODO: 仪表盘合集截图 -->

---

## 仪表盘一览

四个数据仪表盘，把"个人状态"从主观感受变成可观察、可复盘的数据流。

| 仪表盘 | 看什么 | 入口 |
| :--- | :--- | :--- |
| 阅读仪表盘 | 阅读量、热力图、年度分布、书架 | [站点](https://feei.cn/reading) |
| 健康数据 | 身体指标趋势、睡眠、运动、饮食 | [站点](https://feei.cn/health) |
| 中国足迹 | 去过哪些省、地级市、按年回放 | [站点](https://feei.cn/travel) |
| LLM 用量 | 多 vendor token 消耗日历 | [站点](https://feei.cn/llm-usage) |

<!-- TODO: 每个仪表盘各补一张截图 -->

---

## 跑起来

```bash
git clone https://github.com/FeeiCN/FEEI.CN.git
cd FEEI.CN
npm install
npm run start          # 本地开发，http://localhost:3000
```

构建与检查：

```bash
npm run build          # 生产构建到 build/
npm run typecheck      # TypeScript 严格类型检查
npm run serve          # 本地预览构建产物
```

要求：Node.js `>= 20`。

### 目录速查

```
docs/         全部内容（274 篇 .md / .mdx，按方向分目录）
src/
  components/  18+ 自研 React 组件
  pages/       首页与自定义页面
  theme/       Docusaurus 主题覆盖
  css/         全局样式
plugins/       自研 Docusaurus 插件（docMtimePlugin）
scripts/       数据同步脚本（健康/阅读/LLM）
static/        静态资源（图片/音乐/封面/地图数据）
```

### 部署

`main` 分支 push → GitHub Actions 构建 → 托管主机 Nginx 提供静态文件。`deploy.yml` 在 `.github/workflows/` 下可查。

---

## 关于

吴飞飞（Feei），现任支付宝支付科技有限公司首席网络安全官。长期聚焦高复杂度业务中的信任、安全架构、攻防对抗与风险治理。

- 主导撰写《数字银行安全体系构建》
- 《网络安全面试指南》累计阅读过十万
- GitHub [FeeiCN](https://github.com/FeeiCN) 开源安全工具累计 12k+ Star
- 在 QCon / SSC / EISS / InSecWorld 等大会分享企业安全架构与 AI 攻防

合作与交流：邮件 `feei#feei.cn`（`#` 换 `@`），微信 `FEEI_WU`。

---

<div align="center">

**如果这里的某个判断、某段代码、某个仪表盘对你有用，欢迎 ⭐。**

**这是这个站点继续维护的最大动力。**

[在线站点](https://feei.cn) · [关于](https://feei.cn/about) · [创造确定性人生](https://feei.cn/life-certainty)

</div>
