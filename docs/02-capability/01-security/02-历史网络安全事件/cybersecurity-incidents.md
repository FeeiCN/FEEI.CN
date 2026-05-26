---
slug: cybersecurity-incidents
title: 历史真实发生的网络安全事件
---

先看看历史上那些真实发生的安全事件，每一次安全事件都付出了巨大的成本，然而我们当前是否真的能有效应对这些安全事件？

- 2010，震网，Stuxnet（CVE-2010-2568）；
- 2010，极光行动（Operation Aurora）；**Aurora：浏览器及其相关RCE 0day** 。拥有多个可造成RCE的0day漏洞（比如Oracle Java/Internet Explorer/Firefox），这些漏洞被植入到各类有特定人群的网站上（比如伊斯兰圣战相关），甚至通过广告精准投放给特定人群，实现访问特定网页即可感染。
- 2012，LinkdIn数据泄漏
- 2013，斯诺登；Yahoo数据泄漏；Target数据泄漏；Adobe数据泄漏；
- 2014，Sony Picture数据泄漏；JP Morgan Chase数据泄漏；eBay数据泄漏；The Regin Platform;
- 2015，[反击安全公司Hacking Team](https://feei.cn/hack-back-hacking-team/)
- 2016，方程式组织（The Equation Group）数据泄漏；[如何在网络上抢银行：开曼国家银行入侵启示](https://feei.cn/how-to-robbing-banks/)；Uber数据泄漏；Adult Friend Finder数据泄漏；Mirai僵尸网络攻击 DNS 服务。
- 2017，[Equifax遭入侵导致1.47亿用户数据泄露的安全分析](https://feei.cn/equifax-data-breach/)；WannaCry勒索软件攻击；Vault 7/8；
- 2018，Facebook数据大规模收集和滥用；**CA&Facebook：合作伙伴数据滥用** 。Cambridge Analytica滥用Facebook接口采集超过8700万用户资料数据进行分析并出售。面对一方/二方/三方合作伙伴，数据安全水位各不一样。
- Under Armour MyFitnessPal数据泄漏；Marriott数据泄漏；
- 2019，Capital One数据泄漏；WhatsApp被NSO Group入侵；
- 2020，SolarWinds供应链攻击；Twitter钓鱼事件；
- 2021，Colonial Pipeline勒索软件攻击；
- 2023，**[Operation Triangulation：0click iMessage RCE 0day](https://feei.cn/operation-triangulation/)** 。收到一条包含附件的 iMessage，无需任何交互即可触发代码执行漏洞，接着再利用其他漏洞进行权限提升，并下载功能齐全的恶意软件，之后删除附件和原始消息。
- **LockBit：各种供应链软硬件0day** 。通过钓鱼邮件以及0day/Nday漏洞（Fortinet/Citrix等软件）突破边界，进行感染以及自传播。通过窃取加密、威胁泄漏数据、DDoS等多重方式勒索赎金。勒索软件已RaaS化，通过利用Nday甚至储备0day方式进行攻击。
- 勒索，WannaCry（CVE-2017-0145）
- **SolarWinds：供应链软件更新源被控** 。SolarWinds遭到入侵，导致更新包被替换为存在后门的。超过18000个使用SolarWinds的企业被控制。
- HackerOne中值得学习的漏洞

- 保密
- 乌云漫游内网系列
- **购买内部员工权限/入职为外包** 。业内曾出现多起将查询敏感数据的权限对外出售赚取利益，还不仅限于企业内部员工。甚至存在通过入职成为外包的方式，获取查询数据的权限甚至作为跳板进入内网收集数据。

> 全球网站数据泄漏列表
