---
slug: /site-getshell
title: 某站点GET SHELL
icon: terminal-icon
---

## 1 信息泄露

![](./v_baixing_01-1024x618.webp)

Edge插件检测（左下角提示）到百姓金融存在Git泄漏。

![](./v_baixing_02.webp)

看下泄漏的git信息，是部署在`GitHub Private`上的项目。

![](./v_baixing_03.webp)

由于是带`auth-token`的，可以直接使用`auth-token`作为授权码将代码下载下来。

<!-- truncate -->

## 2 GET SHELL

代码下载后发现无太多可以利用的东西，连硬编码免密都没有。于是审计源码，发现代码中存在可以在线更新项目的脚本`pull.php`。

遂通过`auth-token`直接将大马commit到git上，然后访问在线更新脚本`pull.php`从git上更新最新代码，即可GETSHELL。

![](./v_baixing_03.webp)
![](./v_baixing_05-1024x561.webp)

DB 账号信息

![](./v_baixing_06-1024x561.webp)

DB 数据

## 3 扩大战果

除了这个项目外，还发现`聚车商`APP的管理后台代码仓库地址。`https://29ab43d962**********c0480b3ed157687:x-oauth-basic@github.com/****/jucheshang_admin`

通过这个地址我们可以直接上传SHELL，并通过搜索引擎找到`聚车商`域名`cartier.baixing.cn`，通过`http://cartier.****.cn/pull.php`更新到线上。

![](./v_baixing_07-1024x619.webp)

SHELL地址：`http://cartier.****.cn/js/faq.php`

![](./v_baixing_08.webp)

项目源码

漏洞已报告给CNCERT/乌云/补天或厂商且已修复完成，感谢厂商的重视及现金奖励。
