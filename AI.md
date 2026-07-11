# AI.md

本仓库协作助手。优先遵循本文件，按任务类型读取对应专项规则。

详细规则按任务类型分散在 `docs/` 下带 `SKILL` 徽标的文档中，按需加载，不要一次性全部读取。

## 工作方式

1. 先判断任务类型，按需读取 `## Context Loading` 路由表中的文件。
2. 修改代码或文档前，先理解相关目录、现有风格和约定。
3. 不要重构无关代码或顺手清理请求范围外的内容。
4. 不确定时，用最小范围验证；不要扩大上下文。

## 前端与主题覆盖

- Docusaurus 的 navbar、sidebar、dropdown、active 状态等问题，优先修改 `src/theme/` 或通用客户端逻辑，不要先给单个栏目写特例配置。
- 改动 `src/theme/`、`src/clientModules/` 等主题覆盖代码后，如果界面无变化，先确认本地 dev server 是否已重新编译；必要时重启 `npm run start` 后再判断是否生效。

## Context Loading

| 任务类型 | 读取 |
|---------|------|
| 仓库结构、构建命令、提交规范、静态资源 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/仓库结构.md` |
| TypeScript 风格、命名、front matter（slug / icon / description / image / content_type / last_reviewed） | `docs/05-吴飞飞/01-关于/关于FEEI.CN/网站开发规范.md` |
| Docusaurus 配置、sidebars、入口页文件位置与命名 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/docusaurus配置.md` |
| 通用文档写作（入口页 / 观点文 / 教程 / 资料 / 复盘 / 历史档案）、证据强度与质量检查 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/我的写作原则.md` |
| 04-人生丰富 散文、游记 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/散文写作.md` |
| GitHub Issue 内容沉淀 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/github-issue-skill.md` |
| 每日健康、阅读、财务、AI 数据分析与三省吾身 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/每日三省吾身.md` |
| 音乐库添加/删除/分组/歌词映射 | `docs/05-吴飞飞/01-关于/关于FEEI.CN/音乐库管理.md` |
| 创建/维护 SKILL 文档（位置、front matter、CLAUDE.md 登记、写作语气） | `docs/05-吴飞飞/01-关于/关于FEEI.CN/SKILL原则.md` |

读取路由指向的文件后，按其内容处理当前任务；不要把规则外推到其他任务类型。

## 输出要求

- 先给结论，再给必要解释。
- 中文优先，除非用户要求英文。
- 技术问题具体到文件、命令、配置或代码。
- 写作任务要避免空泛道理，多用真实场景、人物、细节。

## 安全与权限

- 用户明确要求 `commit push` 时，不要再执行“stash → pull/rebase → pop/恢复 → 再 build gate”的繁琐流程。
- `commit push` 默认流程：完成必要验证（如需要 build gate，则只跑一次）后，直接 `git add`、`git commit`、`git push`。
- 如果 `git push` 因 non-fast-forward 失败，再执行 `git pull --rebase origin main` 处理远端同步，然后重试 push。
- `build/`、`.docusaurus/` 是 Docusaurus 生成产物，不要手动编辑，下次构建会被覆盖。
