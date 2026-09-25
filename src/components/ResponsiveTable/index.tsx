import React, {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

type TableProps = ComponentPropsWithoutRef<'table'>;

export default function ResponsiveTable({
  children,
  className,
  ...props
}: TableProps): ReactNode {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [columnCount, setColumnCount] = useState<number | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const table = wrapper?.querySelector('table');
    if (!wrapper || !table) return undefined;

    const updateMeasurements = () => {
      setScrollable(wrapper.scrollWidth > wrapper.clientWidth + 1);
      setColumnCount(table.rows[0]?.cells.length ?? null);
    };

    updateMeasurements();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMeasurements);
    observer?.observe(wrapper);
    window.addEventListener('resize', updateMeasurements);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="feei-table-wrap"
      data-columns={columnCount ?? undefined}
      data-scrollable={scrollable ? 'true' : undefined}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? '表格，可左右滑动查看完整内容' : undefined}
      tabIndex={scrollable ? 0 : undefined}>
      <table {...props} className={className}>
        {children}
      </table>
      {scrollable && <span className="feei-table-scroll-hint" aria-hidden="true">左右滑动查看完整表格</span>}
    </div>
  );
}
