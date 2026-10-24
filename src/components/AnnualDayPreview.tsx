import {HoverCard, Popover, Portal} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import type {ReactNode} from 'react';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import type {RecordMetrics} from './annualCalendarMetrics';

type Props = {
  record: HomeRecord;
  metrics: RecordMetrics;
  mediaStatus: 'loading' | 'unavailable' | 'ready';
  touchMode: boolean;
  className: string;
  children: ReactNode;
};

export default function AnnualDayPreview({record, metrics, mediaStatus, touchMode, className, children}: Props) {
  const content = (
    <>
      <time dateTime={record.date} className="annual-preview__date">{record.date}</time>
      <strong className="annual-preview__title">{record.title}</strong>
      {record.location && <p className="annual-preview__location">{record.location}</p>}
      <div className="annual-preview__metrics">
        <span><b>{metrics.characters}</b> 字</span>
        <span><b>{metrics.images}</b> 张图</span>
        <span><b>{metrics.videos}</b> 段视频</span>
      </div>
      {mediaStatus !== 'ready' && <p className="annual-preview__status">{mediaStatus === 'loading' ? '媒体统计加载中…' : '媒体暂不可用，当前仅统计正文'}</p>}
      <Link className="annual-preview__link" to={record.to}>查看当天记录 →</Link>
    </>
  );
  const label = `${record.date}：${record.title}`;

  if (touchMode) {
    return (
      <Popover.Root lazyMount unmountOnExit positioning={{placement: 'top', gutter: 10, strategy: 'fixed', hideWhenDetached: true}}>
        <Popover.Trigger asChild>
          <button type="button" className={className} aria-label={`${label}，查看摘要`}>{children}</button>
        </Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content className="annual-preview" aria-label={label}>
              <Popover.Body>{content}</Popover.Body>
              <Popover.CloseTrigger aria-label="关闭摘要" className="annual-preview__close">×</Popover.CloseTrigger>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    );
  }

  return (
    <HoverCard.Root openDelay={200} closeDelay={150} lazyMount unmountOnExit positioning={{placement: 'top', gutter: 10, strategy: 'fixed', hideWhenDetached: true}}>
      <HoverCard.Trigger asChild>
        <Link to={record.to} className={className} aria-label={label}>{children}</Link>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content className="annual-preview">{content}</HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}
