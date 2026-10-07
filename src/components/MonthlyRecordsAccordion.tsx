import {Accordion} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import MonthlyRecords from './MonthlyRecords';

type Month = {month: number; label: string; review?: string};
type Props = {year: number; months: Month[]};

export default function MonthlyRecordsAccordion({year, months}: Props) {
  const {dailyRecords} = usePluginData('home-records-plugin') as {dailyRecords: HomeRecord[]};
  return (
    <Accordion.Root multiple collapsible className="year-month-accordion">
      {months.map(({month, label, review}) => {
        const prefix = `${year}-${String(month).padStart(2, '0')}-`;
        const count = dailyRecords.filter((record) => record.date.startsWith(prefix)).length;
        return (
          <Accordion.Item key={month} value={String(month)} className="year-month-details">
            <h2 className="year-month-heading doc-heading--manual-number">
              <Accordion.ItemTrigger className="year-month-trigger">
                <span>{label}</span><small>{count} 次记录</small><Accordion.ItemIndicator />
              </Accordion.ItemTrigger>
            </h2>
            <Accordion.ItemContent>
              <Accordion.ItemBody className="year-month-body">
                {review && <p><Link to={review}>查看 {year} 年 {month} 月月度回看</Link></p>}
                <MonthlyRecords year={year} month={month} />
              </Accordion.ItemBody>
            </Accordion.ItemContent>
          </Accordion.Item>
        );
      })}
    </Accordion.Root>
  );
}
