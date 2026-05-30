---
slug: /ssl-pinning-bypass
title: SSL Pinning 绕过
icon: lock-icon
---

SSL Pinning（证书固定）是移动端防止中间人抓包的常见机制——应用在代码中内置了信任的证书或其哈希，只接受与之匹配的服务端证书，使 Burp Suite 等代理工具的证书默认无效。以下是常见的绕过方式，iOS 和 Android 均有对应思路，但各方法都有前提条件和局限性。

## 越狱设备：全局禁用

**SSL Kill Switch 2** 是针对越狱设备最直接的工具，通过 Hook 系统层的证书校验函数，全局禁用所有应用的 SSL 证书检查。安装 `.deb` 包后在 Settings 中开启即可，无需针对单个应用做任何修改。

局限：需要越狱，且部分应用有越狱检测，会拒绝在越狱环境运行。

## 运行时注入：Frida / Objection

**Frida** 是最通用的动态插桩框架，通过向目标进程注入 JavaScript 脚本，在运行时 Hook 证书校验相关函数使其永远返回成功。

```bash
frida -U -f com.example.app -l ssl_bypass.js --no-pause
```

**Objection** 是基于 Frida 的封装工具，提供了更简洁的命令：

```bash
ios sslpinning disable
```

局限：需要设备上运行 Frida Server（通常需越狱），或通过重打包方式将 Frida gadget 注入 IPA。

## 重打包：替换内置证书

适用于将证书文件硬编码在 IPA 中的应用（常见于 React Native、Cordova 等跨平台框架）：

1. 解压 IPA 文件，查找 `.cer`、`.pem`、`.der` 等证书文件
2. 用 Burp Suite 导出的证书覆盖原证书
3. 对于 Cordova 应用，目标可能是 JSON 配置文件中的 SHA256 哈希值，替换为新证书的哈希即可
4. 重新签名并安装

局限：需要有效的开发者证书重新签名，部分应用有完整性校验（代码签名绑定或运行时自校验），替换后会崩溃。

## 配置修改：Info.plist

部分应用使用 TrustKit 等库做 Pinning，配置项存在 `Info.plist` 中（如 `TSKEnforcePinning`）。将对应布尔值从 `true` 改为 `false` 后重新打包安装，即可禁用校验。

局限：同样需要重签名，且只适用于使用这类库且未做额外保护的应用。

## 流量层绕过：mitmproxy 上游代理

针对 Flutter 和 Xamarin 应用，这两种框架不遵守系统代理设置，标准的 Burp 代理配置无效。替代方案：

- **热点转发**：用 Mac 共享网络（蓝牙 / Wi-Fi），在共享链路上用 mitmproxy 透明拦截流量，再转发给 Burp Suite
- mitmproxy 配置 `ssl_insecure` 选项后作为上游代理运行

局限：需要额外设备或网络配置，操作相对繁琐。

## 防御加固思路

从防御角度，单纯的 SSL Pinning 只是第一道门：

- **代码混淆**：让证书校验逻辑更难被 Hook 定位
- **证书轮换**：定期更换证书，降低证书提取后的可用时间窗口
- **运行时环境检测**：检测越狱、Frida、调试器等异常环境，拒绝在受攻击环境中运行
- **证书哈希多层校验**：不只校验叶证书，同时校验中间 CA，增加替换难度
