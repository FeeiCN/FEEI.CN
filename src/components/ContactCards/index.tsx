import React, {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import GithubIcon from '../ItsHoverIcon/icons/github-icon';
import MailFilledIcon from '../ItsHoverIcon/icons/mail-filled-icon';
import MessageCircleIcon from '../ItsHoverIcon/icons/message-circle-icon';
import TwitterIcon from '../ItsHoverIcon/icons/twitter-icon';
import TwitterXIcon from '../ItsHoverIcon/icons/twitter-x-icon';
import type {AnimatedIconProps} from '../ItsHoverIcon/icons/types';

type ContactIcon = ComponentType<AnimatedIconProps>;

type ContactItem = {
  id: string;
  label: string;
  value: string;
  hint: string;
  icon: ContactIcon;
  href?: string;
  encodedValue?: string;
  action?: 'copy' | 'email';
};

const WECHAT_ID_BASE64 = 'RkVFSV9XVQ==';
const EMAIL_LINK_BASE64 = 'bWFpbHRvOmZlZWlAZmVlaS5jbg==';

const CONTACTS: ContactItem[] = [
  {
    id: 'mail',
    label: '邮箱',
    value: '点击发送邮件',
    hint: '适合正式沟通、项目合作与需要保留上下文的长内容',
    icon: MailFilledIcon,
    encodedValue: EMAIL_LINK_BASE64,
    action: 'email',
  },
  {
    id: 'wechat',
    label: '微信',
    value: '点击复制微信号',
    hint: '添加时请简单注明来意',
    icon: MessageCircleIcon,
    encodedValue: WECHAT_ID_BASE64,
    action: 'copy',
  },
  {
    id: 'github',
    label: 'GitHub',
    value: 'FeeiCN',
    hint: '开源项目与代码协作',
    icon: GithubIcon,
    href: 'https://github.com/FeeiCN',
  },
  {
    id: 'x',
    label: 'X',
    value: '@feei_cn',
    hint: '动态、观点与公开讨论',
    icon: TwitterXIcon,
    href: 'https://x.com/feei_cn',
  },
  {
    id: 'weibo',
    label: '微博',
    value: '吴飞飞',
    hint: '中文动态与内容分享',
    icon: TwitterIcon,
    href: 'https://weibo.com/u/1625149801',
  },
];

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function decodeBase64(value: string): string {
  return window.atob(value);
}

function ContactCard({
  item,
  copied,
  onAction,
}: {
  item: ContactItem;
  copied: boolean;
  onAction: (item: ContactItem) => void;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <span className="contactCardIcon" aria-hidden="true">
        <Icon size={25} strokeWidth={1.7} />
      </span>
      <span className="contactCardContent">
        <span className="contactCardLabel">{item.label}</span>
        <span className="contactCardValue">{item.value}</span>
        <span className="contactCardHint">{item.hint}</span>
      </span>
      <span className="contactCardAction" aria-hidden="true">
        {item.action === 'copy'
          ? copied
            ? '已复制'
            : '复制'
          : item.action === 'email'
            ? '写邮件'
            : '↗'}
      </span>
    </>
  );

  if (item.href) {
    const external = item.href.startsWith('http');
    return (
      <a
        className="contactCard"
        href={item.href}
        {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : null)}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className="contactCard"
      type="button"
      onClick={() => onAction(item)}
      aria-label={item.action === 'email' ? '发送邮件' : '复制微信号'}
    >
      {content}
    </button>
  );
}

export default function ContactCards() {
  const [copiedId, setCopiedId] = useState<string>();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleAction = async (item: ContactItem) => {
    if (!item.encodedValue || !item.action) {
      return;
    }

    const decodedValue = decodeBase64(item.encodedValue);
    if (item.action === 'email') {
      window.location.assign(decodedValue);
      return;
    }

    await copyText(decodedValue);
    setCopiedId(item.id);
    if (resetTimer.current) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => setCopiedId(undefined), 1800);
  };

  return (
    <div className="contactExperience">
      <section className="contactGrid" aria-label="联系方式">
        {CONTACTS.map((item) => (
          <ContactCard
            key={item.id}
            item={item}
            copied={copiedId === item.id}
            onAction={handleAction}
          />
        ))}
      </section>

      <p className="contactNote">
        如果问题需要具体回复，请优先使用邮件，并尽量附上必要的背景与上下文。
      </p>
      <span className="contactCopyStatus" aria-live="polite">
        {copiedId ? '微信号已复制' : ''}
      </span>
    </div>
  );
}
